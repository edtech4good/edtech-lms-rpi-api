import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.addColumn(
            "studentpoints",
            "totalgradepoints",
            {
              type: DataTypes.INTEGER.UNSIGNED,
              allowNull: true,
              defaultValue: null
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "studentpoints",
            "totallevelpoints",
            {
              type: DataTypes.INTEGER.UNSIGNED,
              allowNull: true,
              defaultValue: null
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "studentpoints",
            "totallearningpoints",
            {
              type: DataTypes.INTEGER.UNSIGNED,
              allowNull: true,
              defaultValue: null
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "studentpoints",
            "totalpracticepoints",
            {
              type: DataTypes.INTEGER.UNSIGNED,
              allowNull: true,
              defaultValue: null
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "studentpoints",
            "totalquizpoints",
            {
              type: DataTypes.INTEGER.UNSIGNED,
              allowNull: true,
              defaultValue: null
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
          await queryInterface.removeColumn("studentpoints", "totalgradepoints", {
            transaction,
          });
          await queryInterface.removeColumn("studentpoints", "totallevelpoints", {
            transaction,
          });
          await queryInterface.removeColumn("studentpoints", "totallearningpoints", {
            transaction,
          });
          await queryInterface.removeColumn("studentpoints", "totalpracticepoints", {
            transaction,
          });
          await queryInterface.removeColumn("studentpoints", "totalquizpoints", {
            transaction,
          });
        }
    )
};