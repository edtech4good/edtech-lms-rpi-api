import { DataTypes, QueryInterface, QueryTypes, Transaction } from "sequelize";
import { addColumnIfMissing, tableNameList, tableOptionsMatchingColumn } from "../migration-helpers";

/**
 * Bilingual content, step B-1 (design note docs/bilingual-content-design.md in the workspace repository): the
 * `contenttranslations` table and the `organisations.contentlanguage` column, in one migration.
 *
 * `contenttranslations` holds one row per translated text of a content row. Columns: `translationid` STRING(36) PK;
 * `organisationid` STRING(36) NOT NULL, foreign key to `organisations` named `contenttranslations_organisationid_fk`
 * ON UPDATE CASCADE ON DELETE RESTRICT; `tablename` STRING(40) NOT NULL and `rowid` STRING(36) NOT NULL (the content
 * row it translates: polymorphic, so no foreign key); `field` STRING(64) NOT NULL; `subkey` STRING(36) NOT NULL
 * DEFAULT '' (an option, matching-partner or distractor id, or a feedback message key); `language` STRING(8) NOT
 * NULL; `text` TEXT NOT NULL; `sourcehash` CHAR(64) NOT NULL (sha-256 of the base text that was translated);
 * `lastupdated` DATETIME(3) NOT NULL. No `isdeleted`: rows are hard-deleted, so a re-added translation never collides.
 *
 * ## `subkey` is NOT NULL, `''` means "none"
 *
 * MySQL treats NULLs in a unique key as distinct, so a nullable `subkey` would let the same (table, row, field,
 * language) be stored twice. The column is NOT NULL with `''` for a field that has no subkey, and the unique key
 * `contenttranslations_parent_language_unique` (`tablename`, `rowid`, `field`, `subkey`, `language`) then holds.
 *
 * ## Indexes
 *
 * The model declares the unique key, `contenttranslations_organisationid` and `contenttranslations_table_row`
 * under these exact names, so the server's boot-time `sequelize.sync()` finds nothing to add. They are created
 * BEFORE the foreign key so MySQL makes no implicit one.
 *
 * ## `organisations.contentlanguage`
 *
 * STRING(8) NULL: the language of the organisation's content text, the base language its translations differ
 * from. NULL means "no translations yet; show the base text".
 *
 * ## Collation
 *
 * The table takes the charset and collation of the REAL `organisations.organisationid` (the key it references) and
 * names them. If a table that `sync()` created is found here with an `organisationid` of another collation and it
 * holds rows, the migration stops with a message.
 *
 * ## Idempotence
 *
 * Each of the table, the indexes, the foreign key and the column is created only if it is missing, so a re-run is a
 * no-op and one that stopped halfway finishes. Migrate BEFORE booting the new code.
 *
 * ## down() is guarded
 *
 * Throws, changing nothing, while `contenttranslations` holds rows or any organisation has a `contentlanguage`
 * (a person's decisions that dropping would lose); otherwise drops the table and the column. Missing ones are a no-op.
 */
const TABLE = "contenttranslations";
const UNIQUE_KEY = "contenttranslations_parent_language_unique";
const ORGANISATION_INDEX = "contenttranslations_organisationid";
const ROW_INDEX = "contenttranslations_table_row";
const FK_ORGANISATION = "contenttranslations_organisationid_fk";

const SQL_NAME = /^[A-Za-z0-9_]+$/;
const checked = (value: string): string => {
  if (!SQL_NAME.test(value)) throw new Error(`Unexpected identifier: ${value}`);
  return value;
};

const nameOf = (r: { name?: string; NAME?: string }): string => String(r.name ?? r.NAME);

async function indexNames(queryInterface: QueryInterface, transaction: Transaction): Promise<Set<string>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT DISTINCT INDEX_NAME AS name FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    { replacements: [TABLE], type: QueryTypes.SELECT, transaction },
  )) as Array<{ name?: string; NAME?: string }>;
  return new Set(rows.map(nameOf));
}

async function constraintNames(queryInterface: QueryInterface, transaction: Transaction): Promise<Set<string>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT CONSTRAINT_NAME AS name FROM information_schema.table_constraints
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    { replacements: [TABLE], type: QueryTypes.SELECT, transaction },
  )) as Array<{ name?: string; NAME?: string }>;
  return new Set(rows.map(nameOf));
}

async function count(queryInterface: QueryInterface, sql: string, transaction: Transaction): Promise<number> {
  const rows = (await queryInterface.sequelize.query(sql, { type: QueryTypes.SELECT, transaction })) as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
}

const translationRows = (queryInterface: QueryInterface, transaction: Transaction) =>
  count(queryInterface, `SELECT COUNT(*) AS n FROM \`${TABLE}\``, transaction);

