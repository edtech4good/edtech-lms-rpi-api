import { QueryInterface, DataTypes } from "sequelize";
import { tableNameList, tableOptionsMatchingCurriculums } from "../migration-helpers";

/**
 * `rpiuseraccess` is altered by `20230109073048-login-logout-time-fields` but was never created earlier.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const names = await tableNameList(queryInterface);
    if (names.includes("rpiuseraccess")) {
      return;
    }
    const charset = await tableOptionsMatchingCurriculums(queryInterface);
    await queryInterface.createTable(
      "rpiuseraccess",
      {
        rpiuseraccessid: { type: DataTypes.STRING(45), allowNull: false, primaryKey: true },
        userid: { type: DataTypes.STRING(45), allowNull: false },
        logintime: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
        },
        ipaddress: { type: DataTypes.STRING(45), allowNull: false },
      },
      charset,
    );
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable("rpiuseraccess");
  },
};
