import { QueryInterface, Transaction } from "sequelize";

/**
 * Enforces the natural submission key for `studentprogress` rows so a
 * replayed practice/quiz/level-quiz/baseline result POST (the Expo client
 * is gaining an at-least-once retry queue for these saves) cannot create a
 * duplicate progress row.
 *
 * Natural key: (studentid, studentprogressreferenceid, starttime).
 *
 * `up` first collapses any pre-existing duplicate groups sharing that key —
 * keeping the row with the lowest `studentprogressid` per group (the PK is
 * a fresh uuidv4 with no creation-order meaning, but it is the only stable
 * tiebreaker available) — deleting the losing rows' `studentprogressquestions`
 * children first to satisfy the FK, then the losing `studentprogress` rows
 * themselves. It then adds a unique index on the natural key so the
 * application-level dedup (result.business.ts findOrCreate) has a real
 * constraint backing it.
 *
 * The "loser" set is computed entirely in SQL via a self-join (a row is a
 * loser if another row in the same group has a strictly smaller
 * studentprogressid) rather than by selecting `starttime` out into JS and
 * feeding it back into a second query. That round trip was tried first and
 * silently matched zero rows in local testing: mysql2 converts DATETIME
 * columns into JS `Date` objects using the driver's timezone handling, and
 * re-serializing that value for a `starttime = ?` comparison did not
 * reliably reproduce the original stored value. Never leaving MySQL avoids
 * that class of bug, and every identifier below is a fixed column name, not
 * user data — there is nothing to parameterize.
 *
 * NOT done here, and NOT retroactively corrected: aggregate/points tables
 * (studentlessonsprogress, studentlevelsprogress, studentpoints, grade
 * progress, etc.) that may have been double-counted by historical replays
 * before this fix. That is a known, accepted gap — this migration only
 * de-duplicates the raw progress rows and prevents new duplicates; it does
 * not attempt to unwind downstream aggregate drift.
 */
// DISTINCT matters once a group has 3+ duplicate rows: sp1 would otherwise
// join against every smaller sp2 in the group and emit its own
// studentprogressid more than once (harmless for DELETE ... JOIN, which
// only cares whether a match exists, but avoids inflating the row set).
const LOSERS_SUBQUERY = `
  SELECT DISTINCT sp1.studentprogressid
  FROM studentprogress sp1
  JOIN studentprogress sp2
    ON sp2.studentid = sp1.studentid
   AND sp2.studentprogressreferenceid = sp1.studentprogressreferenceid
   AND sp2.starttime = sp1.starttime
   AND sp2.studentprogressid < sp1.studentprogressid
`;

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Delete the losing rows' question children first (FK), then the
      // losing studentprogress rows themselves. The derived-table wrapping
      // of the self-referencing subquery is required by MySQL for
      // DELETE ... JOIN (you can't otherwise target the same table a
      // subquery reads from); it materializes before the delete runs.
      await queryInterface.sequelize.query(
        `DELETE spq
         FROM studentprogressquestions spq
         JOIN (${LOSERS_SUBQUERY}) AS losers
           ON losers.studentprogressid = spq.studentprogressid`,
        { transaction },
      );

      await queryInterface.sequelize.query(
        `DELETE sp
         FROM studentprogress sp
         JOIN (${LOSERS_SUBQUERY}) AS losers
           ON losers.studentprogressid = sp.studentprogressid`,
        { transaction },
      );

      // Skip-if-exists: if a previous run got as far as creating the index
      // but crashed before sequelize-cli recorded this migration in
      // SequelizeMeta, a re-run would otherwise fail on ER_DUP_KEYNAME (the
      // dedup DELETEs above are naturally idempotent — nothing left to
      // collapse the second time — so the index is the only non-repeatable
      // step).
      const existingIndexes = (await queryInterface.showIndex("studentprogress", {
        transaction,
      })) as Array<{ name: string }>;
      const indexAlreadyExists = existingIndexes.some(
        (index) => index.name === "uq_studentprogress_submission",
      );
      if (!indexAlreadyExists) {
        await queryInterface.addIndex(
          "studentprogress",
          ["studentid", "studentprogressreferenceid", "starttime"],
          {
            unique: true,
            name: "uq_studentprogress_submission",
            transaction,
          },
        );
      }
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Only removes the unique index. Duplicate rows collapsed by `up` are
      // NOT resurrected, and aggregate tables were never retroactively
      // corrected for historical double-counts — both known, accepted.
      await queryInterface.removeIndex(
        "studentprogress",
        "uq_studentprogress_submission",
        { transaction },
      );
    }),
};
