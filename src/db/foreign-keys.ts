import { QueryInterface, QueryTypes, Transaction } from "sequelize";

/**
 * The foreign keys and the NOT NULL columns that `20261026120000-foreign-keys-and-not-nulls` adds. One list
 * serves the migration, its spec and the writer specs, so they cannot drift apart. It is the student-side twin
 * of the central API's `20261023120000-foreign-keys-and-not-nulls` list, cut to the tables this API has:
 * central's `feedbacks`, `schoolcontributedata`, `syncrecords`, `lmsusers_roles`, `permissions`,
 * `permissionstitle` and `roles_permissions` do not exist here, which leaves 15 of its 19 keys and the six
 * `studentpoints` totals of its 14 NOT NULLs.
 *
 * The models declare some of these references and not others, and the list is the database's, not the models':
 * `initModels` declares 25 references (24 of them constrained; `baselinequestion.questionid` is the one without
 * a key), and `setuprelationshipforreport`, which `src/server.ts` calls at every boot, adds 8 more `belongsTo`,
 * among them six of this migration's columns and the polymorphic `studentprogress.studentprogressreferenceid`.
 * Only the `initModels` ones exist when `sync()` runs, and `sync()` never alters an existing table, so the models
 * add or change no key. Every one of these columns is written by a route that refuses first (see
 * `src/business/roster-refs.ts`), so the database's own refusal is never the answer.
 *
 * `studentprogress.studentprogressreferenceid` is polymorphic (it names a lesson quiz or a lesson practice, by
 * `progresstype`) and is NOT here: it can have no foreign key.
 */
export interface ForeignKeySpec {
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
  /**
   * The name of the single-column index the migration creates first, for a column no index leads
   * with. Absent when an index already leads with the column (a `20261008130000-indexes-sync-created`
   * index, or a composite that starts with `studentid`): the foreign key uses that one.
   */
  index?: string;
}

const fk = (table: string, column: string, parentTable: string, parentColumn: string, index?: string): ForeignKeySpec => ({
  table,
  column,
  parentTable,
  parentColumn,
  ...(index ? { index } : {}),
});

/** In the order they are added; `down()` takes them in reverse. */
export const FOREIGN_KEYS: readonly ForeignKeySpec[] = [
  fk("rpiuseraccess", "userid", "schoolusers", "schooluserid", "userid"),
  fk("studentappusages", "schooluserid", "schoolusers", "schooluserid"),
  fk("studentgradesprogress", "curriculumid", "curriculums", "curriculumid"),
  fk("studentgradesprogress", "gradeid", "grades", "gradeid"),
  fk("studentgradesprogress", "studentid", "students", "studentid"),
  fk("studentlessonsprogress", "curid", "curriculums", "curriculumid"),
  fk("studentlessonsprogress", "gradeid", "grades", "gradeid"),
  fk("studentlessonsprogress", "lessonid", "lessons", "lessonid"),
  fk("studentlessonsprogress", "levelid", "levels", "levelid"),
  fk("studentlessonsprogress", "studentid", "students", "studentid"),
  fk("studentlevelsprogress", "curid", "curriculums", "curriculumid"),
  fk("studentlevelsprogress", "gradeid", "grades", "gradeid"),
  fk("studentlevelsprogress", "levelid", "levels", "levelid"),
  fk("studentlevelsprogress", "studentid", "students", "studentid"),
  fk("students", "standard", "standards", "standardid", "standard"),
];

/** The constraint's name. */
export const foreignKeyName = (s: Pick<ForeignKeySpec, "table" | "column">): string => `${s.table}_${s.column}_fk`;

/** What a failed write to a child column is called in a message a person reads. */
export const describeForeignKey = (s: ForeignKeySpec): string => `${s.table}.${s.column} -> ${s.parentTable}.${s.parentColumn}`;

/** Columns the models declare `allowNull: false` and the database still lets be NULL. */
export interface NotNullSpec {
  table: string;
  column: string;
}

export const NOT_NULL_COLUMNS: readonly NotNullSpec[] = [
  ...["scores", "totalgradepoints", "totallearningpoints", "totallevelpoints", "totalpracticepoints", "totalquizpoints"].map((column) => ({
    table: "studentpoints",
    column,
  })),
];

const SQL_NAME = /^[A-Za-z0-9_]+$/;

/** Every identifier in these statements is a constant of this module; this makes that a checked fact. */
export const sqlName = (value: string): string => {
  if (!SQL_NAME.test(value)) {
    throw new Error(`Unexpected identifier: ${value}`);
  }
  return value;
};

/** How many dangling values a refusal lists per foreign key. The count is always exact. */
export const LISTED_VALUES = 10;

