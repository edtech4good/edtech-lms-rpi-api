import { QueryInterface, DataTypes } from "sequelize";
import { tableNameList, tableOptionsMatchingCurriculums } from "../migration-helpers";

/**
 * `20230605034224-add-lessonid-to-levelquizquestionid` expects `levelquizquestions` to exist.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const names = await tableNameList(queryInterface);
    if (names.includes("levelquizquestions")) {
      return;
    }
    const charset = await tableOptionsMatchingCurriculums(queryInterface);
    await queryInterface.createTable(
      "levelquizquestions",
      {
        levelquizquestionid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
        levelid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: { model: "levels", key: "levelid" },
        },
        questionid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: { model: "questions", key: "questionid" },
        },
        levelquizquestionstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        levelquizquestionorder: { type: DataTypes.INTEGER, allowNull: false },
      },
      charset,
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("levelquizquestions");
  },
};
