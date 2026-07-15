import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(
        queryInterface,
        "studentprogress",
        "marks",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "lessonlearnings",
        "points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "lessons",
        "brick_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "lessons",
        "total_points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("studentprogress", "marks", {
        transaction,
      });
      await queryInterface.removeColumn("lessonlearnings", "points", {
        transaction,
      });
      await queryInterface.removeColumn("lessons", "brick_points", {
        transaction,
      });
      await queryInterface.removeColumn("lessons", "total_points", {
        transaction,
      });
    }),
};
