import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studenttrash",
        {
          studenttrashid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          studentid: {
              type: DataTypes.STRING(36),
              allowNull: false,
          },
          gradeid: {
              type: DataTypes.STRING(36),
              allowNull: false,
          },
          trashtype: {
              type: DataTypes.TINYINT,
              allowNull: false,
          },
          totalprogress: {
            type: DataTypes.DOUBLE,
            allowNull: false,
            defaultValue: 0,
          },
          status: {
            type: DataTypes.TINYINT,
            allowNull: false,
            defaultValue: 1,
          },
          created_at: {
              type: DataTypes.DATE,
              defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
              allowNull: true
          },
        },
        {
          // charset: 'utf8mb4',
          // collate: 'utf8mb4_0900_ai_ci',
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "studenttrash",
        ["studenttrashid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studenttrash", { transaction });
    }),
};
