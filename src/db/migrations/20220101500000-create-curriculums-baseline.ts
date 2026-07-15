import { QueryInterface, DataTypes } from "sequelize";
import { tableNameList } from "../migration-helpers";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const names = await tableNameList(queryInterface);
    if (names.includes("curriculums")) {
      return;
    }
    await queryInterface.createTable(
      "curriculums",
      {
        curriculumid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        curriculumname: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        curriculumstatus: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        curriculumdescription: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        subjectid: {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
      },
      {
        charset: "utf8mb4",
        collate: "utf8mb4_unicode_ci",
      },
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("curriculums");
  },
};
