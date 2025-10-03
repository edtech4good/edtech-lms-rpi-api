import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "lessons",
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
        "lessons",
        "learning_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "lessons",
        "quizzes_points",
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
        "lessons",
        "practices_points",
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
      await queryInterface.removeColumn("lessons", "learning_points", {
        transaction,
      });
      await queryInterface.removeColumn("lessons", "quizzes_points", {
        transaction,
      });
      return await queryInterface.removeColumn("lessons", "practices_points", {
        transaction,
      });
    }),
};
