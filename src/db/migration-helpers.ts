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
