import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "studentprogress",
        "resultpercentage",
        {
          type: DataTypes.DOUBLE,
          allowNull: true,
          defaultValue: null,
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "studentprogress",
        "points",
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
        "studentprogress",
        "fullpoints",
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
      queryInterface.removeColumn("studentprogress", "resultpercentage", {
        transaction,
      });
      queryInterface.removeColumn("studentprogress", "points", {
        transaction,
      });
      return await queryInterface.removeColumn("studentprogress", "fullpoints", {
        transaction,
      });
    }),
};
