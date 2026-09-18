import { QueryInterface, Transaction } from "sequelize";

/**
 * Recompute studentlessonsprogress.completed for existing rows.
 *
 * The completion rule changed from "progress strictly greater than 80%" to
 * "accumulated points reach the lesson's own pass mark" (lessons.passing_points,
 * falling back to 80% of total_points for older content without a
 * passing_points value). Under the old rule a student who reached exactly
 * the pass mark (e.g. 80/100 when the lesson's video is missing and its 20
 * points are unreachable) was permanently stuck at "not complete" because
 * 80 is not strictly greater than 80. This migration recomputes `completed`
 * for every existing row under the new rule so those students become
 * complete without resubmitting anything.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE studentlessonsprogress p
         JOIN lessons l ON l.lessonid = p.lessonid
         SET p.completed = (
           COALESCE(p.points, 0) >= COALESCE(NULLIF(l.passing_points, 0), CEIL(l.total_points * 80 / 100))
         )
         WHERE l.total_points > 0`,
        { transaction },
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE studentlessonsprogress p
         JOIN lessons l ON l.lessonid = p.lessonid
         SET p.completed = ((COALESCE(p.points, 0) * 100 / l.total_points) > 80)
         WHERE l.total_points > 0`,
        { transaction },
      );
    }),
};
