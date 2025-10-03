import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration changes
          await queryInterface.createTable(
            "baselinequestion",
            {
              baselinequestionid: {
                  type: DataTypes.STRING(36),
                  allowNull: false,
                  primaryKey: true
              },
              curriculumbaselineid: {
                type: DataTypes.STRING(36),
                allowNull: true,
                defaultValue: null,
              },
              questionid: {
                type: DataTypes.STRING(36),
                allowNull: true,
                defaultValue: null,
              },
              baselinequestionstatus: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: 0,
              },
              baselinequestionorder:{
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1
              },
              isdeleted: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: 0
              },
            },
            {
                transaction: transaction,
            }
    )}
    ),

    down: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
          // here go all migration undo changes
          await queryInterface.dropTable("baselinequestion", { transaction });
        }
    )
};