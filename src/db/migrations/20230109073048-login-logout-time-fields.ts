import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.addColumn('rpiuseraccess', 'logouttime', {
            type: DataTypes.DATE,
            allowNull: true,
          }, {
            transaction: transaction,
          });
          await queryInterface.addColumn('rpiuseraccess', 'timespent', {
            type: DataTypes.DECIMAL,
            allowNull: true,
            defaultValue: 0,
          }, {
            transaction: transaction,
          });
          await queryInterface.addColumn('rpiuseraccess', 'status', {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
          }, {
            transaction: transaction,
          });
        }
    ),

    down: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration undo changes
          await queryInterface.removeColumn('rpiuseraccess', 'logouttime', { transaction });
          await queryInterface.removeColumn('rpiuseraccess', 'timespent', { transaction });
          await queryInterface.removeColumn('rpiuseraccess', 'status', { transaction });
        }
    )
};