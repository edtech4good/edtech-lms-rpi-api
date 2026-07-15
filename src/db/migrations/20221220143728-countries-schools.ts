import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> =>
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "countries",
        {
          countryid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          countryname: {
            type: DataTypes.STRING(45),
            unique: true,
            allowNull: false,
          },
          isdeleted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: 0,
          },
        },
        {
          charset: "utf8mb4",
          collate: "utf8mb4_unicode_ci",
          transaction: transaction,
        },
      );
      await queryInterface.addColumn(
        "schools",
        "curriculums",
        {
          type: DataTypes.JSON,
          allowNull: false,
        },
        {
          transaction: transaction,
        },
      );
      return await queryInterface.addColumn(
        "schools",
        "countryid",
        {
          type: DataTypes.STRING(36),
          allowNull: true,
          references: {
            model: "countries",
            key: "countryid",
          },
          onUpdate: "CASCADE",
          onDelete: "SET NULL",
          defaultValue: null,
        },
        {
          transaction: transaction,
        },
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("schools", "curriculums", { transaction });
      await queryInterface.removeColumn("schools", "countryid", { transaction });
      await queryInterface.dropTable("countries", { transaction });
    }),
};
