import { QueryInterface, Transaction } from "sequelize";

/**
 * Recompute studentlevelsprogress.completed and studentgradesprogress.completed
 * for existing rows.
 *
 * The completion rule changed from "progress strictly greater than 80%" to
 * "progress greater than or equal to 80%" (progress >= COMPLETED_PERCENTAGE,
 * where COMPLETED_PERCENTAGE = 80). Under the old rule a student who reached
 * exactly 80% was permanently stuck at "not complete" because 80 is not
 * strictly greater than 80. This migration recomputes `completed` for every
 * existing row under the new rule so those students become complete without
 * resubmitting anything.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Recompute studentlevelsprogress: set completed = 1 where progress >= 80 and completed = 0
      // (only flip the exactly-80 rows; nothing else can differ between > and >=)
      await queryInterface.sequelize.query(
        `UPDATE studentlevelsprogress
         SET completed = (progress >= 80)
         WHERE progress >= 80 AND completed = 0`,
        { transaction },
      );

      // Recompute studentgradesprogress: set completed = 1 where progress >= 80 and completed = 0
      // (only flip the exactly-80 rows; nothing else can differ between > and >=)
      await queryInterface.sequelize.query(
        `UPDATE studentgradesprogress
         SET completed = (progress >= 80)
         WHERE progress >= 80 AND completed = 0`,
        { transaction },
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Restore strict rule for exactly-80 rows in studentlevelsprogress: set completed = 0 where progress = 80
      // Note: down cannot distinguish rows that became complete through other means at exactly 80; acceptable.
      await queryInterface.sequelize.query(
        `UPDATE studentlevelsprogress
         SET completed = 0
         WHERE progress = 80`,
        { transaction },
      );

      // Restore strict rule for exactly-80 rows in studentgradesprogress: set completed = 0 where progress = 80
      // Note: down cannot distinguish rows that became complete through other means at exactly 80; acceptable.
      await queryInterface.sequelize.query(
        `UPDATE studentgradesprogress
         SET completed = 0
         WHERE progress = 80`,
        { transaction },
      );
    }),
};
