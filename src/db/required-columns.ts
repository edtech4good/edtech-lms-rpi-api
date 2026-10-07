import { QueryInterface, QueryTypes, Transaction } from "sequelize";

/**
 * The columns the multi-organisation model makes REQUIRED once every row has its
 * owner: the tightening step S4. A school or a piece of content with no
 * organisation, or a learner or school login with no school, is a row nobody
 * owns, and the boundary this API enforces has nothing to say about it.
 *
 * One list serves the migration (what it guards and tightens), the pre-flight
 * script (`npm run db:check-owners`, what an operator runs before deploying) and
 * the specs, so the three cannot drift apart. It is the student-side twin of the
 * central API's C5 and C8 list: the same columns, minus the two tag tables this
 * API has no model for.
 */
export interface RequiredColumn {
  table: string;
  column: string;
  /** The table's primary key: what is listed (an id, never a name) for a row that breaks the rule. */
  pk: string;
}

/** The school's organisation, and the school of every learner and school login. */
export const SCHOOL_COLUMNS: readonly RequiredColumn[] = [
  { table: "schools", column: "organisationid", pk: "schoolid" },
  { table: "students", column: "schoolid", pk: "studentid" },
  { table: "schoolusers", column: "schoolid", pk: "schooluserid" },
];

/** The owner of the four content tables that carry one. */
export const CONTENT_COLUMNS: readonly RequiredColumn[] = [
  { table: "curriculums", column: "organisationid", pk: "curriculumid" },
  { table: "questions", column: "organisationid", pk: "questionid" },
  { table: "documents", column: "organisationid", pk: "documentid" },
  { table: "subjects", column: "organisationid", pk: "subjectid" },
];

export const REQUIRED_COLUMNS: readonly RequiredColumn[] = [...SCHOOL_COLUMNS, ...CONTENT_COLUMNS];

/** How many offending ids a message lists per column. The count is always exact. */
export const LISTED_IDS = 50;

/** What a table, column, charset or collation name from information_schema looks like. */
const SQL_NAME = /^[A-Za-z0-9_]+$/;
const COLUMN_TYPE = /^[a-z]+\(\d+\)$/i;

/** Every identifier in these statements is a constant in this module's lists; this makes that a checked fact. */
const identifier = (value: string): string => {
  if (!SQL_NAME.test(value)) {
    throw new Error(`Unexpected identifier: ${value}`);
  }
  return value;
};

/*
 * The guard and the pre-flight count `IS NULL` only, not the empty string: every one of these columns has a
 * foreign key, which rejects '' (no organisation or school has that id), and the only path that writes with
 * foreign-key checks off (the format-3 content import) stamps a validator-checked UUID on every owned row.
 */

/** A required column and the rows that break it. */
export interface Violation extends RequiredColumn {
  /** Rows whose value is NULL: all of them, soft-deleted included (an id is identity, not liveness). */
  count: number;
  /** Their primary keys, at most `limit`, in key order. */
  ids: string[];
}

interface Queryable {
  query: (sql: string, options: { type: QueryTypes.SELECT; transaction?: Transaction }) => Promise<unknown>;
}

/**
 * For each column, the rows that hold no value. Read-only. `limit` caps the ids
 * listed per column (pass `Infinity` for every one); the count is always exact.
 */
export async function findViolations(
  db: Queryable,
  columns: readonly RequiredColumn[],
  options: { transaction?: Transaction; limit?: number } = {},
): Promise<Violation[]> {
  const limit = options.limit ?? LISTED_IDS;
  const out: Violation[] = [];
  for (const target of columns) {
    const table = identifier(target.table);
    const column = identifier(target.column);
    const pk = identifier(target.pk);
    const counted = (await db.query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` IS NULL`, {
      type: QueryTypes.SELECT,
      transaction: options.transaction,
    })) as Array<{ n: number | string }>;
    const count = Number(counted[0]?.n ?? 0);
    let ids: string[] = [];
    if (count > 0 && limit > 0) {
      const cap = Number.isFinite(limit) ? ` LIMIT ${Math.max(0, Math.floor(limit))}` : "";
      const rows = (await db.query(
        `SELECT \`${pk}\` AS id FROM \`${table}\` WHERE \`${column}\` IS NULL ORDER BY \`${pk}\`${cap}`,
        { type: QueryTypes.SELECT, transaction: options.transaction },
      )) as Array<{ id: string }>;
      ids = rows.map((r) => String(r.id));
    }
    out.push({ ...target, count, ids });
  }
  return out;
}

/** The message of a refused tightening: counts per column and the offending primary keys. Ids only, never names. */
export function describeViolations(step: string, violations: readonly Violation[]): string {
  const broken = violations.filter((v) => v.count > 0);
  const lines = broken.map((v) => {
    const shown = v.ids.length < v.count ? `first ${v.ids.length} of ${v.count}` : `all ${v.count}`;
    return `${v.table}.${v.column}: ${v.count} row(s) with no value (${v.pk}, ${shown}): ${v.ids.join(", ")}`;
  });
  return (
    `${step} refused: ${broken.length} required column(s) still hold rows with no value, so nothing was changed.\n` +
    `${lines.join("\n")}\n` +
    "Give each row its owner (a format-3 content import or the ownership import for content and schools; a learner " +
    "or login whose school cannot be found is a decision for a person), read the counts again with " +
    "`npm run db:check-owners`, then run this migration again."
  );
}

