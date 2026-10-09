import { DataTypes, QueryInterface, QueryTypes, Transaction } from "sequelize";
import { tableNameList, tableOptionsMatchingColumn } from "../migration-helpers";

/**
 * S-LI2 (learning items, design note section 5): the `lessonlearningdocuments` link table, the documents a
 * learning item uses besides its primary `documentid` (one row per document, with a role and an order).
 * It ships in phase 0 and stays empty, so the schema and the format-3 payload settle once.
 *
 * Columns: `lessonlearningdocumentid` STRING(36) PK; `lessonlearningid` NOT NULL, foreign key to
 * `lessonlearnings` ON DELETE CASCADE; `documentid` NOT NULL, foreign key to `documents` ON DELETE
 * RESTRICT; `lessonlearningdocumentrole` STRING(16) NOT NULL (`rendition`, `asset`);
 * `lessonlearningdocumentorder` INTEGER NOT NULL DEFAULT 0. Unique on (`lessonlearningid`, `documentid`)
 * and an index on `documentid` (the "used in" lookup). No audit columns, and NO owner column: a row
 * belongs to the organisation of the learning it hangs from (through the lesson), so `REQUIRED_COLUMNS`
 * and `npm run db:check-owners` are untouched.
 *
 * ## Collation
 *
 * The table takes the charset and collation of the REAL `lessonlearnings.lessonlearningid` and names them
 * (`createTable` always names its charset: the rule of rpi#115). The `documentid` column is then made to
 * match the REAL `documents.documentid` column, if that differs, before the foreign key is added: MySQL
 * refuses a foreign key between columns of different collations.
 *
 * ## The indexes are the model's
 *
 * The model declares the unique key and the `documentid` index under these exact names, so the server's
 * boot-time `sequelize.sync()` finds nothing to add (the `schema-drift` job proves it). The indexes are
 * created BEFORE the foreign keys so MySQL does not make implicit ones.
 *
 * ## Idempotence
 *
 * The table is created only if missing; the indexes and foreign keys are each created only if their name
 * is missing, so a re-run is a no-op and one that stopped halfway finishes. Migrate BEFORE booting the new
 * code: on a database whose default collation is utf8mb4_0900_ai_ci, boot-time `sync()` of the new model
 * fails loudly (the foreign keys cannot join columns of different collations), which is why the rollout
 * is migrate first, then code. If a table `sync()` did create is found here, it gets whatever it lacks, and
 * if its id collation differs from the referenced columns' and it holds rows the migration stops with a message.
 *
 * ## down() is guarded
 *
 * Throws, changing nothing, if the table holds rows (they are an item's documents and would be lost);
 * otherwise drops it. A missing table is a no-op.
 */
const TABLE = "lessonlearningdocuments";
const UNIQUE_KEY = "lessonlearningdocuments_item_document_unique";
const DOCUMENT_INDEX = "lessonlearningdocuments_documentid";
const FK_LEARNING = "lessonlearningdocuments_lessonlearningid_fk";
const FK_DOCUMENT = "lessonlearningdocuments_documentid_fk";

const SQL_NAME = /^[A-Za-z0-9_]+$/;
const checked = (value: string): string => {
  if (!SQL_NAME.test(value)) throw new Error(`Unexpected identifier: ${value}`);
  return value;
};

async function indexNames(queryInterface: QueryInterface, transaction: Transaction): Promise<Set<string>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT DISTINCT INDEX_NAME AS name FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    { replacements: [TABLE], type: QueryTypes.SELECT, transaction },
  )) as Array<{ name?: string; NAME?: string }>;
  return new Set(rows.map((r) => String(r.name ?? r.NAME)));
}

async function constraintNames(queryInterface: QueryInterface, transaction: Transaction): Promise<Set<string>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT CONSTRAINT_NAME AS name FROM information_schema.table_constraints
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    { replacements: [TABLE], type: QueryTypes.SELECT, transaction },
  )) as Array<{ name?: string; NAME?: string }>;
  return new Set(rows.map((r) => String(r.name ?? r.NAME)));
}

