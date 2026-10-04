import { QueryInterface, QueryTypes, Transaction } from "sequelize";
import {
  removeColumnIfPresent,
  tableNameList,
  tableOptionsMatchingColumn,
} from "../migration-helpers";

/**
 * S2 of the multi-organisation model on the student API: the columns that tie
 * schools and content to an organisation, and learners and school logins to a
 * school by id. Everything is NULLABLE and nothing reads the new columns yet.
 *
 *  - `organisationid` on `schools`, `curriculums`, `questions`, `documents` and
 *    `subjects` (an index and a foreign key to `organisations`).
 *  - `schoolid` on `students` and `schoolusers` (an index and a foreign key to
 *    `schools`), filled from the row's `schoolname` (see "Backfill").
 *
 * The central API has more tables with an owner (`lmsusers`, `questiontags`,
 * `documenttags`, `curriculumcountry`). This API has no model for them, so they
 * are left alone here.
 *
 * ## Column types and collation
 *
 * Each new column takes the charset and collation of the REAL column it will
 * reference, read from `information_schema`, not from the model: MySQL refuses
 * a foreign key between columns of different collations, and the models and the
 * tables do not always agree. `organisationid` follows
 * `organisations.organisationid`; `schoolid` follows `schools.schoolid` (and
 * takes its column type from it too). A Sequelize column definition cannot carry
 * a per-column collation, so the columns are added with a raw `ALTER TABLE`.
 * Every identifier in a statement is a constant in this file; the charset,
 * collation and type come from `information_schema` and are checked against a
 * strict pattern first.
 *
 * ## Foreign keys: ON DELETE RESTRICT
 *
 * An organisation that still has schools or content cannot be hard-deleted, and
 * a school that still has learners or logins cannot either: those deletes must
 * fail loudly rather than orphan rows or delete learners. `ON UPDATE CASCADE`
 * is harmless (ids are uuids that never change).
 *
 * `ADD FOREIGN KEY` is done in place (no table copy, no blocked writes) only
 * with `foreign_key_checks` off. While the column holds no value there is
 * nothing to validate, so the key is added with it off for that one statement,
 * on the migration's own connection, and restored in a `finally`. A re-run that
 * finds values already in the column adds the key the normal, validating way.
 *
 * ## Backfill of `students.schoolid` and `schoolusers.schoolid`
 *
 * Matches the row's `schoolname` to `schools.schoolname`, in this order, and
 * only ever fills NULLs:
 *
 *  1. EXACT text (byte for byte). `CAST(.. AS BINARY)` is used because the
 *     column collation is a poor judge of "the same name": under
 *     `utf8mb4_unicode_ci` trailing spaces are ignored and several Khmer marks
 *     (bantoc U+17CB, nikahit U+17C6, musikatoan U+17C9) weigh nothing, so two
 *     different names can compare equal. A name that is exact for exactly one
 *     school is filled.
 *  2. LOOSE, under the school column's own collation, for rows still empty:
 *     filled ONLY when exactly one school matches. A learner whose stored name
 *     differs from the school's only by a trailing space or a Khmer mark still
 *     belongs to that school today (the name join is a collation compare), so it
 *     keeps its school. Its `schoolname` is set to the school's own stored name
 *     in the same statement, so that after the migration every filled row's name
 *     is its school's name byte for byte. The old text is NOT kept.
 *  3. Everything else (no match, several loose matches, or a NULL name) stays
 *     NULL. The counts are printed; never the names.
 *
 * Soft-deleted schools match like any other: the id is identity, not liveness.
 *
 * Each backfill pass is ONE UPDATE statement per table. That is fine for the
 * table sizes in use; before these tables are large it should be batched by key
 * range, because a single statement holds its row locks until it ends.
 *
 * ## Idempotence
 *
 * MySQL DDL commits implicitly, so the transaction wrapper cannot undo a
 * half-applied migration. Every step is guarded (column on `describeTable`,
 * index on `showIndex`, foreign key on `information_schema`) and the backfill
 * touches only rows where `schoolid IS NULL`, so a re-run changes nothing and a
 * run after a partial failure completes the job.
 *
 * ## down()
 *
 * Per table, in the reverse of `up()`'s order: foreign key, then index, then
 * column. It discards every owner and school id written since `up()`, and it
 * CANNOT restore the text of any `schoolname` that the loose pass rewrote. Roll
 * the code back first: with the columns gone and code that names them running,
 * writes to those tables fail.
 */
