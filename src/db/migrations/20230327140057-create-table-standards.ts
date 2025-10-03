import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "standards",
        {
          standardid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true
          },
          standardname: {
            type: DataTypes.STRING(45),
            allowNull: false
          },
          schoolname: {
            type: DataTypes.STRING(255),
            allowNull: true
          },
          schoolid: {
            type: DataTypes.STRING(36),
            allowNull: true
          },
          isdeleted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: 0
          },
          created_at: {
            type: DataTypes.DATE,
            allowNull: true
          },
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "standards",
        ["standardid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("standards", { transaction });
    }),
};
