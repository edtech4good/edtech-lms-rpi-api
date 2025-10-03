import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "studentlearningsprogress",
        {
          studentlearningprogressid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          studentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: {
              model: "students",
              key: "studentid",
            },
          },
          userid: {
            type: DataTypes.STRING(36),
            allowNull: true,
          },
          lessonlearningid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            // references: {
            //   model: "lessonlearnings",
            //   key: "lessonlearningid",
            // },
            // onDelete: 'NO ACTION'
          },
          progress: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: 0,
          },
          viewed: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: 0,
          },
          lastupdated: {
            type: DataTypes.DATE,
            defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
            allowNull: true
          },
        },
        {
          // charset: "utf8mb4",
          // collate: "utf8mb4_0900_ai_ci",
          transaction: transaction,
        }
      );
      return await queryInterface.addIndex(
        "studentlearningsprogress",
        ["studentid", "lessonlearningid"],
        {
          transaction,
        }
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      // here go all migration undo changes
      await queryInterface.dropTable("studentlearningsprogress", {
        transaction,
      });
    }),
};
