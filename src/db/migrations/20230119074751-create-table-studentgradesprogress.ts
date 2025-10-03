import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studentgradesprogress",
        {
          studentgradeprogressid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          studentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          curriculumid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          gradeid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          progress: {
            type: DataTypes.DOUBLE,
            allowNull: true,
            defaultValue: 0,
          },
          points: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: 0,
          },
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "studentgradesprogress",
        ["studentid", "gradeid", "curriculumid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studentgradesprogress", { transaction });
    }),
};
