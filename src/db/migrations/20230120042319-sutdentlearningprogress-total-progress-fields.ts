import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.addColumn(
            "studentlearningsprogress",
            "progress_percentage",
            {
              type: DataTypes.DOUBLE,
              allowNull: true,
            },
            {
              transaction: transaction,
            }
          );
          return await queryInterface.addColumn(
            "studentlearningsprogress",
            "content_length",
            {
              type: DataTypes.INTEGER.UNSIGNED,
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
          await queryInterface.removeColumn("studentlearningsprogress", "progress_percentage", {
            transaction,
          });
          return await queryInterface.removeColumn("studentlearningsprogress", "content_length", {
            transaction,
          });
        }
    )
};