const ORGANISATIONS = "organisations";
const ORGANISATION_ID = "organisationid";
const SCHOOLS = "schools";

/** Tables that gain `organisationid`, in the order `up()` adds them. */
const OWNED_TABLES = ["schools", "curriculums", "questions", "documents", "subjects"].map((table) => ({
  table,
  index: `${table}_organisationid_idx`,
  constraint: `${table}_organisationid_fk`,
}));

/** Tables that gain `schoolid`, with their primary key (used by the loose pass). */
const SCHOOL_LINKED_TABLES = [
  { table: "students", pk: "studentid" },
  { table: "schoolusers", pk: "schooluserid" },
].map((t) => ({
  ...t,
  index: `${t.table}_schoolid_idx`,
  constraint: `fk_${t.table}_schoolid`,
}));

/** What a charset, collation or column-type name from information_schema looks like. */
const SQL_NAME = /^[A-Za-z0-9_]+$/;
const SQL_TYPE = /^[a-z]+\(\d+\)$/i;

type Q = QueryInterface["sequelize"]["query"];
type IndexRow = { name?: string };

const indexRows = async (queryInterface: QueryInterface, table: string): Promise<IndexRow[]> =>
  (await queryInterface.showIndex(table)) as IndexRow[];

async function constraintExists(
  queryInterface: QueryInterface,
  table: string,
  constraint: string,
  transaction: Transaction,
): Promise<boolean> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT CONSTRAINT_NAME AS name
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    { replacements: [table, constraint], transaction },
  );
  return (rows as unknown[]).length > 0;
}

async function tableExists(queryInterface: QueryInterface, table: string): Promise<boolean> {
  try {
    await queryInterface.describeTable(table);
    return true;
  } catch {
    return false;
  }
}

/** `varchar(36)` etc., exactly as the real column reports it. */
async function realColumnType(
  queryInterface: QueryInterface,
  table: string,
  column: string,
  transaction: Transaction,
): Promise<string> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COLUMN_TYPE AS type
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    { replacements: [table, column], transaction },
  );
  const type = (rows as Array<{ type?: string }>)[0]?.type ?? "varchar(36)";
  if (!SQL_TYPE.test(type)) {
    throw new Error(`Unexpected type for ${table}.${column}: ${type}`);
  }
  return type;
}

