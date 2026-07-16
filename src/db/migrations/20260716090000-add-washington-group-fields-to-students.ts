import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

/**
 * Mirror of the central API's Washington Group Short Set fields on `students`.
 *
 * The pilot is online-only, so nothing here is exercised at go-live. It lands
 * now anyway: the classroom sync copies students onto the Pi with an explicit
 * column list, and a Pi whose table lacks these columns would drop disability
 * data silently — no error, just absent answers discovered later in a report.
 */
const WG_DOMAINS = [
  "wg_seeing",
  "wg_hearing",
  "wg_walking",
  "wg_remembering",
  "wg_selfcare",
  "wg_communicating",
];

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      for (const domain of WG_DOMAINS) {
        await addColumnIfMissing(
          queryInterface,
          "students",
          domain,
          {
            type: DataTypes.TINYINT,
            allowNull: true,
            defaultValue: null,
          },
          transaction,
        );
      }

      await addColumnIfMissing(
        queryInterface,
        "students",
        "wg_source",
        {
          type: DataTypes.TINYINT,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );

      await addColumnIfMissing(
        queryInterface,
        "students",
        "wg_collected_at",
        {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      for (const column of [...WG_DOMAINS, "wg_source", "wg_collected_at"]) {
        await queryInterface.removeColumn("students", column, { transaction });
      }
    }),
};
