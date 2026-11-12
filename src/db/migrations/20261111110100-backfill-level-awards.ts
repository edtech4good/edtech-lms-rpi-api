import { QueryInterface, QueryTypes, Transaction } from "sequelize";

/**
 * Give every learner the award for each level they have already completed.
 *
 * `studentawards` (20261111110000) is written by the result routes from now on; this fills it for what was completed
 * before. For each (studentid, levelid) with a `studentlevelsprogress` row whose `completed` is 1 and no award yet, one
 * award is inserted with `earnedat` = the `lastupdated` of that progress row (the earliest one when a pair has several)
 * and `earnedat_approximate` = 1: the day the level was completed is not recorded, only the day its row last changed.
 * `gradeid` and `curid` are the level's CURRENT grade and that grade's curriculum (what the result routes store); the
 * progress row's own are used only when the level row is gone.
 *
 * The hidden-tier rule applies to the data as it is now: no award when the learner's school has
 * `brandingconfig.hideSingleItemTiers` set to the JSON boolean true AND the level's CURRENT grade (`levels.gradeid`, not
 * the progress row's) holds exactly one live level
 * (`levels.levelstatus` on, `isdeleted` off: the filter the learner app's level list uses). A learner with no school
 * row, or a school with no such setting, is not hidden.
 *
 * Idempotent: a pair that already has an award is never touched (the unique key on (studentid, levelid) makes the
 * INSERT IGNORE skip it), so a second run inserts 0. One transaction. Only counts are logged, never a name or an id.
 *
 * `down` does nothing: which awards were made here (rather than by a result) is `earnedat_approximate = 1`, and an
 * award is never taken away.
 */
// Kept in step with AWARD_HIDDEN_SQL and awardCandidatesSql("") in src/business/level-award.ts (which the roster import
// uses for the learners it imports); src/business/level-award.sql-pin.spec.ts fails when they differ.
const CANDIDATES = `(
  SELECT studentid, levelid, MIN(gradeid) AS gradeid, MIN(curid) AS curid, MIN(lastupdated) AS lastupdated
  FROM studentlevelsprogress
  WHERE completed = 1
  GROUP BY studentid, levelid
) c
LEFT JOIN levels lv ON lv.levelid = c.levelid
LEFT JOIN grades gr ON gr.gradeid = lv.gradeid
LEFT JOIN students s ON s.studentid = c.studentid
LEFT JOIN schools sc ON sc.schoolid = s.schoolid`;

// 1 when the school hides single-item tiers and the level's current grade has exactly one live level, else 0 (never NULL).
const HIDDEN = `COALESCE(
  JSON_TYPE(JSON_EXTRACT(sc.brandingconfig, '$.hideSingleItemTiers')) = 'BOOLEAN'
  AND JSON_EXTRACT(sc.brandingconfig, '$.hideSingleItemTiers') = CAST('true' AS JSON)
  AND (SELECT COUNT(*) FROM levels lc WHERE lc.gradeid = lv.gradeid AND lc.levelstatus = 1 AND lc.isdeleted = 0) = 1,
  0)`;

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const count = async (sql: string): Promise<number> => {
        const rows = await queryInterface.sequelize.query<{ n: number | string }>(sql, { type: QueryTypes.SELECT, transaction });
        return Number(rows[0].n);
      };
      const alreadyAwarded = await count(
        `SELECT COUNT(*) AS n FROM ${CANDIDATES}
         JOIN studentawards a ON a.studentid = c.studentid AND a.levelid = c.levelid`,
      );
      const hidden = await count(
        `SELECT COUNT(*) AS n FROM ${CANDIDATES}
         LEFT JOIN studentawards a ON a.studentid = c.studentid AND a.levelid = c.levelid
         WHERE a.studentawardid IS NULL AND ${HIDDEN} = 1`,
      );

      const [result] = await queryInterface.sequelize.query(
        `INSERT IGNORE INTO studentawards (studentawardid, studentid, levelid, gradeid, curid, earnedat, earnedat_approximate)
         SELECT UUID(), c.studentid, c.levelid, COALESCE(lv.gradeid, c.gradeid), COALESCE(gr.curriculumid, c.curid), COALESCE(c.lastupdated, CURRENT_TIMESTAMP), 1
         FROM ${CANDIDATES}
         WHERE ${HIDDEN} = 0`,
        { type: QueryTypes.RAW, transaction },
      );
      const awarded = Number((result as unknown as { affectedRows?: number })?.affectedRows ?? 0);

      console.log(
        `backfill-level-awards: ${awarded} award(s) made; ${hidden} level(s) skipped (single-item tier hidden); ` +
          `${alreadyAwarded} already had an award`,
      );
    }),

  down: async (): Promise<void> => {
    console.log("backfill-level-awards: down does nothing (an award is never taken away)");
  },
};
