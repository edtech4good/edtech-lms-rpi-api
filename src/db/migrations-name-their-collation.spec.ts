/**
 * Every migration that creates a table names its charset and collation.
 *
 * Why: the baseline tables are `utf8mb4_unicode_ci`. A table created with no collation takes the
 * DATABASE default, which on a stock MySQL 8 server is `utf8mb4_0900_ai_ci`; a foreign key from
 * that table to a baseline table is then refused ("Referencing column ... and referenced column
 * ... are incompatible") and `db:migrate` stops on a fresh database.
 *
 * How: this loads EVERY module under `src/db/migrations` (the directory is read, not listed here,
 * so a migration added later is covered without touching this file) and runs its `up()` against a
 * recording fake QueryInterface that answers the reads the migrations make. It runs twice:
 *   - in order, in one world, as `db:migrate` does on a fresh database; and
 *   - each migration alone on an EMPTY database, so a `createTable` behind an "already exists"
 *     early return (an old migration superseded by a baseline) is still reached.
 * Every `createTable` call must carry `charset: "utf8mb4"` and `collate: "utf8mb4_unicode_ci"`, and
 * every raw `CREATE TABLE` must say `COLLATE=utf8mb4_unicode_ci`. A migration that derives the pair
 * from a real column (`tableOptionsMatchingCurriculums`, which the baseline fixed) gets
 * `utf8mb4_unicode_ci` back from the fake, exactly as the baseline column answers on a real server.
 *
 * It did not run on MySQL: the real-server proof (a database whose default is `utf8mb4_0900_ai_ci`
 * migrating end to end) is in the change description.
 */
// A module (not a script), so the helpers below are not shared with the other specs.
export {};

import * as fs from "fs";
import * as path from "path";
import { Sequelize } from "sequelize";

const DIR = path.join(__dirname, "migrations");
const WANT_CHARSET = "utf8mb4";
const WANT_COLLATE = "utf8mb4_unicode_ci";

const files = fs
  .readdirSync(DIR)
  .filter((f) => /\.(ts|js)$/.test(f) && !/\.spec\.(ts|js)$/.test(f) && !/\.d\.ts$/.test(f))
  .sort();

type Create = { file: string; table: string; via: "createTable" | "sql"; charset?: unknown; collate?: unknown; sql?: string };

const TX = { id: "the-transaction" };

