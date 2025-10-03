import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration changes
      await queryInterface.addColumn(
        "questions",
        "questioncorrectvalue",
        {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: null,
        },
        {
          transaction: transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.removeColumn("questions", "questioncorrectvalue", {
        transaction,
      });
    }),
};
