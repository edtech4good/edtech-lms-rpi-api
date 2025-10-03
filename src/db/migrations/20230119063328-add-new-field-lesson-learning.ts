import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "studentprogress",
        "marks",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "lessonlearnings",
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
      await queryInterface.addColumn(
        "lessons",
        "brick_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addColumn(
        "lessons",
        "total_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        {
          transaction: transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.removeColumn("studentprogress", "marks", {
        transaction,
      });
      await queryInterface.removeColumn("lessonlearnings", "points", {
        transaction,
      });
      await queryInterface.removeColumn("lessons", "brick_points", {
        transaction,
      });
      return await queryInterface.removeColumn("lessons", "total_points", {
        transaction,
      });
    }),
};
