import { QueryInterface, QueryTypes, Transaction } from "sequelize";
import { inStrictMode } from "../required-columns";
import { tableNameList } from "../migration-helpers";

/**
 * Makes a migration-built database complete: the indexes the server's boot-time
 * `sequelize.sync()` used to add on its first boot become a migration.
 *
 * Measured on two empty databases, one after `db:migrate`, one after `db:migrate` and a
 * first boot: `sync()` ALTERed ten tables, adding 21 indexes the models declare and no
 * migration had created (`lessonplans`, `schools`, `studentactives`, `studentappusages`,
 * `studentgradesprogress`, `studentlearningsprogress`, `studentlessonsprogress`,
 * `studentlevelsprogress`, `studentpoints`, `studenttrash`), and on `schools` the
 * foreign key's own index `schools_countryid_foreign_idx` was replaced by `countryid`.
 * A second boot changed nothing. So part of the schema was defined by the models at
 * boot, not by the migrations. After this migration the two agree and `sync()` has
 * nothing to do.
 *
 * ## What it adds
 *
 * Each index with the exact name and column list `sync()` gives it
 * (`ALTER TABLE ... ADD INDEX <name> USING BTREE (<columns>)`, none unique), in the order
 * `sync()` adds them, so a later `sync()` finds each by name and does nothing. One ALTER
 * per table. No data is read or written.
 *
 * ## schools: the foreign key's index
 *
 * `schools.countryid` is a foreign key whose constraint is named
 * `schools_countryid_foreign_idx`, and the table was created with an index of that same
 * name backing it. `sync()` adds `countryid` and the old index goes. Here that is done
 * in an order that never leaves the foreign key without an index: `countryid` is added
 * FIRST (MySQL drops an index it created implicitly for a foreign key once an index
 * covering the same columns exists), and only then is any leftover
 * `schools_countryid_foreign_idx` index dropped, by name, if still there. The foreign
 * key constraint itself is not touched and keeps its name.
 *
 * One case is therefore not a strict no-op: if `schools` carries an EXPLICIT
 * `schools_countryid_foreign_idx` beside `countryid` (as after down() followed by a
 * boot), up() drops that explicit index by name, where `sync()` would have left both.
 * Harmless: it covers the same column and the foreign key keeps `countryid`.
 *
 * ## Idempotence and a database that `sync()` already ran on
 *
 * Every existing server has these indexes already, because its first boot added them.
 * For each index, `up()` reads `information_schema.statistics` and skips one whose NAME
 * is already on the table (the test `sync()` itself applies), so on such a database it
 * asks MySQL for no DDL at all and only SequelizeMeta gains a row. A table that is not
 * there is skipped, not created: this migration builds no tables. The connection is put
 * in strict SQL mode for the ALTERs and restored afterwards, as S4 does (no row is
 * written, so this is a pin, not a need).
 *
 * ## down()
 *
 * Drops, by name and only where present, the indexes `up()` adds, in reverse. For
 * `schools` it first gives the foreign key an index again: it adds
 * `schools_countryid_foreign_idx` (the name the table was created with) and only then
 * drops `countryid`. It is safe after `sync()` built the same indexes (it drops them,
 * and the next boot adds them back), and it touches no index it did not name. One
 * visible difference after down(): on `schools` the restored
 * `schools_countryid_foreign_idx` sits after `schools_organisationid_idx` in
 * SHOW CREATE TABLE instead of before it. The set of indexes is the same.
 */

interface IndexSpec {
  table: string;
  name: string;
  columns: string[];
}

const ix = (table: string, name: string, ...columns: string[]): IndexSpec => ({ table, name, columns });

/** In the order `sync()` adds them. Table order is the order of the ALTERs; down() takes it in reverse. */
const SYNC_CREATED_INDEXES: readonly IndexSpec[] = [
  ix("studentlearningsprogress", "studentid", "studentid"),
  ix("studentlearningsprogress", "lessonlearningid", "lessonlearningid"),
  ix("studentlessonsprogress", "studentid", "studentid"),
  ix("studentlessonsprogress", "lessonid", "lessonid"),
  ix("studentlessonsprogress", "levelid", "levelid"),
  ix("studentlessonsprogress", "gradeid", "gradeid"),
  ix("studentlessonsprogress", "curid", "curid"),
  ix("studentlevelsprogress", "studentid", "studentid"),
  ix("studentlevelsprogress", "levelid", "levelid"),
  ix("studentlevelsprogress", "gradeid", "gradeid"),
  ix("studentlevelsprogress", "curid", "curid"),
  ix("studentgradesprogress", "studentid", "studentid"),
  ix("studentgradesprogress", "gradeid", "gradeid"),
  ix("studentgradesprogress", "curriculumid", "curriculumid"),
  ix("studentactives", "studentid", "studentid"),
  ix("studentpoints", "studentid", "studentid"),
  ix("studentpoints", "lessonid", "lessonid"),
  ix("studentappusages", "schooluserid", "schooluserid"),
  ix("schools", "countryid", "countryid"),
  ix("studenttrash", "studentid", "studentid"),
  ix("lessonplans", "lessonid", "lessonid"),
];

