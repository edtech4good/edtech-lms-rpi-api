import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "students",
        "type",
        {
          type: DataTypes.STRING(10),
          allowNull: true,
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addColumn(
        "students",
        "profileimage",
        {
          type: DataTypes.STRING(250),
          allowNull: true,
        },
        {
          transaction: transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.removeColumn("students", "type", {
        transaction,
      });
      return await queryInterface.removeColumn("students", "profileimage", {
        transaction,
      });
    }),
};
