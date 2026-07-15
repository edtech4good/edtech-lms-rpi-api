import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(
        queryInterface,
        "studentprogress",
        "resultpercentage",
        {
          type: DataTypes.DOUBLE,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "studentprogress",
        "points",
        {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "studentprogress",
        "fullpoints",
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
      await queryInterface.removeColumn("studentprogress", "resultpercentage", {
        transaction,
      });
      await queryInterface.removeColumn("studentprogress", "points", {
        transaction,
      });
      await queryInterface.removeColumn("studentprogress", "fullpoints", {
        transaction,
      });
    }),
};