/** Throws, naming every offending column, before any DDL, when a required column holds a NULL. */
export async function assertNoViolations(
  queryInterface: QueryInterface,
  step: string,
  columns: readonly RequiredColumn[],
  transaction: Transaction,
): Promise<void> {
  const violations = await findViolations(queryInterface.sequelize, columns, { transaction });
  if (violations.some((v) => v.count > 0)) {
    throw new Error(describeViolations(step, violations));
  }
}

interface ColumnDefinition {
  type: string;
  nullable: boolean;
  charset: string | null;
  collation: string | null;
  comment: string;
}

/** The column exactly as the database has it (type, charset, collation, comment), so a MODIFY changes nothing else. */
async function readColumn(
  queryInterface: QueryInterface,
  target: RequiredColumn,
  transaction: Transaction,
): Promise<ColumnDefinition | null> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, CHARACTER_SET_NAME AS cs,
            COLLATION_NAME AS coll, COLUMN_COMMENT AS comment
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    { replacements: [target.table, target.column], type: QueryTypes.SELECT, transaction },
  )) as Array<{ type?: string; nullable?: string; cs?: string | null; coll?: string | null; comment?: string }>;
  const r = rows[0];
  if (!r || typeof r.type !== "string") {
    return null;
  }
  return {
    type: r.type,
    nullable: String(r.nullable).toUpperCase() === "YES",
    charset: r.cs ?? null,
    collation: r.coll ?? null,
    comment: r.comment ?? "",
  };
}

/** `MODIFY COLUMN` text for the column as read, with the requested nullability. Identifiers are checked, the comment escaped. */
function modifyStatement(queryInterface: QueryInterface, target: RequiredColumn, def: ColumnDefinition, nullable: boolean): string {
  if (!COLUMN_TYPE.test(def.type)) {
    throw new Error(`Unexpected type for ${target.table}.${target.column}: ${def.type}`);
  }
  const charset = def.charset === null ? "" : ` CHARACTER SET ${identifier(def.charset)}`;
  const collation = def.collation === null ? "" : ` COLLATE ${identifier(def.collation)}`;
  const comment = def.comment === "" ? "" : ` COMMENT ${queryInterface.sequelize.escape(def.comment)}`;
  return (
    `ALTER TABLE \`${identifier(target.table)}\` MODIFY COLUMN \`${identifier(target.column)}\` ${def.type}` +
    `${charset}${collation} ${nullable ? "NULL DEFAULT NULL" : "NOT NULL"}${comment}`
  );
}

/**
 * Runs `work` with this connection in strict mode. Without it, MySQL turns a NULL
 * that slips in between the guard and a MODIFY into '' (a warning, not an error) and
 * the tightening "succeeds" with a value nobody chose; with it, the MODIFY fails
 * (1138) and changes nothing. The session's own mode is restored afterwards, even
 * when `work` throws. Nothing is sent when the mode is already strict.
 */
async function inStrictMode(queryInterface: QueryInterface, transaction: Transaction, work: () => Promise<void>): Promise<void> {
  const rows = (await queryInterface.sequelize.query("SELECT @@SESSION.sql_mode AS mode", {
    type: QueryTypes.SELECT,
    transaction,
  })) as Array<{ mode?: string }>;
  const original = String(rows[0]?.mode ?? "");
  const strict = original.split(",").some((m) => m === "STRICT_TRANS_TABLES" || m === "STRICT_ALL_TABLES");
  if (strict) {
    await work();
    return;
  }
  await queryInterface.sequelize.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_TRANS_TABLES')", { transaction });
  try {
    await work();
  } finally {
    await queryInterface.sequelize.query(`SET SESSION sql_mode = ${queryInterface.sequelize.escape(original)}`, { transaction });
  }
}

/**
 * Makes each column NOT NULL, keeping its type, charset, collation and comment as
 * the database reports them (a foreign key between two columns needs their
 * charsets to agree, and sibling tables differ between deployments). The
 * foreign key and the index stay as they are. A column that is already
 * required is skipped, so a re-run changes nothing and one that stopped halfway
 * finishes. No data is written. The connection is put in strict mode for the
 * MODIFYs (see `inStrictMode`).
 */
export async function requireColumns(
  queryInterface: QueryInterface,
  columns: readonly RequiredColumn[],
  transaction: Transaction,
): Promise<void> {
  await inStrictMode(queryInterface, transaction, async () => {
    for (const target of columns) {
      const def = await readColumn(queryInterface, target, transaction);
      if (def === null) {
        throw new Error(`${target.table}.${target.column} does not exist: run the earlier migrations first.`);
      }
      if (!def.nullable) {
        continue;
      }
      await queryInterface.sequelize.query(modifyStatement(queryInterface, target, def, false), { transaction });
    }
  });
}

/** The `down()` mirror: each column NULL again, in reverse order. A column or table already gone is skipped. Writes no data. */
export async function relaxColumns(
  queryInterface: QueryInterface,
  columns: readonly RequiredColumn[],
  transaction: Transaction,
): Promise<void> {
  for (const target of [...columns].reverse()) {
    const def = await readColumn(queryInterface, target, transaction);
    if (def === null || def.nullable) {
      continue;
    }
    await queryInterface.sequelize.query(modifyStatement(queryInterface, target, def, true), { transaction });
  }
}
