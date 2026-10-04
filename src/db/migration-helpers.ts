import type { QueryInterface, Transaction } from "sequelize";

/** Align new tables with `curriculums.curriculumid` when present; else Docker-friendly default. */
export async function tableOptionsMatchingCurriculums(
  queryInterface: QueryInterface,
): Promise<{ charset: string; collate: string }> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'curriculums'
       AND COLUMN_NAME = 'curriculumid'
     LIMIT 1`,
  );
  const r = (rows as { cs?: string; coll?: string }[])[0];
  if (r?.cs && r?.coll) {
    return { charset: r.cs, collate: r.coll };
  }
  return { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" };
}

export async function tableNameList(queryInterface: QueryInterface): Promise<string[]> {
  const tables = await queryInterface.showAllTables();
  return tables.map((t) =>
    typeof t === "string" ? t : (t as { tableName?: string }).tableName ?? String(t),
  );
}

export async function columnCollation(
  queryInterface: QueryInterface,
  table: string,
  column: string,
): Promise<string | null> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COLLATION_NAME AS coll
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    { replacements: [table, column] },
  );
  const r = (rows as { coll?: string }[])[0];
  return r?.coll ?? null;
}

export async function addColumnIfMissing(
  queryInterface: QueryInterface,
  table: string,
  column: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: any,
  transaction: Transaction,
): Promise<void> {
  const desc = await queryInterface.describeTable(table);
  if (desc[column]) {
    return;
  }
  await queryInterface.addColumn(table, column, definition, { transaction });
}

/** The `down()` mirror of `addColumnIfMissing` - safe against a column (or the whole table) already being gone. Unlike `addColumnIfMissing`, this must tolerate the table itself not existing (a `down()` can run against a database where `up()`'s table-creation branch never ran, or where the table pre-dates the migration and was never touched), so a `describeTable` failure is treated as "nothing to remove" rather than propagated. */
export async function removeColumnIfPresent(
  queryInterface: QueryInterface,
  table: string,
  column: string,
  transaction: Transaction,
): Promise<void> {
  let desc: Record<string, unknown>;
  try {
    desc = await queryInterface.describeTable(table);
  } catch {
    return;
  }
  if (!desc[column]) {
    return;
  }
  await queryInterface.removeColumn(table, column, { transaction });
}

/** Charset/collation of an arbitrary existing column, for a new table's FK-referencing column (generalises `tableOptionsMatchingCurriculums`). Falls back to utf8mb4/utf8mb4_unicode_ci when the reference column can't be found. */
export async function tableOptionsMatchingColumn(
  queryInterface: QueryInterface,
  table: string,
  column: string,
): Promise<{ charset: string; collate: string }> {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    { replacements: [table, column] },
  );
  const r = (rows as { cs?: string; coll?: string }[])[0];
  if (r?.cs && r?.coll) {
    return { charset: r.cs, collate: r.coll };
  }
  return { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" };
}