/** Collation of `schools.schoolname`: its own collation is what "looser" means in the backfill. */
async function schoolNameCollation(queryInterface: QueryInterface, transaction: Transaction): Promise<string> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COLLATION_NAME AS coll FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'schoolname' LIMIT 1`,
    { replacements: [SCHOOLS], transaction },
  );
  const coll = (rows as Array<{ coll?: string }>)[0]?.coll ?? "utf8mb4_unicode_ci";
  if (!SQL_NAME.test(coll)) {
    throw new Error(`Unexpected collation for ${SCHOOLS}.schoolname: ${coll}`);
  }
  return coll;
}

async function count(q: Q, sql: string, transaction: Transaction): Promise<number> {
  const rows = (await q(sql, { type: QueryTypes.SELECT, transaction })) as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
}

async function affected(q: Q, sql: string, transaction: Transaction): Promise<number> {
  const result = (await q(sql, { type: QueryTypes.UPDATE, transaction })) as unknown as [unknown, number];
  return Number(result?.[1] ?? 0);
}

/**
 * Adds `column` (nullable, with the given type, charset and collation), an index and a
 * foreign key to `referencedTable.referencedColumn`, each only if missing.
 */
async function addLink(
  queryInterface: QueryInterface,
  transaction: Transaction,
  link: {
    table: string;
    column: string;
    type: string;
    charset: string;
    collate: string;
    index: string;
    constraint: string;
    referencedTable: string;
    referencedColumn: string;
  },
): Promise<void> {
  const q: Q = queryInterface.sequelize.query.bind(queryInterface.sequelize);
  const description = await queryInterface.describeTable(link.table);
  if (!description[link.column]) {
    await q(
      `ALTER TABLE \`${link.table}\` ADD COLUMN \`${link.column}\` ${link.type} ` +
        `CHARACTER SET ${link.charset} COLLATE ${link.collate} NULL DEFAULT NULL`,
      { transaction },
    );
  }

  const indexes = await indexRows(queryInterface, link.table);
  if (!indexes.some((i) => i.name === link.index)) {
    await queryInterface.addIndex(link.table, [link.column], { name: link.index, transaction });
  }

  if (!(await constraintExists(queryInterface, link.table, link.constraint, transaction))) {
    const addKey = () =>
      q(
        `ALTER TABLE \`${link.table}\` ADD CONSTRAINT \`${link.constraint}\` ` +
          `FOREIGN KEY (\`${link.column}\`) REFERENCES \`${link.referencedTable}\` (\`${link.referencedColumn}\`) ` +
          "ON DELETE RESTRICT ON UPDATE CASCADE",
        { transaction },
      );
    const filled = await count(
      q,
      `SELECT COUNT(*) AS n FROM \`${link.table}\` WHERE \`${link.column}\` IS NOT NULL`,
      transaction,
    );
    if (filled === 0) {
      // Nothing to validate: add it in place instead of copying the table.
      await q("SET foreign_key_checks = 0", { transaction });
      try {
        await addKey();
      } finally {
        await q("SET foreign_key_checks = 1", { transaction });
      }
    } else {
      await addKey();
    }
  }
}

/** The reverse of `addLink`: foreign key, then index, then column, each only if present. */
async function removeLink(
  queryInterface: QueryInterface,
  transaction: Transaction,
  link: { table: string; column: string; index: string; constraint: string },
): Promise<void> {
  if (!(await tableExists(queryInterface, link.table))) {
    return;
  }
  if (await constraintExists(queryInterface, link.table, link.constraint, transaction)) {
    await queryInterface.sequelize.query(
      `ALTER TABLE \`${link.table}\` DROP FOREIGN KEY \`${link.constraint}\``,
      { transaction },
    );
  }
  const indexes = await indexRows(queryInterface, link.table);
  if (indexes.some((i) => i.name === link.index)) {
    await queryInterface.removeIndex(link.table, link.index, { transaction });
  }
  await removeColumnIfPresent(queryInterface, link.table, link.column, transaction);
}

