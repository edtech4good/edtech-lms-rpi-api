import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.addColumn(
            "studentgradesprogress",
            "completed",
            {
              type: DataTypes.BOOLEAN,
              allowNull: true,
              defaultValue: 0
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "studentlevelsprogress",
            "completed",
            {
              type: DataTypes.BOOLEAN,
              allowNull: true,
              defaultValue: 0
            },
            {
              transaction: transaction,
            }
          );
          return await queryInterface.addColumn(
            "studentlessonsprogress",
            "completed",
            {
              type: DataTypes.BOOLEAN,
              allowNull: true,
              defaultValue: 0
            },
            {
              transaction: transaction,
            }
          );
        }
    ),

    down: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration undo changes
          await queryInterface.removeColumn("studentgradesprogress", "completed", {
            transaction,
          });
          await queryInterface.removeColumn("studentlevelsprogress", "completed", {
            transaction,
          });
          return await queryInterface.removeColumn("studentlessonsprogress", "completed", {
            transaction,
          });
        }
    )
};