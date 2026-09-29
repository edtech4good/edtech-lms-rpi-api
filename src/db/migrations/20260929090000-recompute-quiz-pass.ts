import { QueryInterface, Transaction } from "sequelize";

/**
 * Recompute marks, resultpercentage and ispass for existing lesson-quiz,
 * level-quiz and baseline attempts (studentprogress rows with progresstype
 * IN (2, 3, 4) — LESSONQUIZ, LEVELQUIZ, BASELINEQUESTION in
 * src/models/enums/progress.enum.ts), following the precedent set by
 * 20260926090000-recompute-practice-pass.ts for lesson-practice rows.
 *
 * The old rule was `correct answers / submitted answers * 100`, pass at 80.
 * The Expo client only submits the answers the learner got right, so a
 * submission of one correct item was stored as 100% and passed, and
 * duplicate items for one question could inflate the count further.
 *
 * New rule (src/business/quizscore.ts): marks = DISTINCT correct answers
 * (studentprogressquestions.iscorrect = 1) whose referencequestionid is an
 * ACTIVE question of the activity AND whose templatetypeid has a tablet
 * renderer (NOT IN 9-17 — UNRENDERED_TEMPLATE_TYPES in
 * src/models/enums/constant.enum.ts: keep this list in sync);
 * resultpercentage = ROUND(LEAST(100, marks * 100 / activecount), 2);
 * ispass = percentage >= 80. UNLIKE practice, an activity with NO active
 * (renderable) questions is recomputed to marks 0 / percentage 0 / NOT
 * pass — a pass here is sticky (ResultBusiness.ispass short-circuits every
 * later submission) and feeds activity "done" state, calculatescore,
 * level_quiz_scores, reports and quiz certificates, so a historical row
 * that passed on nothing to score against must not keep counting.
 *
 * Only attempts that HAVE studentprogressquestions rows are recomputed, for
 * the same reason as the practice migration: the roster import writes rows
 * with no answer rows, and there is nothing stored to score them against.
 * Those rows are left exactly as they are (still copied to the backup
 * table).
 *
 * Points, fullpoints, scores and the lesson/level/grade progress tables are
 * NOT touched — the pass flag never fed them (matching the practice
 * precedent).
 *
 * The previous values of every lesson-quiz/level-quiz/baseline row are
 * copied to studentprogress_quizpass_bak first, and `down` restores from
 * it. The CREATE fails if the backup table already exists, so a second run
 * cannot overwrite the only copy of the original values (this also makes a
 * repeat `up` a no-op that errors loudly rather than silently double
 * -applying). CREATE TABLE ... SELECT is DDL and commits implicitly in
 * MySQL, so it runs before the transaction; if the UPDATE then fails, drop
 * the (unused) backup table before retrying.
 */
const LESSONQUIZ = 2; // Progress.LESSONQUIZ
const LEVELQUIZ = 3; // Progress.LEVELQUIZ
const BASELINEQUESTION = 4; // Progress.BASELINEQUESTION

