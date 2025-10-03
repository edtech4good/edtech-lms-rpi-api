import { DataTypes, QueryInterface } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "studentgradesprogress",
        "lastupdated",
        {
          type: DataTypes.DATE,
          defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
          allowNull: true,
        },
        {
          transaction: transaction,
        }
      );
      await queryInterface.addColumn(
        "studentlevelsprogress",
        "lastupdated",
        {
          type: DataTypes.DATE,
          defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
          allowNull: true,
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addColumn(
        "studentlessonsprogress",
        "lastupdated",
        {
          type: DataTypes.DATE,
          defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
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
      await queryInterface.removeColumn("studentgradesprogress", "lastupdated", {
        transaction,
      });
      await queryInterface.removeColumn("studentlevelsprogress", "lastupdated", {
        transaction,
      });
      return await queryInterface.removeColumn("studentlessonsprogress", "lastupdated", {
        transaction,
      });
    }),
};
