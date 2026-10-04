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
 * ## A table that is already there
 *
 * The server calls `sequelize.sync()` at boot, which creates `organisations`
 * from the model, with the database's DEFAULT collation, if new code boots
 * before this migration runs. So an existing table is not simply skipped: if its
 * id collation differs from `schools.schoolid`'s and it is EMPTY, it is converted
 * to the intended charset and collation; if it differs and holds rows, the
 * migration stops with a message, because converting a populated table is a
 * decision for a person. A table that already matches is left alone.
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

/** What a charset or collation name from information_schema looks like. */
const SQL_NAME = /^[A-Za-z0-9_]+$/;

/** See "A table that is already there" above. */
async function alignExistingTable(
  queryInterface: QueryInterface,
  wanted: { charset: string; collate: string },
  transaction: Transaction,
): Promise<void> {
  if (!SQL_NAME.test(wanted.charset) || !SQL_NAME.test(wanted.collate)) {
    throw new Error("Unexpected charset/collation reported for schools.schoolid.");
  }
  const actual = await tableOptionsMatchingColumn(queryInterface, ORGANISATIONS, "organisationid");
  if (actual.charset === wanted.charset && actual.collate === wanted.collate) {
    return;
  }
  const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*) AS n FROM \`${ORGANISATIONS}\``, { transaction });
  const count = Number((rows as Array<{ n: number | string }>)[0]?.n ?? 0);
  if (count > 0) {
    throw new Error(
      `The ${ORGANISATIONS} table already exists with collation ${actual.collate} instead of ${wanted.collate}, ` +
        `and it holds ${count} row(s). Convert it by hand ` +
        `(ALTER TABLE ${ORGANISATIONS} CONVERT TO CHARACTER SET ${wanted.charset} COLLATE ${wanted.collate}) ` +
        "once you have checked its rows, then run this migration again.",
    );
  }
  await queryInterface.sequelize.query(
    `ALTER TABLE \`${ORGANISATIONS}\` CONVERT TO CHARACTER SET ${wanted.charset} COLLATE ${wanted.collate}`,
    { transaction },
  );
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      const opts = await tableOptionsMatchingColumn(queryInterface, "schools", "schoolid");
      if (names.includes(ORGANISATIONS)) {
        await alignExistingTable(queryInterface, opts, transaction);
        return;
      }
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
