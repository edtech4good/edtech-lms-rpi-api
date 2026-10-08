import { QueryInterface, QueryTypes, Transaction } from "sequelize";

/**
 * Makes `countries.countryname` unique, whichever way the table came to be.
 *
 * Why it matters: the country re-homing in `PUT /import/master` and in
 * provisioning matches a country by name and relies on MySQL's own equality, under the
 * column's collation, to say two names are the same. That only holds if the database
 * also refuses a second row whose name is equal. Without a unique key two equal names
 * can both be inserted, and a lookup by name then has two answers.
 *
 * ## Which databases already have the key
 *
 * A database built by the migrations has it: `20221220143728-countries-schools` creates
 * the table with `unique: true` on `countryname`, which MySQL names `countryname`. A table
 * that boot-time `sequelize.sync()` built from the model has no such key (the model
 * declares only the primary key). This migration adds it where it is missing and
 * changes nothing where it is there.
 *
 * ## The guard
 *
 * Before any DDL, `up()` groups the table by `countryname` (MySQL groups under the
 * column's collation, exactly as the unique key would compare) and, if any group holds
 * more than one row, throws, naming every name in every such group with its id, and
 * changes nothing. Soft-deleted rows are counted: the key would refuse them too. Two
 * names that differ only in case or accents ("Testland", "Testland" with an acute) are
 * one group under the usual collations; which of them to keep is a decision for a
 * person, so nothing is merged or deleted here.
 *
 * ## Idempotence
 *
 * If a UNIQUE index over exactly `countryname` (whole column, no prefix) exists under ANY
 * name, `up()` does nothing. If an index named `countryname` exists but is not that
 * (a plain index, or one over more columns), `up()` refuses rather than guess, because
 * the key could not be added under that name. Otherwise it adds
 * `UNIQUE KEY countryname (countryname)`, the name MySQL gives the key elsewhere.
 * Should a duplicate be inserted after the guard, the ALTER itself fails (1062)
 * and changes nothing; strict mode does not matter for that, so no mode is pinned.
 *
 * ## down()
 *
 * A documented no-op. By the time `down()` runs there is no way to know whether this
 * migration added the key or whether it was there before (it is on every database the
 * migrations built, from 20221220143728). Dropping a key named `countryname` could
 * therefore remove a key this migration never made, and the key is what the country
 * re-homing depends on. Leaving it is always safe: `20221220143728`'s own `down()` drops
 * the whole table, and so the key with it, when the migrations are undone that far.
 */
const TABLE = "countries";
const COLUMN = "countryname";
const KEY_NAME = "countryname";

/** How many duplicate groups a refusal lists. The count is always exact. */
const LISTED_GROUPS = 50;

interface IndexRow {
  index_name: string;
  non_unique: number | string;
  seq_in_index: number | string;
  column_name: string | null;
  sub_part: number | string | null;
}

interface DuplicateRow {
  grp: string;
  countryid: string;
  countryname: string;
}

/** The indexes of `countries`, each as its ordered columns, from information_schema. */
async function readIndexes(
  queryInterface: QueryInterface,
  transaction: Transaction,
): Promise<Array<{ name: string; unique: boolean; columns: string[]; prefixed: boolean }>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
            COLUMN_NAME AS column_name, SUB_PART AS sub_part
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    { replacements: [TABLE], type: QueryTypes.SELECT, transaction },
  )) as IndexRow[];
  const byName = new Map<string, { name: string; unique: boolean; columns: string[]; prefixed: boolean }>();
  for (const r of rows) {
    const entry = byName.get(r.index_name) ?? { name: r.index_name, unique: Number(r.non_unique) === 0, columns: [], prefixed: false };
    // An expression (functional) index has no column name; it can never be "exactly countryname".
    entry.columns.push(r.column_name ?? "(expression)");
    if (r.sub_part !== null && r.sub_part !== undefined) {
      entry.prefixed = true;
    }
    byName.set(r.index_name, entry);
  }
  return [...byName.values()];
}

/** Every row that shares its name (under the column's collation) with another, grouped, or empty. */
async function findDuplicates(queryInterface: QueryInterface, transaction: Transaction): Promise<Map<string, DuplicateRow[]>> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT d.grp AS grp, c.countryid AS countryid, c.countryname AS countryname
       FROM countries c
       JOIN (SELECT MIN(countryid) AS grp, countryname
               FROM countries
              GROUP BY countryname
             HAVING COUNT(*) > 1) d
         ON d.countryname = c.countryname
      ORDER BY d.grp, c.countryid`,
    { type: QueryTypes.SELECT, transaction },
  )) as DuplicateRow[];
  const groups = new Map<string, DuplicateRow[]>();
  for (const r of rows) {
    const g = groups.get(r.grp) ?? [];
    g.push(r);
    groups.set(r.grp, g);
  }
  return groups;
}

function describeDuplicates(groups: Map<string, DuplicateRow[]>): string {
  const all = [...groups.values()];
  const shown = all.slice(0, LISTED_GROUPS);
  const lines = shown.map(
    (g) => `  ${g.length} rows are the same name under the column's collation: ${g.map((r) => `${JSON.stringify(r.countryname)} (${r.countryid})`).join(", ")}`,
  );
  const more = all.length > shown.length ? `\n  ... and ${all.length - shown.length} more group(s)` : "";
  return (
    `countries.countryname is not unique: ${all.length} group(s) of rows share a name, so the unique key was NOT added and nothing was changed.\n` +
    `${lines.join("\n")}${more}\n` +
    "Decide which row each group keeps, re-point whatever refers to the others (schools.countryid), remove the others, then run this migration again."
  );
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      // Guard first: nothing below runs while any name is shared.
      const duplicates = await findDuplicates(queryInterface, transaction);
      if (duplicates.size > 0) {
        throw new Error(describeDuplicates(duplicates));
      }

      const indexes = await readIndexes(queryInterface, transaction);
      const already = indexes.find((i) => i.unique && !i.prefixed && i.columns.length === 1 && i.columns[0] === COLUMN);
      if (already) {
        // Recorded and left alone: the table already refuses a second equal name.
        return;
      }
      const clash = indexes.find((i) => i.name === KEY_NAME);
      if (clash) {
        throw new Error(
          `countries already has an index named ${KEY_NAME} that is not a unique key over the whole of ${COLUMN} ` +
            `(columns: ${clash.columns.join(", ")}; unique: ${clash.unique}), so the unique key was NOT added and nothing was changed. ` +
            "Drop or rename that index, then run this migration again.",
        );
      }
      await queryInterface.sequelize.query(`ALTER TABLE \`${TABLE}\` ADD UNIQUE KEY \`${KEY_NAME}\` (\`${COLUMN}\`)`, { transaction });
    }),

  // A no-op on purpose; see "down()" above.
  down: (): Promise<void> => Promise.resolve(),
};
