import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

/**
 * Mirror of the central API's per-school theme fields on `schools`.
 *
 * `uitheme` drives which UI (kids vs. corporate) the Expo app renders for a
 * school; `brandingconfig` carries optional corporate branding overrides.
 * Existing rows default to 'kids' so nothing changes for schools that never
 * opted into corporate branding.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(
        queryInterface,
        "schools",
        "uitheme",
        {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: "kids",
        },
        transaction,
      );

      await addColumnIfMissing(
        queryInterface,
        "schools",
        "brandingconfig",
        {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      for (const column of ["uitheme", "brandingconfig"]) {
        await queryInterface.removeColumn("schools", column, { transaction });
      }
    }),
};
