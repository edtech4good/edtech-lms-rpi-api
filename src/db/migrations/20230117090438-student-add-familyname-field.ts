import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          return await queryInterface.addColumn(
            "students",
            "familyname",
            {
              type: DataTypes.STRING(255),
              allowNull: true,
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
          return await queryInterface.removeColumn("students", "familyname", {
            transaction,
          });
        }
    )
};