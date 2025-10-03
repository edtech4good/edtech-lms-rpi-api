import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "levels",
        "passing_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "levels",
        "quiz_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addColumn(
        "levels",
        "points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        {
          transaction: transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.removeColumn("levels", "quiz_points", {
        transaction,
      });
      return await queryInterface.removeColumn("levels", "points", {
        transaction,
      });
    }),
};
