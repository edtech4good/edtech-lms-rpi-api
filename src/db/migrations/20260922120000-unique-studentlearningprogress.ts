import { QueryInterface, Transaction } from "sequelize";

/**
 * Enforces one `studentlearningsprogress` row per (studentid,
 * lessonlearningid). `updatelearningprogress` (lesson.business.ts) now
 * awards points on open for media-less learning items rather than only on
 * "watched to the end", which means the very first POST for such an item
 * can itself carry `ended: true` and no prior row to `findOne` against.
 * Two concurrent opens of the same media-less item (a double-tap, a client
 * retry racing the original request) can both miss that `findOne` and both
 * `create` a row, double-awarding the item's points into
 * `studentlessonsprogress`. There was no unique index backing the natural
 * key before, so nothing stopped it.
 *
 * `up` first collapses any pre-existing duplicate groups sharing the
 * (studentid, lessonlearningid) key, keeping the row that best represents
 * real progress and discarding the rest. "Best" is ranked, in order: the
 * greatest `points`, then the greatest `viewed`, then the most recent
 * `lastupdated`; a row that is still tied on all three after that keeps the
 * lowest `studentlearningprogressid` (the PK is a fresh uuidv4 with no
 * creation-order meaning, but it is the only stable tiebreaker left). It
 * then adds a unique index on the natural key, named to match the
 * 20260818090000 precedent's `uq_<table>_<what>` convention. `points`,
 * `viewed`, and `lastupdated` are all nullable columns, so the ranking
 * comparison COALESCEs them to 0 / 0 / epoch respectively rather than
 * letting a NULL silently lose every comparison it takes part in.
 *
 * It also drops OLD_NON_UNIQUE_INDEX_NAME, a pre-existing non-unique index
 * on the same (studentid, lessonlearningid) pair (present in the DB schema,
 * not created by any migration in this repo — likely from the original
 * schema dump). It is now fully redundant: any query that could use it can
 * use the new unique index instead, and MySQL does not let two indexes with
 * different uniqueness share the same leading column pair usefully — there
 * is no reason to keep paying its write cost. `down` recreates it (as
 * non-unique, same column order) before removing the unique index, so a
 * rollback restores the exact index set this migration found.
 *
 * As with 20260818090000, the loser set is computed entirely in SQL via a
 * self-join rather than round-tripping rows through JS, and stays inside a
 * transaction with skip-if-exists / skip-if-missing checks around both
 * index operations so a crash mid-migration can be safely re-run.
 *
 * NOT done here: aggregate tables (`studentlessonsprogress`,
 * `studentlevelsprogress`, `studentpoints`, grade progress, etc.) that may
 * already have been double-counted by a historical race are not
 * retroactively corrected. Known, accepted gap, same as 20260818090000.
 */
const LOSERS_SUBQUERY = `
  SELECT DISTINCT slp1.studentlearningprogressid
  FROM studentlearningsprogress slp1
  JOIN studentlearningsprogress slp2
    ON slp2.studentid = slp1.studentid
   AND slp2.lessonlearningid = slp1.lessonlearningid
   AND (
        COALESCE(slp2.points, 0) > COALESCE(slp1.points, 0)
     OR (COALESCE(slp2.points, 0) = COALESCE(slp1.points, 0)
         AND COALESCE(slp2.viewed, 0) > COALESCE(slp1.viewed, 0))
     OR (COALESCE(slp2.points, 0) = COALESCE(slp1.points, 0)
         AND COALESCE(slp2.viewed, 0) = COALESCE(slp1.viewed, 0)
         AND COALESCE(slp2.lastupdated, '1970-01-01') > COALESCE(slp1.lastupdated, '1970-01-01'))
     OR (COALESCE(slp2.points, 0) = COALESCE(slp1.points, 0)
         AND COALESCE(slp2.viewed, 0) = COALESCE(slp1.viewed, 0)
         AND COALESCE(slp2.lastupdated, '1970-01-01') = COALESCE(slp1.lastupdated, '1970-01-01')
         AND slp2.studentlearningprogressid < slp1.studentlearningprogressid)
   )
`;

const UNIQUE_INDEX_NAME = "uq_studentlearningprogress_student_learning";
const OLD_NON_UNIQUE_INDEX_NAME =
  "studentlearningsprogress_studentid_lessonlearningid";
const INDEX_COLUMNS = ["studentid", "lessonlearningid"];

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Delete the losing rows. studentlearningsprogress has no known child
      // tables keyed off studentlearningprogressid, so unlike the
      // studentprogress dedup there is no FK-child cleanup step first.
      await queryInterface.sequelize.query(
        `DELETE slp
         FROM studentlearningsprogress slp
         JOIN (${LOSERS_SUBQUERY}) AS losers
           ON losers.studentlearningprogressid = slp.studentlearningprogressid`,
        { transaction },
      );

      const existingIndexes = (await queryInterface.showIndex(
        "studentlearningsprogress",
        { transaction },
      )) as Array<{ name: string }>;

      // Skip-if-exists: a re-run after a crash between the dedup and the
      // addIndex call would otherwise fail on ER_DUP_KEYNAME. The dedup
      // DELETE above is naturally idempotent (nothing left to collapse the
      // second time).
      const uniqueIndexAlreadyExists = existingIndexes.some(
        (index) => index.name === UNIQUE_INDEX_NAME,
      );
      if (!uniqueIndexAlreadyExists) {
        await queryInterface.addIndex(
          "studentlearningsprogress",
          INDEX_COLUMNS,
          {
            unique: true,
            name: UNIQUE_INDEX_NAME,
            transaction,
          },
        );
      }

      // Skip-if-missing: a re-run after a crash between here and the end of
      // `up` would otherwise fail trying to drop an index that is already
      // gone.
      const oldIndexStillExists = existingIndexes.some(
        (index) => index.name === OLD_NON_UNIQUE_INDEX_NAME,
      );
      if (oldIndexStillExists) {
        await queryInterface.removeIndex(
          "studentlearningsprogress",
          OLD_NON_UNIQUE_INDEX_NAME,
          { transaction },
        );
      }
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Restore the old non-unique index first — while the unique index
      // still exists to guarantee the data underneath still satisfies it —
      // then remove the unique index. Duplicate rows collapsed by `up` are
      // NOT resurrected, and aggregate tables were never retroactively
      // corrected for historical double-counts — both known, accepted.
      const existingIndexes = (await queryInterface.showIndex(
        "studentlearningsprogress",
        { transaction },
      )) as Array<{ name: string }>;
      const oldIndexAlreadyExists = existingIndexes.some(
        (index) => index.name === OLD_NON_UNIQUE_INDEX_NAME,
      );
      if (!oldIndexAlreadyExists) {
        await queryInterface.addIndex(
          "studentlearningsprogress",
          INDEX_COLUMNS,
          {
            unique: false,
            name: OLD_NON_UNIQUE_INDEX_NAME,
            transaction,
          },
        );
      }

      await queryInterface.removeIndex(
        "studentlearningsprogress",
        UNIQUE_INDEX_NAME,
        { transaction },
      );
    }),
};