async function hasColumn(queryInterface: QueryInterface, table: string, column: string): Promise<boolean> {
  try {
    return Boolean((await queryInterface.describeTable(table))[column]);
  } catch {
    return false;
  }
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      if (!names.includes("organisations")) {
        throw new Error("organisations must exist before the contenttranslations table. Run the earlier migrations first.");
      }
      const wanted = await tableOptionsMatchingColumn(queryInterface, "organisations", "organisationid");
      if (!names.includes(TABLE)) {
        await queryInterface.createTable(
          TABLE,
          {
            translationid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
            organisationid: { type: DataTypes.STRING(36), allowNull: false },
            tablename: { type: DataTypes.STRING(40), allowNull: false },
            rowid: { type: DataTypes.STRING(36), allowNull: false },
            field: { type: DataTypes.STRING(64), allowNull: false },
            subkey: { type: DataTypes.STRING(36), allowNull: false, defaultValue: "" },
            language: { type: DataTypes.STRING(8), allowNull: false },
            text: { type: DataTypes.TEXT, allowNull: false },
            sourcehash: { type: DataTypes.CHAR(64), allowNull: false },
            lastupdated: { type: DataTypes.DATE(3), allowNull: false },
          },
          { transaction, charset: wanted.charset, collate: wanted.collate },
        );
      } else {
        const actual = await tableOptionsMatchingColumn(queryInterface, TABLE, "organisationid");
        if (actual.charset !== wanted.charset || actual.collate !== wanted.collate) {
          if ((await translationRows(queryInterface, transaction)) > 0) {
            throw new Error(
              `${TABLE}.organisationid has collation ${actual.collate} but organisations.organisationid has ${wanted.collate}, and the table holds rows. ` +
                "Convert it by hand once you have checked its rows, then run this migration again. Nothing was changed.",
            );
          }
          await queryInterface.sequelize.query(
            `ALTER TABLE \`${TABLE}\` MODIFY COLUMN \`organisationid\` VARCHAR(36) CHARACTER SET ${checked(wanted.charset)} COLLATE ${checked(wanted.collate)} NOT NULL`,
            { transaction },
          );
        }
      }

      const indexes = await indexNames(queryInterface, transaction);
      if (!indexes.has(UNIQUE_KEY)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${TABLE}\` ADD UNIQUE INDEX \`${UNIQUE_KEY}\` USING BTREE (\`tablename\`, \`rowid\`, \`field\`, \`subkey\`, \`language\`)`,
          { transaction },
        );
      }
      if (!indexes.has(ORGANISATION_INDEX)) {
        await queryInterface.sequelize.query(`ALTER TABLE \`${TABLE}\` ADD INDEX \`${ORGANISATION_INDEX}\` USING BTREE (\`organisationid\`)`, { transaction });
      }
      if (!indexes.has(ROW_INDEX)) {
        await queryInterface.sequelize.query(`ALTER TABLE \`${TABLE}\` ADD INDEX \`${ROW_INDEX}\` USING BTREE (\`tablename\`, \`rowid\`)`, { transaction });
      }

      const keys = await constraintNames(queryInterface, transaction);
      if (!keys.has(FK_ORGANISATION)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${TABLE}\` ADD CONSTRAINT \`${FK_ORGANISATION}\` FOREIGN KEY (\`organisationid\`) REFERENCES \`organisations\` (\`organisationid\`) ON DELETE RESTRICT ON UPDATE CASCADE`,
          { transaction },
        );
      }

      await addColumnIfMissing(queryInterface, "organisations", "contentlanguage", { type: DataTypes.STRING(8), allowNull: true, defaultValue: null }, transaction);
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      const hasTable = names.includes(TABLE);
      const hasLanguage = names.includes("organisations") && (await hasColumn(queryInterface, "organisations", "contentlanguage"));
      const rows = hasTable ? await translationRows(queryInterface, transaction) : 0;
      const languages = hasLanguage
        ? await count(queryInterface, "SELECT COUNT(*) AS n FROM `organisations` WHERE `contentlanguage` IS NOT NULL", transaction)
        : 0;
      if (rows > 0 || languages > 0) {
        throw new Error(
          `B-1 down() refused: ${TABLE} holds ${rows} row(s) and ${languages} organisation(s) have a contentlanguage, which dropping would lose, so nothing was changed. ` +
            "Remove them (a person's decision), then run this migration's down again.",
        );
      }
      if (hasTable) await queryInterface.dropTable(TABLE, { transaction });
      if (hasLanguage) await queryInterface.removeColumn("organisations", "contentlanguage", { transaction });
    }),
};
