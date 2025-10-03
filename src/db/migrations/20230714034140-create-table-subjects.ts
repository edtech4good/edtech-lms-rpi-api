import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
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
            defaultValue: 1,
          },
          subjectdescription: {
            type: DataTypes.TEXT,
            allowNull: true,
          },
          isdeleted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: 0,
          },
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "curriculums",
        "subjectid",
        {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "students",
        "curriculumids",
        {
          type: DataTypes.JSON,
          allowNull: true,
        },
        {
          transaction: transaction,
        }
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
