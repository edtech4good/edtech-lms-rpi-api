import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studentappusages",
        {
          studentappusageid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          schooluserid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          time_spent: {
            type: DataTypes.DOUBLE,
            allowNull: false,
            defaultValue: 0,
          },
          last_updated: {
            type: DataTypes.DATE,
            defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
            allowNull: true
          },
          created_at: {
            type: DataTypes.DATE,
            defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
            allowNull: true
          },
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "studentappusages",
        ["studentappusageid", "schooluserid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studentappusages", { transaction });
    }),
};
