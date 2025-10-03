import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.addColumn(
            "curriculumbaseline",
            "baselinename",
            {
              type: DataTypes.STRING(36),
              allowNull: true,
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "curriculumbaseline",
            "baselinetype",
            {
              type: DataTypes.TINYINT,
              allowNull: true,
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "curriculumbaseline",
            "baselinestatus",
            {
              type: DataTypes.BOOLEAN,
              allowNull: true,
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "curriculumbaseline",
            "startdate",
            {
              type: DataTypes.DATE,
              allowNull: true,
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "curriculumbaseline",
            "enddate",
            {
              type: DataTypes.DATE,
              allowNull: true,
            },
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "curriculumbaseline",
            "schoolid",
            {
              type: DataTypes.JSON,
              allowNull: true,
            }, 
            {
              transaction: transaction,
            }
          );
          await queryInterface.addColumn(
            "curriculumbaseline",
            "isdeleted",
            {
              type: DataTypes.BOOLEAN,
              allowNull: false,
              defaultValue: 0,
            }
          )
        }
    ),

    down: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration undo changes
          await queryInterface.removeColumn("curriculumbaseline", "baselinename", {
            transaction,
          });
          await queryInterface.removeColumn("curriculumbaseline", "baselinetype", {
            transaction,
          });
          await queryInterface.removeColumn("curriculumbaseline", "baselinestatus", {
            transaction,
          });
          await queryInterface.removeColumn("curriculumbaseline", "startdate", {
            transaction,
          });
          await queryInterface.removeColumn("curriculumbaseline", "enddate", {
            transaction,
          });
          await queryInterface.removeColumn("curriculumbaseline", "schoolid", {
            transaction,
          });
          await queryInterface.removeColumn("curriculumbaseline", "isdeleted", {
            transaction,
          });
        }
    )
};