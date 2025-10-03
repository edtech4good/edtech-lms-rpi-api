import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "schools",
        {
          schoolid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true
          },
          schoolname: {
            type: DataTypes.STRING(45),
            allowNull: false,
            unique: true
          },
          expectedcontribution: {
            type: DataTypes.DOUBLE.UNSIGNED,
            allowNull: true,
            defaultValue: null
          },
          expectedusage: {
            type: DataTypes.DOUBLE.UNSIGNED,
            allowNull: true,
            defaultValue: null
          },
          countryid: {
            type: DataTypes.STRING(36),
            allowNull: true,
            references: {
              model: 'countries',
              key: 'countryid'
            }
          },
          curriculums: {
            type: DataTypes.JSON,
            allowNull: true,
          },
          isdeleted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: 0
          },
        },
        {
          charset: 'utf8mb4',
          collate: 'utf8mb4_0900_ai_ci',
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "schools",
        ["schoolid", "countryid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("schools", { transaction });
    }),
};
