import { QueryInterface, DataTypes } from "sequelize";
import { tableNameList, tableOptionsMatchingCurriculums } from "../migration-helpers";

/**
 * `20230525030229-add-baseline-fields` alters `curriculumbaseline` but the table was never created.
 * Minimal row shape: id + curriculum + baseline; other columns come from the next migration.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const names = await tableNameList(queryInterface);
    if (names.includes("curriculumbaseline")) {
      return;
    }
    const charset = await tableOptionsMatchingCurriculums(queryInterface);
    await queryInterface.createTable(
      "curriculumbaseline",
      {
        curriculumbaselineid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
        curriculumid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: { model: "curriculums", key: "curriculumid" },
        },
        baselineid: { type: DataTypes.STRING(36), allowNull: false },
      },
      charset,
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("curriculumbaseline");
  },
};
