import { QueryInterface, QueryTypes, Transaction } from "sequelize";

/**
 * Give every learner with no grade the one grade their curriculum has.
 *
 * Learner writes now require a valid grade, but every existing `students` row was written with `gradeid` NULL.
 * Both APIs keep their own copy of `students` and `grades`, so each runs this same migration.
 *
 * Rule, for each `students` row with `gradeid IS NULL` and `curriculumid IS NOT NULL` (teacher accounts included,
 * no filter on is_teacher_acc or role): when its curriculum has exactly ONE live grade (`grades.isdeleted = 0`),
 * set `gradeid` to it. A curriculum with no live grade, or with several, leaves the row NULL: there is no single
 * right answer to pick, and a person decides. A row whose `gradeid` is already set is never changed, and no
 * other column is written (`updated_at`, where the table has one, is not bumped: the data migrations here do not).
 *
 * Idempotent: a second run finds no NULL-grade row with exactly one live grade and updates 0 rows. No schema
 * change; the column stays nullable. Only counts are logged, never names, usernames or ids.
 *
 * `down` does nothing: which rows were NULL before is not recorded.
 */
const LIVE_GRADE_COUNT = `(
  SELECT COUNT(*) FROM grades g
  WHERE g.curriculumid = s.curriculumid AND g.isdeleted = 0
)`;

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const count = async (condition: string): Promise<number> => {
        const rows = await queryInterface.sequelize.query<{ n: number | string }>(
          `SELECT COUNT(*) AS n FROM students s
           WHERE s.gradeid IS NULL AND s.curriculumid IS NOT NULL AND ${condition}`,
          { type: QueryTypes.SELECT, transaction },
        );
        return Number(rows[0].n);
      };
      const zeroGrades = await count(`${LIVE_GRADE_COUNT} = 0`);
      const severalGrades = await count(`${LIVE_GRADE_COUNT} > 1`);

      const [, updated] = await queryInterface.sequelize.query(
        `UPDATE students s
         JOIN (
           SELECT curriculumid, MIN(gradeid) AS gradeid
           FROM grades
           WHERE isdeleted = 0
           GROUP BY curriculumid
           HAVING COUNT(*) = 1
         ) one ON one.curriculumid = s.curriculumid
         SET s.gradeid = one.gradeid
         WHERE s.gradeid IS NULL AND s.curriculumid IS NOT NULL`,
        { type: QueryTypes.UPDATE, transaction },
      );

      console.log(
        `backfill-learner-grade: ${updated} learner(s) given their curriculum's only grade; ` +
          `${zeroGrades} left without a grade (curriculum has no live grade); ` +
          `${severalGrades} left without a grade (curriculum has several live grades)`,
      );
    }),

  down: async (): Promise<void> => {
    console.log("backfill-learner-grade: down does nothing (which learners had no grade before is not recorded)");
  },
};