/** The index `schools` was created with to back its `countryid` foreign key; `sync()` replaces it with `countryid`. */
const SCHOOLS_FK_INDEX: IndexSpec = ix("schools", "schools_countryid_foreign_idx", "countryid");

/** Identifiers here are our own constants; this keeps it that way. */
function id(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unexpected identifier: ${name}`);
  }
  return name;
}

async function indexNames(queryInterface: QueryInterface, table: string, transaction: Transaction): Promise<Set<string>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT DISTINCT INDEX_NAME AS name FROM information_schema.statistics
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    { replacements: [table], type: QueryTypes.SELECT, transaction },
  )) as Array<{ name?: string; NAME?: string }>;
  return new Set(rows.map((r) => String(r.name ?? r.NAME)));
}

const columnList = (s: IndexSpec): string => s.columns.map((c) => `\`${id(c)}\``).join(", ");

/** As `sync()` words it: the model-declared indexes are BTREE by declaration. */
const addClause = (s: IndexSpec): string => `ADD INDEX \`${id(s.name)}\` USING BTREE (${columnList(s)})`;

/** The foreign key's own index, as `createTable` left it: no USING clause (SHOW CREATE TABLE prints one only for a declared type). */
const addPlainClause = (s: IndexSpec): string => `ADD INDEX \`${id(s.name)}\` (${columnList(s)})`;

const tablesOf = (specs: readonly IndexSpec[]): string[] => [...new Set(specs.map((s) => s.table))];

async function alter(queryInterface: QueryInterface, table: string, clauses: string[], transaction: Transaction): Promise<void> {
  if (clauses.length === 0) {
    return;
  }
  await queryInterface.sequelize.query(`ALTER TABLE \`${id(table)}\` ${clauses.join(", ")}`, { transaction });
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const present = new Set(await tableNameList(queryInterface));
      await inStrictMode(queryInterface, transaction, async () => {
        for (const table of tablesOf(SYNC_CREATED_INDEXES)) {
          if (!present.has(table)) {
            continue;
          }
          const have = await indexNames(queryInterface, table, transaction);
          const missing = SYNC_CREATED_INDEXES.filter((s) => s.table === table && !have.has(s.name));
          // The new index goes in before the old one is dropped, so the foreign key always has one.
          await alter(queryInterface, table, missing.map(addClause), transaction);
          if (table === SCHOOLS_FK_INDEX.table) {
            const now = await indexNames(queryInterface, table, transaction);
            if (now.has(SCHOOLS_FK_INDEX.name) && now.has("countryid")) {
              await alter(queryInterface, table, [`DROP INDEX \`${id(SCHOOLS_FK_INDEX.name)}\``], transaction);
            }
          }
        }
      });
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const present = new Set(await tableNameList(queryInterface));
      await inStrictMode(queryInterface, transaction, async () => {
        for (const table of tablesOf(SYNC_CREATED_INDEXES).reverse()) {
          if (!present.has(table)) {
            continue;
          }
          let have = await indexNames(queryInterface, table, transaction);
          if (table === SCHOOLS_FK_INDEX.table && have.has("countryid") && !have.has(SCHOOLS_FK_INDEX.name)) {
            // Give the foreign key its own index again BEFORE the one backing it now is dropped.
            await alter(queryInterface, table, [addPlainClause(SCHOOLS_FK_INDEX)], transaction);
            have = await indexNames(queryInterface, table, transaction);
          }
          const drops = SYNC_CREATED_INDEXES.filter((s) => s.table === table && have.has(s.name))
            .reverse()
            .map((s) => `DROP INDEX \`${id(s.name)}\``);
          await alter(queryInterface, table, drops, transaction);
        }
      });
    }),
};
