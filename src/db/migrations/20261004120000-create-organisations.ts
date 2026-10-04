import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { tableNameList, tableOptionsMatchingColumn } from "../migration-helpers";

/**
 * S1 of the multi-organisation model on the student API: a mirror of the
 * central API's `organisations` table, holding only what this API needs to
 * know about an organisation (its id, name, code, status, theme and the two
 * config blobs). Nothing else changes in this migration.
 *
 * Like the other mirrored tables here (`schools`, `countries`), it has no audit
 * columns: central is the authority and pushes the rows in (`PUT
 * /import/ownership`); nothing on this API creates or edits an organisation.
 * There are no unique indexes either: uniqueness of names and codes is
 * central's rule, and a mirror that enforced it could refuse a push that is
 * only transiently inconsistent (two organisations swapping codes).
 *
 * ## Collation
 *
 * `organisations` takes the charset and collation of the REAL
 * `schools.schoolid` column, read from the database, not from the model. MySQL
 * refuses a foreign key between columns of different collations, and the
 * models and the tables do not always agree. (`tableOptionsMatchingColumn`
 * falls back to utf8mb4/utf8mb4_unicode_ci when the reference column cannot be
 * found.) The `organisationid` columns that S2 adds elsewhere take theirs from
 * this table.
 *
 * ## Idempotence
 *
 * MySQL DDL commits implicitly, so the transaction wrapper cannot undo a
 * half-applied migration. The table creation is guarded on `showAllTables`, so
 * a re-run is a no-op.
 *
 * ## down()
 *
 * Drops the table if it exists. S2 must be undone first (its foreign keys point
 * here); undoing in migration order does that.
 */
const ORGANISATIONS = "organisations";

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      if (names.includes(ORGANISATIONS)) {
        return;
      }
      const opts = await tableOptionsMatchingColumn(queryInterface, "schools", "schoolid");
      await queryInterface.createTable(
        ORGANISATIONS,
        {
          organisationid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
          organisationname: { type: DataTypes.STRING(250), allowNull: false },
          organisationcode: { type: DataTypes.STRING(16), allowNull: false },
          organisationstatus: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          uitheme: {
            type: DataTypes.STRING(16),
            allowNull: false,
            defaultValue: "kids",
          },
          brandingconfig: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
          settingsconfig: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
          isdeleted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
          },
        },
        { transaction, charset: opts.charset, collate: opts.collate },
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      if (names.includes(ORGANISATIONS)) {
        await queryInterface.dropTable(ORGANISATIONS, { transaction });
      }
    }),
};