async function rowCount(queryInterface: QueryInterface, transaction: Transaction): Promise<number> {
  const rows = (await queryInterface.sequelize.query(`SELECT COUNT(*) AS n FROM \`${TABLE}\``, { type: QueryTypes.SELECT, transaction })) as Array<{
    n: number | string;
  }>;
  return Number(rows[0]?.n ?? 0);
}

/** Makes `lessonlearningdocuments.<column>` take the charset and collation of `<table>.<column>` (a foreign key needs them equal). */
async function alignColumn(
  queryInterface: QueryInterface,
  column: "lessonlearningid" | "documentid",
  referenced: string,
  transaction: Transaction,
): Promise<void> {
  const wanted = await tableOptionsMatchingColumn(queryInterface, referenced, column);
  const actual = await tableOptionsMatchingColumn(queryInterface, TABLE, column);
  if (actual.charset === wanted.charset && actual.collate === wanted.collate) return;
  if ((await rowCount(queryInterface, transaction)) > 0) {
    throw new Error(
      `${TABLE}.${column} has collation ${actual.collate} but ${referenced}.${column} has ${wanted.collate}, and the table holds rows. ` +
        "Convert it by hand once you have checked its rows, then run this migration again. Nothing was changed.",
    );
  }
  await queryInterface.sequelize.query(
    `ALTER TABLE \`${TABLE}\` MODIFY COLUMN \`${checked(column)}\` VARCHAR(36) CHARACTER SET ${checked(wanted.charset)} COLLATE ${checked(wanted.collate)} NOT NULL`,
    { transaction },
  );
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      if (!names.includes("lessonlearnings") || !names.includes("documents")) {
        throw new Error("lessonlearnings and documents must exist before the lessonlearningdocuments table. Run the earlier migrations first.");
      }
      if (!names.includes(TABLE)) {
        const opts = await tableOptionsMatchingColumn(queryInterface, "lessonlearnings", "lessonlearningid");
        await queryInterface.createTable(
          TABLE,
          {
            lessonlearningdocumentid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
            lessonlearningid: { type: DataTypes.STRING(36), allowNull: false },
            documentid: { type: DataTypes.STRING(36), allowNull: false },
            lessonlearningdocumentrole: { type: DataTypes.STRING(16), allowNull: false },
            lessonlearningdocumentorder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          },
          { transaction, charset: opts.charset, collate: opts.collate },
        );
      }
      await alignColumn(queryInterface, "lessonlearningid", "lessonlearnings", transaction);
      await alignColumn(queryInterface, "documentid", "documents", transaction);

      const indexes = await indexNames(queryInterface, transaction);
      if (!indexes.has(UNIQUE_KEY)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${TABLE}\` ADD UNIQUE INDEX \`${UNIQUE_KEY}\` USING BTREE (\`lessonlearningid\`, \`documentid\`)`,
          { transaction },
        );
      }
      if (!indexes.has(DOCUMENT_INDEX)) {
        await queryInterface.sequelize.query(`ALTER TABLE \`${TABLE}\` ADD INDEX \`${DOCUMENT_INDEX}\` USING BTREE (\`documentid\`)`, { transaction });
      }

      const keys = await constraintNames(queryInterface, transaction);
      if (!keys.has(FK_LEARNING)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${TABLE}\` ADD CONSTRAINT \`${FK_LEARNING}\` FOREIGN KEY (\`lessonlearningid\`) REFERENCES \`lessonlearnings\` (\`lessonlearningid\`) ON DELETE CASCADE ON UPDATE CASCADE`,
          { transaction },
        );
      }
      if (!keys.has(FK_DOCUMENT)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${TABLE}\` ADD CONSTRAINT \`${FK_DOCUMENT}\` FOREIGN KEY (\`documentid\`) REFERENCES \`documents\` (\`documentid\`) ON DELETE RESTRICT ON UPDATE CASCADE`,
          { transaction },
        );
      }
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const names = await tableNameList(queryInterface);
      if (!names.includes(TABLE)) return;
      const n = await rowCount(queryInterface, transaction);
      if (n > 0) {
        throw new Error(
          `S-LI2 down() refused: ${TABLE} holds ${n} row(s), an item's documents that dropping the table would lose, so nothing was changed. ` +
            "Remove them (a person's decision), then run this migration's down again.",
        );
      }
      await queryInterface.dropTable(TABLE, { transaction });
    }),
};
