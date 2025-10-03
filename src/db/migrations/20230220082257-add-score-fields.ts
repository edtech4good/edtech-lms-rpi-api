import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.addColumn(
            "studentprogress",
            "scores",
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
            "scores",
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
            "studentlessonsprogress",
            "added_completed_scores",
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
            "studentlessonsprogress",
            "scores",
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
            "studentlevelsprogress",
            "scores",
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
            "studentlevelsprogress",
            "added_default_score",
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
            "studentgradesprogress",
            "scores",
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
          await queryInterface.removeColumn("studentprogress", "scores", {
            transaction,
          });
          await queryInterface.removeColumn("studentpoints", "scores", {
            transaction,
          });
          await queryInterface.removeColumn("studentlessonsprogress", "scores", {
            transaction,
          });
          await queryInterface.removeColumn("studentlessonsprogress", "added_completed_scores", {
            transaction,
          });
          await queryInterface.removeColumn("studentlevelsprogress", "added_default_score", {
            transaction,
          });
          await queryInterface.removeColumn("studentlevelsprogress", "scores", {
            transaction,
          });
          await queryInterface.removeColumn("studentgradesprogress", "scores", {
            transaction,
          });
        }
    )
};