/** A world of tables, and a QueryInterface that records what is created in it. */
const makeWorld = (file: () => string, creates: Create[]) => {
  const tables = new Map<string, Record<string, unknown>>();
  const addTable = (name: string, cols: Record<string, unknown> = {}) => {
    tables.set(name, { ...(tables.get(name) ?? {}), ...cols });
  };

  const query = (sql: string, opts?: { replacements?: unknown[]; type?: string }): Promise<unknown> => {
    const created = /CREATE TABLE(?: IF NOT EXISTS)?\s+`?(\w+)`?/i.exec(sql);
    if (created) {
      addTable(created[1]);
      creates.push({ file: file(), table: created[1], via: "sql", sql });
      return Promise.resolve([[], 0]);
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sql) && /COLLATION_NAME|CHARACTER_SET_NAME/i.test(sql)) {
      // What a real baseline column answers: both `cs`/`coll` and `COLLATION_NAME` spellings are read.
      return Promise.resolve([[{ cs: WANT_CHARSET, coll: WANT_COLLATE, COLLATION_NAME: WANT_COLLATE, collation: WANT_COLLATE }]]);
    }
    if (/COUNT\(/i.test(sql)) {
      return Promise.resolve([[{ n: 0, c: 0, cnt: 0, count: 0, total: 0, "COUNT(*)": 0 }]]);
    }
    // With `type: SELECT` Sequelize answers the rows themselves; without it, [rows, metadata].
    return Promise.resolve(opts?.type === "SELECT" ? [] : [[]]);
  };

  const sequelize = {
    query: jest.fn(query),
    transaction: jest.fn((a: unknown, b?: unknown) => {
      const cb = (typeof a === "function" ? a : b) as ((t: unknown) => Promise<unknown>) | undefined;
      return cb ? cb(TX) : Promise.resolve({ commit: async () => undefined, rollback: async () => undefined });
    }),
    getDialect: () => "mysql",
    escape: (v: unknown) => `'${String(v)}'`,
    Sequelize,
  };

  const known: Record<string, unknown> = {
    sequelize,
    showAllTables: jest.fn(() => Promise.resolve([...tables.keys()])),
    describeTable: jest.fn((name: string) => Promise.resolve({ ...(tables.get(name) ?? {}) })),
    createTable: jest.fn((name: string, attrs: Record<string, unknown> = {}, options: { charset?: unknown; collate?: unknown } = {}) => {
      addTable(name, attrs);
      creates.push({ file: file(), table: name, via: "createTable", charset: options?.charset, collate: options?.collate });
      return Promise.resolve();
    }),
    dropTable: jest.fn((name: string) => {
      tables.delete(name);
      return Promise.resolve();
    }),
    addColumn: jest.fn((table: string, column: string, def: unknown) => {
      addTable(table, { [column]: def });
      return Promise.resolve();
    }),
    tableExists: jest.fn((name: string) => Promise.resolve(tables.has(name))),
  };

  // Anything else (addIndex, addConstraint, changeColumn, bulkUpdate ...) is accepted and ignored.
  const qi = new Proxy(known, {
    get: (target, prop: string) => (prop in target ? target[prop] : jest.fn(() => Promise.resolve([]))),
  });
  return { qi, tables };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (f: string): any => require(path.join(DIR, f));

const creates: Create[] = [];
const ranPartial: string[] = [];
const seqStopped: string[] = [];
let current = "";

beforeAll(async () => {
  // Some migrations log what they back-filled; that is noise here.
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  // 1. In order, one world: what `db:migrate` does on a fresh database.
  const seq = makeWorld(() => current, creates);
  for (const f of files) {
    current = f;
    try {
      await load(f).up(seq.qi, Sequelize);
    } catch {
      // A migration that reads real column definitions (the NOT NULL ones) has nothing to read in
      // a fake; none of them creates a table, and the coverage test below would say if one did.
      seqStopped.push(f);
    }
  }
  // 2. Each migration alone on an empty database: reaches a createTable that an early return hides.
  for (const f of files) {
    current = f;
    const alone = makeWorld(() => current, creates);
    try {
      await load(f).up(alone.qi, Sequelize);
    } catch {
      // A migration that alters a table that is not there stops here; whatever it created before
      // stopping is already recorded and checked.
      ranPartial.push(f);
    }
  }
});

const problems = (c: Create): string[] => {
  if (c.via === "createTable") {
    const out: string[] = [];
    if (c.charset !== WANT_CHARSET) {
      out.push(`charset is ${JSON.stringify(c.charset)}`);
    }
    if (c.collate !== WANT_COLLATE) {
      out.push(`collate is ${JSON.stringify(c.collate)}`);
    }
    return out;
  }
  return new RegExp(`COLLATE\\s*=?\\s*${WANT_COLLATE}\\b`, "i").test(c.sql ?? "") ? [] : ["raw CREATE TABLE has no COLLATE=utf8mb4_unicode_ci"];
};

describe("migrations name their collation", () => {
  it("reads the migrations directory (there are migrations to check)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every createTable and raw CREATE TABLE an up() issues carries utf8mb4 / utf8mb4_unicode_ci", () => {
    const offenders = creates
      .flatMap((c) => problems(c).map((p) => `${c.file}: ${c.table} (${c.via}): ${p}`))
      .filter((v, i, all) => all.indexOf(v) === i);
    expect(offenders).toEqual([]);
  });

  it("reached a create in every migration whose source creates a table (or names the fallback)", () => {
    const reached = new Set(creates.map((c) => c.file));
    const mentions = files.filter((f) => /createTable\s*\(|CREATE TABLE/i.test(fs.readFileSync(path.join(DIR, f), "utf8")));
    const unreached = mentions.filter((f) => !reached.has(f));
    // Fallback for a migration whose up() the fake cannot drive to its create: its source must not
    // name a collation other than unicode_ci. The list is empty today; if it grows, say why.
    expect(unreached).toEqual([]);
    for (const f of unreached) {
      expect(fs.readFileSync(path.join(DIR, f), "utf8")).not.toMatch(/0900|general_ci/);
    }
  });

  it("a migration's own source never asks for a collation other than utf8mb4_unicode_ci", () => {
    const offenders = files.filter((f) => /utf8mb4_0900|utf8mb3|general_ci|utf8_/.test(fs.readFileSync(path.join(DIR, f), "utf8").replace(/^\s*\/\/.*$/gm, "")));
    expect(offenders).toEqual([]);
  });

  it("the fake drove at least the baseline's creates (the check is not vacuous)", () => {
    const tablesCreated = new Set(creates.map((c) => c.table));
    for (const t of ["schools", "curriculums", "students", "studentlearningsprogress", "organisations"]) {
      expect(tablesCreated.has(t)).toBe(true);
    }
    expect(creates.length).toBeGreaterThanOrEqual(30);
  });

  it("a migration the fake could not run to the end creates no table in its source", () => {
    // Whatever it created before stopping is checked above; this keeps a create from hiding after the stop.
    const stoppedInBoth = seqStopped.filter((f) => ranPartial.includes(f));
    const hiding = stoppedInBoth.filter((f) => /createTable\s*\(|CREATE TABLE/i.test(fs.readFileSync(path.join(DIR, f), "utf8")));
    expect(hiding).toEqual([]);
  });
});

afterAll(() => {
  jest.restoreAllMocks();
});
