import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studentlessonsprogress",
        {
          studentlessonprogressid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          studentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          lessonid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          levelid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          gradeid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          curid: {
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
        "studentlessonsprogress",
        ["studentid", "lessonid", "levelid", "gradeid", "curid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studentlessonsprogress", { transaction });
    }),
};