async function backfillSchoolIds(
  queryInterface: QueryInterface,
  transaction: Transaction,
  nameCollation: string,
): Promise<void> {
  const q: Q = queryInterface.sequelize.query.bind(queryInterface.sequelize);

  for (const { table, pk } of SCHOOL_LINKED_TABLES) {
    const exact = await affected(
      q,
      `UPDATE \`${table}\` t
         JOIN (SELECT MIN(schoolid) AS schoolid, MIN(schoolname) AS schoolname
                 FROM \`${SCHOOLS}\`
                GROUP BY CAST(schoolname AS BINARY)
               HAVING COUNT(*) = 1) s
           ON CAST(t.schoolname AS BINARY) = CAST(s.schoolname AS BINARY)
          SET t.schoolid = s.schoolid
        WHERE t.schoolid IS NULL AND t.schoolname IS NOT NULL`,
      transaction,
    );
    const loose = await affected(
      q,
      `UPDATE \`${table}\` t
         JOIN (SELECT t2.\`${pk}\` AS pk, MIN(s.schoolid) AS schoolid, MIN(s.schoolname) AS schoolname
                 FROM \`${table}\` t2
                 JOIN \`${SCHOOLS}\` s
                   ON t2.schoolname = s.schoolname COLLATE ${nameCollation}
                WHERE t2.schoolid IS NULL AND t2.schoolname IS NOT NULL
                GROUP BY t2.\`${pk}\`
               HAVING COUNT(*) = 1) m
           ON m.pk = t.\`${pk}\`
          SET t.schoolid = m.schoolid, t.schoolname = m.schoolname
        WHERE t.schoolid IS NULL`,
      transaction,
    );
    const total = await count(q, `SELECT COUNT(*) AS n FROM \`${table}\``, transaction);
    const unnamed = await count(
      q,
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE schoolid IS NULL AND schoolname IS NULL`,
      transaction,
    );
    const ambiguous = await count(
      q,
      `SELECT COUNT(*) AS n FROM \`${table}\` t
        WHERE t.schoolid IS NULL AND t.schoolname IS NOT NULL
          AND (SELECT COUNT(*) FROM \`${SCHOOLS}\` s
                WHERE t.schoolname = s.schoolname COLLATE ${nameCollation}) > 1`,
      transaction,
    );
    const unmatched = await count(
      q,
      `SELECT COUNT(*) AS n FROM \`${table}\` t
        WHERE t.schoolid IS NULL AND t.schoolname IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM \`${SCHOOLS}\` s
                WHERE t.schoolname = s.schoolname COLLATE ${nameCollation})`,
      transaction,
    );
    // Counts only, never names.
    console.log(
      `S2 ${table}: rows=${total} filled_exact=${exact} filled_loose_only=${loose} names_rewritten=${loose} ` +
        `left_null_no_name=${unnamed} left_null_ambiguous=${ambiguous} left_null_no_match=${unmatched}`,
    );
  }
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      if (!(await tableNameList(queryInterface)).includes(ORGANISATIONS)) {
        throw new Error(`The ${ORGANISATIONS} table does not exist. Run the migration that creates it first.`);
      }

      // Read and check everything that goes into DDL BEFORE the first statement,
      // so a refused run changes nothing.
      const org = await tableOptionsMatchingColumn(queryInterface, ORGANISATIONS, ORGANISATION_ID);
      if (!SQL_NAME.test(org.charset) || !SQL_NAME.test(org.collate)) {
        throw new Error(`Unexpected charset/collation reported for ${ORGANISATIONS}.${ORGANISATION_ID}.`);
      }
      const school = await tableOptionsMatchingColumn(queryInterface, SCHOOLS, "schoolid");
      if (!SQL_NAME.test(school.charset) || !SQL_NAME.test(school.collate)) {
        throw new Error(`Unexpected charset/collation reported for ${SCHOOLS}.schoolid.`);
      }
      const schoolIdType = await realColumnType(queryInterface, SCHOOLS, "schoolid", transaction);
      const nameCollation = await schoolNameCollation(queryInterface, transaction);

      // 1. organisationid on schools and the content tables.
      for (const target of OWNED_TABLES) {
        await addLink(queryInterface, transaction, {
          table: target.table,
          column: ORGANISATION_ID,
          type: "VARCHAR(36)",
          charset: org.charset,
          collate: org.collate,
          index: target.index,
          constraint: target.constraint,
          referencedTable: ORGANISATIONS,
          referencedColumn: ORGANISATION_ID,
        });
      }

      // 2. schoolid on students and schoolusers, then the backfill.
      for (const target of SCHOOL_LINKED_TABLES) {
        await addLink(queryInterface, transaction, {
          table: target.table,
          column: "schoolid",
          type: schoolIdType,
          charset: school.charset,
          collate: school.collate,
          index: target.index,
          constraint: target.constraint,
          referencedTable: SCHOOLS,
          referencedColumn: "schoolid",
        });
      }
      await backfillSchoolIds(queryInterface, transaction, nameCollation);
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // The reverse of up(): school links first, then the owners, last table first.
      for (const target of [...SCHOOL_LINKED_TABLES].reverse()) {
        await removeLink(queryInterface, transaction, { ...target, column: "schoolid" });
      }
      for (const target of [...OWNED_TABLES].reverse()) {
        await removeLink(queryInterface, transaction, { ...target, column: ORGANISATION_ID });
      }
    }),
};
