import { QueryInterface, DataTypes } from 'sequelize';

module.exports = {
    up: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
            return await queryInterface.createTable(
                "lessonplans",
                {
                  lessonplanid: {
                    type: DataTypes.STRING(36),
                    allowNull: false,
                    primaryKey: true
                  },
                  lessonplanname: {
                    type: DataTypes.STRING(250),
                    allowNull: false
                  },
                  lessonplandescription: {
                    type: DataTypes.TEXT,
                    allowNull: false
                  },
                  lessonplanstatus: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: 1
                  },
                  lessonid: {
                    type: DataTypes.STRING(36),
                    allowNull: false,
                  },
                  documentid: {
                    type: DataTypes.STRING(36),
                    allowNull: false,
                  },
                  lessonplanorder: {
                    type: DataTypes.INTEGER,
                    allowNull: false
                  },
                  points: {
                    type: DataTypes.INTEGER.UNSIGNED,
                    allowNull: true,
                    defaultValue: 0
                  },
                },
                {
                    transaction: transaction,
                }
            );
        }),

    down: (queryInterface: QueryInterface): Promise<void> => queryInterface.sequelize.transaction(
        async (transaction) => {
            await queryInterface.dropTable("lessonplans", { transaction });
        }
    )
};