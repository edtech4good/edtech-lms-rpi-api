import { QueryInterface, Transaction } from "sequelize";

/**
 * Recompute marks, resultpercentage and ispass for existing lesson-practice
 * attempts (studentprogress rows with progresstype = 1, Progress.LESSONPRACTICE
 * in src/models/enums/progress.enum.ts).
 *
 * The old rule was `correct answers / submitted answers * 100`, pass at 80.
 * The Expo client only submits the answers the learner got right, so every
 * attempt with at least one correct answer was stored as 100% and passed,
 * and the practice route never records another attempt once one has passed.
 * Stored `marks` was also just the payload length, which has been seen to
 * include duplicates and answers to other practices' questions (marks 7 on
 * a 4-question practice).
 *
 * New rule (same as src/business/practicescore.ts): marks = DISTINCT correct
 * answers (studentprogressquestions.iscorrect = 1) whose referencequestionid
 * is an ACTIVE question of this practice; resultpercentage =
 * ROUND(LEAST(100, marks * 100 / active count), 2); ispass = percentage >= 80.
 * Practices with no active questions are left alone (the new rule passes
 * them at 100, and there is nothing to recompute against).
 *
 * Only attempts that HAVE studentprogressquestions rows are recomputed. The
 * roster import (import.controller.ts -> StudentProgressBusiness bulkCreate)
 * writes practice rows carrying the source system's marks/percentage/pass
 * but no answer rows; with nothing stored to score them against, recomputing
 * would turn every imported pass into marks 0 / fail. Those rows are left
 * exactly as they are (they are still copied to the backup table).
 *
 * Points, fullpoints, scores and the lesson/level/grade progress tables are
 * NOT touched — the pass flag never fed them.
 *
 * The previous values of every practice row are copied to
 * studentprogress_practicepass_bak first, and `down` restores from it. The
 * CREATE fails if the backup table already exists, so a second run cannot
 * overwrite the only copy of the original values. CREATE TABLE ... SELECT is
 * DDL and commits implicitly in MySQL, so it runs before the transaction; if
 * the UPDATE then fails, drop the (unused) backup table before retrying.
 */
const PRACTICE = 1; // Progress.LESSONPRACTICE

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      `CREATE TABLE studentprogress_practicepass_bak (PRIMARY KEY (studentprogressid)) AS
       SELECT studentprogressid, ispass, resultpercentage, marks
       FROM studentprogress
       WHERE progresstype = ${PRACTICE}`,
    );
    await queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE studentprogress sp
         JOIN (
           SELECT lessonpracticeid, COUNT(*) AS activecount
           FROM lessonpracticequestions
           WHERE lessonpracticequestionstatus = 1
           GROUP BY lessonpracticeid
         ) a ON a.lessonpracticeid = sp.studentprogressreferenceid
         LEFT JOIN (
           SELECT q.studentprogressid, lpq.lessonpracticeid,
                  COUNT(DISTINCT q.referencequestionid) AS correctcount
           FROM studentprogressquestions q
           JOIN lessonpracticequestions lpq
             ON lpq.lessonpracticequestionid = q.referencequestionid
            AND lpq.lessonpracticequestionstatus = 1
           WHERE q.iscorrect = 1
           GROUP BY q.studentprogressid, lpq.lessonpracticeid
         ) c ON c.studentprogressid = sp.studentprogressid
            AND c.lessonpracticeid = sp.studentprogressreferenceid
         SET sp.marks = COALESCE(c.correctcount, 0),
             sp.resultpercentage = ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2),
             sp.ispass = (ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2) >= 80)
         WHERE sp.progresstype = ${PRACTICE}
           AND EXISTS (
             SELECT 1 FROM studentprogressquestions q
             WHERE q.studentprogressid = sp.studentprogressid
           )`,
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE studentprogress sp
         JOIN studentprogress_practicepass_bak b ON b.studentprogressid = sp.studentprogressid
         SET sp.ispass = b.ispass,
             sp.resultpercentage = b.resultpercentage,
             sp.marks = b.marks`,
        { transaction },
      );
    });
    await queryInterface.sequelize.query(`DROP TABLE studentprogress_practicepass_bak`);
  },
};
