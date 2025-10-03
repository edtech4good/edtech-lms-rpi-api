import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studentpoints",
        {
          studentpointid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          studentid: {
              type: DataTypes.STRING(36),
              allowNull: false,
          },
          levelid: {
              type: DataTypes.STRING(36),
              allowNull: false,
          },
          lessonid: {
              type: DataTypes.STRING(36),
              allowNull: false,
          },
          gradepoints: {
              type: DataTypes.DOUBLE,
              allowNull: false,
          },
          levelpoints: {
              type: DataTypes.DOUBLE,
              allowNull: false,
          },
          levelquizscores: {
              type: DataTypes.INTEGER.UNSIGNED,
              allowNull: false,
          },
          lessonpoints: {
              type: DataTypes.DOUBLE,
              allowNull: false,
          },
          learningpoints: {
              type: DataTypes.DOUBLE,
              allowNull: false,
          },
          practicepoints: {
              type: DataTypes.DOUBLE,
              allowNull: false,
          },
          quizpoints: {
              type: DataTypes.DOUBLE,
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
        "studentpoints",
        ["studentid", "lessonid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studentpoints", { transaction });
    }),
};
