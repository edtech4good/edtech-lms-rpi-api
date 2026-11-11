import { randomUUID } from "node:crypto";
import { Op, Transaction, WhereOptions } from "sequelize";
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
 * Gives the learner the award for a level when this write is the one that completes it, inside the caller's
 * transaction. One award per learner per level, ever: a duplicate on (studentid, levelid) is ignored by the database
 * (INSERT IGNORE), so a second completion, or two at once, leave one row and never fail the learner's result.
 *
 * An award is never updated or deleted here: a level that later drops below the pass mark keeps it. Whether the
 * learner's school hides the tier is checked now, at the moment the award would be earned, and not again later.
 */
export const awardLevelIfCompleted = async (input: LevelAwardInput, transaction: Transaction): Promise<void> => {
  const { user, levelid, gradeid, curid, wasCompleted, isCompleted, currentdate } = input;
  if (!user.studentid || !isCompleted || wasCompleted) {
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
        earnedat_approximate: false,
      },
    ],
    { ignoreDuplicates: true, transaction },
  );
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
