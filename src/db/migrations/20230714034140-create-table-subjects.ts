import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing, tableNameList, tableOptionsMatchingCurriculums } from "../migration-helpers";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      const charset = await tableOptionsMatchingCurriculums(queryInterface);
      const now = queryInterface.sequelize.Sequelize.fn("NOW");

      if (!names.includes("subjects")) {
        await queryInterface.createTable(
          "subjects",
          {
            subjectid: {
              type: DataTypes.STRING(36),
              allowNull: false,
              primaryKey: true,
            },
            subjectname: {
              type: DataTypes.STRING(250),
              allowNull: false,
            },
            subjectstatus: {
              type: DataTypes.BOOLEAN,
              allowNull: false,
              defaultValue: true,
            },
            subjectdescription: {
              type: DataTypes.TEXT,
              allowNull: true,
            },
            isdeleted: {
              type: DataTypes.BOOLEAN,
              allowNull: false,
              defaultValue: false,
            },
            created_at: {
              type: "TIMESTAMP",
              defaultValue: now,
              allowNull: true,
            },
            created_by: {
              type: DataTypes.STRING(36),
              allowNull: true,
            },
            updated_at: {
              type: "TIMESTAMP",
              defaultValue: now,
              allowNull: true,
            },
            updated_by: {
              type: DataTypes.STRING(36),
              allowNull: true,
            },
            deleted_at: {
              type: "TIMESTAMP",
              allowNull: true,
            },
            deleted_by: {
              type: DataTypes.STRING(36),
              allowNull: true,
            },
          },
          { ...charset, transaction },
        );
      }

      await addColumnIfMissing(
        queryInterface,
        "curriculums",
        "subjectid",
        {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "students",
        "curriculumids",
        {
          type: DataTypes.JSON,
          allowNull: true,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable("subjects", { transaction });
      await queryInterface.removeColumn("curriculums", "subjectid", {
        transaction,
      });
      await queryInterface.removeColumn("students", "curriculumids", {
        transaction,
      });
    }),
};
