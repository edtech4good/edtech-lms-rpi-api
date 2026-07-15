import { QueryInterface, DataTypes } from "sequelize";
import { tableNameList } from "../migration-helpers";

/**
 * `20221220143728-countries-schools` alters `schools` and expects it to exist.
 *
 * `expectedcontribution` and `expectedusage` are declared here even though they
 * look like they belong to `20230407050046-create-schools-table`. That migration
 * is the only other place they are defined, and it early-returns once `schools`
 * exists — which this baseline guarantees. Without them, models/data-models/school.ts
 * still selects both columns and every School query fails with ER_BAD_FIELD_ERROR.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const names = await tableNameList(queryInterface);
    if (names.includes("schools")) {
      return;
    }
    await queryInterface.createTable(
      "schools",
      {
        schoolid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        schoolname: {
          type: DataTypes.STRING(45),
          allowNull: false,
          unique: true,
        },
        expectedcontribution: {
          type: DataTypes.DOUBLE.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        expectedusage: {
          type: DataTypes.DOUBLE.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 0,
        },
      },
      {
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      },
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("schools");
  },
};