export interface DanglingCount {
  spec: ForeignKeySpec;
  count: number;
  /** A sample of the values (ids, never names), at most LISTED_VALUES, in order. */
  values: string[];
}

export interface NullCount {
  spec: NotNullSpec;
  count: number;
}

interface Queryable {
  query: (sql: string, options: { type: QueryTypes.SELECT; transaction?: Transaction }) => Promise<unknown>;
}

/**
 * Child values that name no parent row, per foreign key: all rows, soft-deleted included (an id is identity,
 * not liveness). NULL is not dangling. Read-only. A key whose child table is not in `tables` is skipped.
 */
export async function countDangling(
  db: Queryable,
  specs: readonly ForeignKeySpec[],
  tables: ReadonlySet<string>,
  transaction?: Transaction,
): Promise<DanglingCount[]> {
  const out: DanglingCount[] = [];
  for (const spec of specs) {
    if (!tables.has(spec.table)) {
      continue;
    }
    if (!tables.has(spec.parentTable)) {
      throw new Error(`${spec.parentTable} does not exist (parent of ${describeForeignKey(spec)}): run the earlier migrations first.`);
    }
    const [t, c, p, pc] = [spec.table, spec.column, spec.parentTable, spec.parentColumn].map(sqlName);
    const from = `FROM \`${t}\` AS child WHERE child.\`${c}\` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM \`${p}\` AS parent WHERE parent.\`${pc}\` = child.\`${c}\`)`;
    const counted = (await db.query(`SELECT COUNT(*) AS n ${from}`, { type: QueryTypes.SELECT, transaction })) as Array<{ n: number | string }>;
    const count = Number(counted[0]?.n ?? 0);
    let values: string[] = [];
    if (count > 0) {
      const rows = (await db.query(`SELECT DISTINCT child.\`${c}\` AS value ${from} ORDER BY child.\`${c}\` LIMIT ${LISTED_VALUES}`, {
        type: QueryTypes.SELECT,
        transaction,
      })) as Array<{ value: string }>;
      values = rows.map((r) => String(r.value));
    }
    out.push({ spec, count, values });
  }
  return out;
}

/** Rows holding NULL in a column that is about to become NOT NULL, per column. Read-only. */
export async function countNulls(
  db: Queryable,
  specs: readonly NotNullSpec[],
  tables: ReadonlySet<string>,
  transaction?: Transaction,
): Promise<NullCount[]> {
  const out: NullCount[] = [];
  for (const spec of specs) {
    if (!tables.has(spec.table)) {
      continue;
    }
    const counted = (await db.query(`SELECT COUNT(*) AS n FROM \`${sqlName(spec.table)}\` WHERE \`${sqlName(spec.column)}\` IS NULL`, {
      type: QueryTypes.SELECT,
      transaction,
    })) as Array<{ n: number | string }>;
    out.push({ spec, count: Number(counted[0]?.n ?? 0) });
  }
  return out;
}

/** The refusal: every offending column with its count, then "Nothing was changed." */
export function describeRefusal(dangling: readonly DanglingCount[], nulls: readonly NullCount[]): string {
  const lines = [
    ...dangling
      .filter((d) => d.count > 0)
      .map((d) => {
        const shown = d.values.length < d.count ? `, first ${d.values.length} distinct values` : "";
        return `${describeForeignKey(d.spec)}: ${d.count} row(s) name a ${d.spec.parentTable} row that does not exist (${d.values.join(", ")}${shown})`;
      }),
    ...nulls.filter((n) => n.count > 0).map((n) => `${n.spec.table}.${n.spec.column}: ${n.count} row(s) hold NULL`),
  ];
  return (
    `Foreign keys and NOT NULLs refused: ${lines.length} column(s) hold rows that break them.\n${lines.join("\n")}\n` +
    "Nothing was changed. Fix or remove those rows (a row that names a parent that is not there is data nobody can reach), " +
    "then run this migration again."
  );
}

/** Throws ONE error naming every offending column, before any DDL, when a foreign key or NOT NULL would be refused. */
export async function assertNoViolations(
  queryInterface: QueryInterface,
  tables: ReadonlySet<string>,
  transaction: Transaction,
): Promise<void> {
  const dangling = await countDangling(queryInterface.sequelize, FOREIGN_KEYS, tables, transaction);
  const nulls = await countNulls(queryInterface.sequelize, NOT_NULL_COLUMNS, tables, transaction);
  if (dangling.some((d) => d.count > 0) || nulls.some((n) => n.count > 0)) {
    throw new Error(describeRefusal(dangling, nulls));
  }
}
