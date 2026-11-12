import { DataTypes, literal, QueryInterface, Transaction } from "sequelize";
import { tableNameList } from "../migration-helpers";

/**
 * `studentawards`: a learner's lasting award for completing a level (one per learner per level, ever).
 *
 * Written by the result routes in the same transaction as the level progress, and never updated or deleted by
 * them. `earnedat_approximate` is 1 on an award the backfill (20261111110100) made from a progress row's
 * `lastupdated`, because the day the level was completed is not recorded.
 *
 * Idempotent: a second run finds the table and does nothing. `down` drops the table.
 */
const TABLE = "studentawards";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      if ((await tableNameList(queryInterface)).includes(TABLE)) {
        return;
      }
      await queryInterface.createTable(
        TABLE,
        {
          studentawardid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          studentid: { type: DataTypes.STRING(36), allowNull: false },
          levelid: { type: DataTypes.STRING(36), allowNull: false },
          gradeid: { type: DataTypes.STRING(36), allowNull: false },
          curid: { type: DataTypes.STRING(36), allowNull: false },
          earnedat: { type: DataTypes.DATE, allowNull: false },
          earnedat_approximate: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          lastupdated: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: literal("CURRENT_TIMESTAMP"),
          },
        },
        { charset: "utf8mb4", collate: "utf8mb4_unicode_ci", transaction },
      );
      await queryInterface.addIndex(TABLE, ["studentid", "levelid"], {
        name: "uq_studentawards_student_level",
        unique: true,
        transaction,
      });
      await queryInterface.addIndex(TABLE, ["studentid"], { name: "idx_studentawards_studentid", transaction });
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await queryInterface.dropTable(TABLE, { transaction });
    }),
};
