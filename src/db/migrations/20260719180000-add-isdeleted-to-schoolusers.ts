import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

/**
 * `isdeleted` on this DB's `schoolusers` (`edtech_lms_rpi`), so the student-API
 * login can refuse a soft-deleted learner. The central API added the same column
 * to its own `edtech_lms.schoolusers` (edtech-lms-api#18) — but these are
 * SEPARATE databases, so this API needs its own column. The soft-delete flag
 * propagates here through the existing student import/sync (its `exclude: []`
 * export already carries every column; the import's `updateOnDuplicate` list is
 * extended to include `isdeleted` in the same change).
 *
 * NOT NULL DEFAULT false so every existing synced learner reads as not-deleted.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) =>
      addColumnIfMissing(
        queryInterface,
        "schoolusers",
        "isdeleted",
        {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        transaction,
      ),
    ),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("schoolusers", "isdeleted", { transaction });
    }),
};
