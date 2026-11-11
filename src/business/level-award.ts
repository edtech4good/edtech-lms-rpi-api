import { randomUUID } from "node:crypto";
import { Op, QueryTypes, Sequelize, Transaction, WhereOptions } from "sequelize";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { levels } from "src/models/data-models/levels";
import { schools } from "src/models/data-models/school";
import { studentawards } from "src/models/data-models/studentawards";
import { students } from "src/models/data-models/students";
import { Token } from "src/models/token.model";
import { resolveTierLabels } from "./tier-labels";

export interface LevelAwardInput {
  user: Token;
  levelid: string;
  gradeid: string;
  curid: string;
  /** The level progress row's `completed` before this write (false when the row is new). */
  wasCompleted: boolean;
  /** The level progress row's `completed` after this write. */
  isCompleted: boolean;
  /** The result's own date: an offline-queued result flushed later carries its original date. */
  currentdate: Date;
}

/**
 * The learner's school as the token names it (a learner token always carries one), else the school on the learner row.
 */
const schoolIdOf = async (user: Token): Promise<string | null> => {
  if (user.schoolid) {
    return user.schoolid;
  }
  const learner = await students.scope("withOwnership").findOne({ where: { studentid: user.studentid }, attributes: ["schoolid"] });
  return learner?.schoolid ?? null;
};

/**
 * True when the learner's school hides a tier that holds a single item (`brandingconfig.hideSingleItemTiers`) and the
 * level's grade holds exactly one live level, counted the way the learner app's level list does (`levelstatus` on,
 * `isdeleted` off, as `LevelBusiness.getlevelsbygradeid`). Such a level is not shown as a level, so it earns nothing.
 */
export const levelIsHiddenSingleItemTier = async (user: Token, gradeid: string, transaction: Transaction): Promise<boolean> => {
  const schoolid = await schoolIdOf(user);
  if (!schoolid) {
    return false;
  }
  const school = await schools.findOne({ where: { schoolid }, attributes: ["schoolid", "brandingconfig"], transaction });
  if (!resolveTierLabels(school?.brandingconfig).hideSingleItemTiers) {
    return false;
  }
  const live = await levels.count({ where: { gradeid, levelstatus: true, isdeleted: false }, transaction });
  return live === 1;
};

/**
 * Makes sure the learner has the award for a level, on every write of that level's progress where the level is
 * complete after the write, inside the caller's transaction. One award per learner per level, ever: a duplicate on
 * (studentid, levelid) is ignored by the database (INSERT IGNORE), so a second completion, or two at once, leave one
 * row and never fail the learner's result.
 *
 * The rule, in order:
 *  1. the level is not complete after this write: nothing;
 *  2. the learner already has an award for the level: nothing (one indexed query, made before any other lookup, so the
 *     common case costs one query and an earned award is never read for its date, updated or deleted);
 *  3. the learner's school hides single-item tiers and the level's grade holds one live level: nothing (this is
 *     checked when the award is about to be made, and a level hidden then is awarded on the learner's next result once
 *     it is shown);
 *  4. otherwise the award is inserted with `earnedat` = the result's own date. `earnedat_approximate` is false when this
 *     write is the one that took the level from not complete to complete, and TRUE when the level was already complete
 *     before it (it arrived complete from a roster import or a recalculation, or was completed by code that made no
 *     award): the award is late, so its date is an upper bound.
 *
 * An award is never updated or deleted here: a level that later drops below the pass mark keeps it.
 */
export const awardLevelIfCompleted = async (input: LevelAwardInput, transaction: Transaction): Promise<void> => {
  const { user, levelid, gradeid, curid, wasCompleted, isCompleted, currentdate } = input;
  if (!user.studentid || !isCompleted) {
    return;
  }
  const existing = await studentawards.findOne({ where: { studentid: user.studentid, levelid }, attributes: ["studentawardid"], transaction });
  if (existing) {
    return;
  }
  if (await levelIsHiddenSingleItemTier(user, gradeid, transaction)) {
    return;
  }
  await studentawards.bulkCreate(
    [
      {
        studentawardid: randomUUID(),
        studentid: user.studentid,
        levelid,
        gradeid,
        curid,
        earnedat: currentdate,
        earnedat_approximate: wasCompleted,
      },
    ],
    { ignoreDuplicates: true, transaction },
  );
};

/** The hidden-tier condition of the SQL that awards levels already complete: 1 when the level's single-item tier is hidden. Kept in step with the backfill migration by level-award.sql-pin.spec.ts. */
export const AWARD_HIDDEN_SQL = `COALESCE(
  JSON_TYPE(JSON_EXTRACT(sc.brandingconfig, '$.hideSingleItemTiers')) = 'BOOLEAN'
  AND JSON_EXTRACT(sc.brandingconfig, '$.hideSingleItemTiers') = CAST('true' AS JSON)
  AND (SELECT COUNT(*) FROM levels lc WHERE lc.gradeid = lv.gradeid AND lc.levelstatus = 1 AND lc.isdeleted = 0) = 1,
  0)`;

