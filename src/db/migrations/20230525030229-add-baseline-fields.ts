import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const t = "curriculumbaseline";
      await addColumnIfMissing(
        queryInterface,
        t,
        "baselinename",
        { type: DataTypes.STRING(36), allowNull: true },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        t,
        "baselinetype",
        { type: DataTypes.TINYINT, allowNull: true },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        t,
        "baselinestatus",
        { type: DataTypes.BOOLEAN, allowNull: true },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        t,
        "startdate",
        { type: DataTypes.DATE, allowNull: true },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        t,
        "enddate",
        { type: DataTypes.DATE, allowNull: true },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        t,
        "schoolid",
        { type: DataTypes.JSON, allowNull: true },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        t,
        "isdeleted",
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      const t = "curriculumbaseline";
      for (const c of [
        "baselinename",
        "baselinetype",
        "baselinestatus",
        "startdate",
        "enddate",
        "schoolid",
        "isdeleted",
      ]) {
        await queryInterface.removeColumn(t, c, { transaction });
      }
    }),
};
