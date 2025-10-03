import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studentactives",
        {
          studentactiveid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          studentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          referenceid: {
            type: DataTypes.STRING(36),
            allowNull: false,
          },
          referencetype: {
            type: DataTypes.TINYINT,
            allowNull: false,
          },
          created_at: {
            type: DataTypes.DATE,
            defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
            allowNull: true
          },
        },
        {
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "studentactives",
        ["studentid", "referenceid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studentactives", { transaction });
    }),
};
