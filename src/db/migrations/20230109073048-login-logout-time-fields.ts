import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(
        queryInterface,
        "rpiuseraccess",
        "logouttime",
        {
          type: DataTypes.DATE,
          allowNull: true,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "rpiuseraccess",
        "timespent",
        {
          type: DataTypes.DECIMAL,
          allowNull: true,
          defaultValue: 0,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "rpiuseraccess",
        "status",
        {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("rpiuseraccess", "logouttime", { transaction });
      await queryInterface.removeColumn("rpiuseraccess", "timespent", { transaction });
      await queryInterface.removeColumn("rpiuseraccess", "status", { transaction });
    }),
};