// Keep in sync with UNRENDERED_TEMPLATE_TYPES in
// src/models/enums/constant.enum.ts.
const UNRENDERED_TEMPLATE_TYPES_SQL = "(9,10,11,12,13,14,15,16,17)";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(
      `CREATE TABLE studentprogress_quizpass_bak (PRIMARY KEY (studentprogressid)) AS
       SELECT studentprogressid, ispass, resultpercentage, marks
       FROM studentprogress
       WHERE progresstype IN (${LESSONQUIZ}, ${LEVELQUIZ}, ${BASELINEQUESTION})`,
    );
    await queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Lesson quiz.
      await queryInterface.sequelize.query(
        `UPDATE studentprogress sp
         LEFT JOIN (
           SELECT lqq.lessonquizid, COUNT(*) AS activecount
           FROM lessonquizquestions lqq
           JOIN questions q ON q.questionid = lqq.questionid
            AND q.templatetypeid NOT IN ${UNRENDERED_TEMPLATE_TYPES_SQL}
           WHERE lqq.lessonquizquestionstatus = 1
           GROUP BY lqq.lessonquizid
         ) a ON a.lessonquizid = sp.studentprogressreferenceid
         LEFT JOIN (
           SELECT spq.studentprogressid, lqq.lessonquizid,
                  COUNT(DISTINCT spq.referencequestionid) AS correctcount
           FROM studentprogressquestions spq
           JOIN lessonquizquestions lqq
             ON lqq.lessonquizquestionid = spq.referencequestionid
            AND lqq.lessonquizquestionstatus = 1
           JOIN questions q ON q.questionid = lqq.questionid
            AND q.templatetypeid NOT IN ${UNRENDERED_TEMPLATE_TYPES_SQL}
           WHERE spq.iscorrect = 1
           GROUP BY spq.studentprogressid, lqq.lessonquizid
         ) c ON c.studentprogressid = sp.studentprogressid
            AND c.lessonquizid = sp.studentprogressreferenceid
         SET sp.marks = IF(COALESCE(a.activecount, 0) = 0, 0, COALESCE(c.correctcount, 0)),
             sp.resultpercentage = IF(COALESCE(a.activecount, 0) = 0, 0,
               ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2)),
             sp.ispass = IF(COALESCE(a.activecount, 0) = 0, 0,
               ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2) >= 80)
         WHERE sp.progresstype = ${LESSONQUIZ}
           AND EXISTS (
             SELECT 1 FROM studentprogressquestions spq
             WHERE spq.studentprogressid = sp.studentprogressid
           )`,
        { transaction },
      );

      // Level quiz.
      await queryInterface.sequelize.query(
        `UPDATE studentprogress sp
         LEFT JOIN (
           SELECT lvq.levelid, COUNT(*) AS activecount
           FROM levelquizquestions lvq
           JOIN questions q ON q.questionid = lvq.questionid
            AND q.templatetypeid NOT IN ${UNRENDERED_TEMPLATE_TYPES_SQL}
           WHERE lvq.levelquizquestionstatus = 1
           GROUP BY lvq.levelid
         ) a ON a.levelid = sp.studentprogressreferenceid
         LEFT JOIN (
           SELECT spq.studentprogressid, lvq.levelid,
                  COUNT(DISTINCT spq.referencequestionid) AS correctcount
           FROM studentprogressquestions spq
           JOIN levelquizquestions lvq
             ON lvq.levelquizquestionid = spq.referencequestionid
            AND lvq.levelquizquestionstatus = 1
           JOIN questions q ON q.questionid = lvq.questionid
            AND q.templatetypeid NOT IN ${UNRENDERED_TEMPLATE_TYPES_SQL}
           WHERE spq.iscorrect = 1
           GROUP BY spq.studentprogressid, lvq.levelid
         ) c ON c.studentprogressid = sp.studentprogressid
            AND c.levelid = sp.studentprogressreferenceid
         SET sp.marks = IF(COALESCE(a.activecount, 0) = 0, 0, COALESCE(c.correctcount, 0)),
             sp.resultpercentage = IF(COALESCE(a.activecount, 0) = 0, 0,
               ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2)),
             sp.ispass = IF(COALESCE(a.activecount, 0) = 0, 0,
               ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2) >= 80)
         WHERE sp.progresstype = ${LEVELQUIZ}
           AND EXISTS (
             SELECT 1 FROM studentprogressquestions spq
             WHERE spq.studentprogressid = sp.studentprogressid
           )`,
        { transaction },
      );

      // Baseline.
      await queryInterface.sequelize.query(
        `UPDATE studentprogress sp
         LEFT JOIN (
           SELECT bq.curriculumbaselineid, COUNT(*) AS activecount
           FROM baselinequestion bq
           JOIN questions q ON q.questionid = bq.questionid
            AND q.templatetypeid NOT IN ${UNRENDERED_TEMPLATE_TYPES_SQL}
           WHERE bq.baselinequestionstatus = 1
           GROUP BY bq.curriculumbaselineid
         ) a ON a.curriculumbaselineid = sp.studentprogressreferenceid
         LEFT JOIN (
           SELECT spq.studentprogressid, bq.curriculumbaselineid,
                  COUNT(DISTINCT spq.referencequestionid) AS correctcount
           FROM studentprogressquestions spq
           JOIN baselinequestion bq
             ON bq.baselinequestionid = spq.referencequestionid
            AND bq.baselinequestionstatus = 1
           JOIN questions q ON q.questionid = bq.questionid
            AND q.templatetypeid NOT IN ${UNRENDERED_TEMPLATE_TYPES_SQL}
           WHERE spq.iscorrect = 1
           GROUP BY spq.studentprogressid, bq.curriculumbaselineid
         ) c ON c.studentprogressid = sp.studentprogressid
            AND c.curriculumbaselineid = sp.studentprogressreferenceid
         SET sp.marks = IF(COALESCE(a.activecount, 0) = 0, 0, COALESCE(c.correctcount, 0)),
             sp.resultpercentage = IF(COALESCE(a.activecount, 0) = 0, 0,
               ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2)),
             sp.ispass = IF(COALESCE(a.activecount, 0) = 0, 0,
               ROUND(LEAST(100, COALESCE(c.correctcount, 0) * 100 / a.activecount), 2) >= 80)
         WHERE sp.progresstype = ${BASELINEQUESTION}
           AND EXISTS (
             SELECT 1 FROM studentprogressquestions spq
             WHERE spq.studentprogressid = sp.studentprogressid
           )`,
        { transaction },
      );
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE studentprogress sp
         JOIN studentprogress_quizpass_bak b ON b.studentprogressid = sp.studentprogressid
         SET sp.ispass = b.ispass,
             sp.resultpercentage = b.resultpercentage,
             sp.marks = b.marks`,
        { transaction },
      );
    });
    await queryInterface.sequelize.query(`DROP TABLE studentprogress_quizpass_bak`);
  },
};