export const awardCandidatesSql = (scope = ""): string => `(
  SELECT studentid, levelid, MIN(gradeid) AS gradeid, MIN(curid) AS curid, MIN(lastupdated) AS lastupdated
  FROM studentlevelsprogress
  WHERE completed = 1${scope}
  GROUP BY studentid, levelid
) c
LEFT JOIN levels lv ON lv.levelid = c.levelid
LEFT JOIN grades gr ON gr.gradeid = lv.gradeid
LEFT JOIN students s ON s.studentid = c.studentid
LEFT JOIN schools sc ON sc.schoolid = s.schoolid`;

/**
 * The approximate awards for levels that are already complete, for the given learners (every learner when `studentids`
 * is null): one per learner and level with a completed `studentlevelsprogress` row and no award yet, dated by the
 * earliest `lastupdated` of the row, `earnedat_approximate` = 1, skipping a level whose single-item tier is hidden.
 * The level's CURRENT grade and that grade's curriculum are judged and stored (as the runtime helper stores them); the
 * progress row's own are used only when the level row is gone. The migration 20261111110100-backfill-level-awards keeps
 * its own copy of the two SQL fragments below (a migration must not import code that may change later);
 * level-award.sql-pin.spec.ts fails when the two drift apart. Returns the number of awards made.
 */
export const awardCompletedLevels = async (studentids: string[] | null, transaction: Transaction, connection: Sequelize | undefined = studentawards.sequelize): Promise<number> => {
  if (studentids !== null && studentids.length === 0) {
    return 0;
  }
  const sequelize = connection;
  if (!sequelize) {
    return 0;
  }
  const [result] = await sequelize.query(
    `INSERT IGNORE INTO studentawards (studentawardid, studentid, levelid, gradeid, curid, earnedat, earnedat_approximate)
     SELECT UUID(), c.studentid, c.levelid, COALESCE(lv.gradeid, c.gradeid), COALESCE(gr.curriculumid, c.curid), COALESCE(c.lastupdated, CURRENT_TIMESTAMP), 1
     FROM ${awardCandidatesSql(studentids === null ? "" : " AND studentid IN (:studentids)")}
     WHERE ${AWARD_HIDDEN_SQL} = 0`,
    { type: QueryTypes.RAW, transaction, replacements: { studentids: studentids ?? [] } },
  );
  return Number((result as unknown as { affectedRows?: number })?.affectedRows ?? 0);
};

export interface AwardView {
  studentawardid: string;
  levelid: string;
  levelname: string | null;
  levelorder: number | null;
  gradeid: string;
  gradename: string | null;
  curid: string;
  curriculumname: string | null;
  earnedat: Date;
  earnedat_approximate: boolean;
}

/**
 * One learner's awards, newest first, with the level, grade and curriculum names read from the content tables
 * whether or not those rows have since been deleted or switched off: an award outlives its level. Read-only.
 * `extra` narrows the award rows (the report's grade filter); the learner is always the one named.
 */
export const awardsOfStudent = async (studentid: string, extra: WhereOptions = {}): Promise<AwardView[]> => {
  // Newest first; the order is also made here so that it does not depend on the database's.
  const rows = (await studentawards.findAll({
    where: { ...extra, studentid },
    order: [
      ["earnedat", "DESC"],
      ["studentawardid", "ASC"],
    ],
  })).sort((a, b) => new Date(b.earnedat).getTime() - new Date(a.earnedat).getTime() || (a.studentawardid < b.studentawardid ? -1 : 1));
  if (rows.length === 0) {
    return [];
  }
  const ids = (pick: (r: studentawards) => string) => [...new Set(rows.map(pick))];
  const [lv, gr, cu] = await Promise.all([
    levels.findAll({ where: { levelid: { [Op.in]: ids((r) => r.levelid) } }, attributes: ["levelid", "levelname", "levelorder"] }),
    grades.findAll({ where: { gradeid: { [Op.in]: ids((r) => r.gradeid) } }, attributes: ["gradeid", "gradename"] }),
    curriculums.findAll({ where: { curriculumid: { [Op.in]: ids((r) => r.curid) } }, attributes: ["curriculumid", "curriculumname"] }),
  ]);
  const levelOf = new Map(lv.map((x) => [x.levelid, x]));
  const gradeOf = new Map(gr.map((x) => [x.gradeid, x]));
  const curOf = new Map(cu.map((x) => [x.curriculumid, x]));
  return rows.map((r) => ({
    studentawardid: r.studentawardid,
    levelid: r.levelid,
    levelname: levelOf.get(r.levelid)?.levelname ?? null,
    levelorder: levelOf.get(r.levelid)?.levelorder ?? null,
    gradeid: r.gradeid,
    gradename: gradeOf.get(r.gradeid)?.gradename ?? null,
    curid: r.curid,
    curriculumname: curOf.get(r.curid)?.curriculumname ?? null,
    earnedat: r.earnedat,
    earnedat_approximate: Boolean(r.earnedat_approximate),
  }));
};
