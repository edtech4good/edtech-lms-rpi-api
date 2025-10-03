import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "countries",
        {
          countryid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true
          },
          countryname: {
            type: DataTypes.STRING(45),
            allowNull: false
          },
          expectedusage: {
            type: DataTypes.DOUBLE.UNSIGNED,
            allowNull: true,
            defaultValue: null
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
        "countries",
        ["countryid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("countries", { transaction });
    }),
};
