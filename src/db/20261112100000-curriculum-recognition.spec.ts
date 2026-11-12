/**
 * The per-tier recognition columns on `curriculums`. Drives up()/down() against a stand-in QueryInterface that keeps
 * the table's columns: it proves what the migration asks MySQL for, that every read carries the migration's own
 * transaction (a read on the pool would wait for the one connection the transaction holds), and what a re-run does.
 * The real run is in 20261112100000-curriculum-recognition.db.spec.ts (gated, scratch database only).
 */
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261112100000-curriculum-recognition");

const TX = { id: "the-transaction" };
const NEW = ["levelrecognition", "graderecognition", "curriculumrecognition"];

const makeDb = (columns: string[] = ["curriculumid", "curriculumname"], collation = { cs: "utf8mb4", coll: "utf8mb4_unicode_ci" }) => {
  const cols = new Set(columns);
  const statements: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reads: Array<{ what: string; opts: any }> = [];
  const queryInterface = {
    describeTable: jest.fn(async (_t: string, opts?: unknown) => {
      reads.push({ what: "describeTable", opts });
      return Object.fromEntries([...cols].map((c) => [c, {}]));
    }),
    removeColumn: jest.fn(async (_t: string, column: string, _opts?: unknown) => {
      cols.delete(column);
    }),
    sequelize: {
      transaction: jest.fn((cb: (t: unknown) => Promise<unknown>) => cb(TX)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
        statements.push(sql);
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          reads.push({ what: "collation", opts });
          expect(opts.replacements).toEqual(["curriculums"]);
          return [collation];
        }
        const added = /^ALTER TABLE `curriculums` ADD COLUMN `(\w+)`/.exec(sql);
        if (added) {
          cols.add(added[1]);
          return [[], 0];
        }
        throw new Error(`unexpected statement: ${sql}`);
      }),
    },
  };
  return { queryInterface, cols, statements, reads };
};

describe("20261112100000-curriculum-recognition", () => {
  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("adds the three columns VARCHAR(16) NOT NULL with the school defaults and the collation of curriculumname", async () => {
    const db = makeDb(undefined, { cs: "utf8mb4", coll: "utf8mb4_0900_ai_ci" });
    await migration.up(db.queryInterface);
    expect(db.statements.filter((s) => s.startsWith("ALTER"))).toEqual([
      "ALTER TABLE `curriculums` ADD COLUMN `levelrecognition` VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'award'",
      "ALTER TABLE `curriculums` ADD COLUMN `graderecognition` VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'certificate'",
      "ALTER TABLE `curriculums` ADD COLUMN `curriculumrecognition` VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'none'",
    ]);
    expect([...db.cols].sort()).toEqual(["curriculumid", "curriculumname", ...NEW].sort());
  });

  it("updates no row: the only statements are the column read and the three ALTERs", async () => {
    const db = makeDb();
    await migration.up(db.queryInterface);
    expect(db.statements.filter((s) => !/^ALTER TABLE `curriculums` ADD COLUMN/.test(s) && !/INFORMATION_SCHEMA/.test(s))).toEqual([]);
  });

  it("does every read, and every statement, on the migration's own transaction", async () => {
    const db = makeDb();
    await migration.up(db.queryInterface);
    expect(db.reads.map((r) => r.what)).toEqual(["describeTable", "collation"]);
    expect(db.reads[0].opts).toEqual({ transaction: TX });
    expect(db.reads[1].opts.transaction).toBe(TX);
    for (const call of db.queryInterface.sequelize.query.mock.calls) expect(call[1].transaction).toBe(TX);
  });

  it("is idempotent: a second run, and one that finds only some columns, changes only what is missing", async () => {
    const db = makeDb();
    await migration.up(db.queryInterface);
    const after = db.statements.length;
    await migration.up(db.queryInterface);
    expect(db.statements.slice(after).filter((s) => s.startsWith("ALTER"))).toEqual([]);

    const half = makeDb(["curriculumid", "curriculumname", "levelrecognition"]);
    await migration.up(half.queryInterface);
    expect(half.statements.filter((s) => s.startsWith("ALTER")).map((s) => /`(\w+recognition)`/.exec(s)?.[1])).toEqual(["graderecognition", "curriculumrecognition"]);
  });

  it("falls back to utf8mb4 / utf8mb4_unicode_ci when the table's column cannot be read", async () => {
    const db = makeDb();
    db.queryInterface.sequelize.query.mockImplementationOnce(async () => []);
    await migration.up(db.queryInterface);
    expect(db.statements.find((s) => s.startsWith("ALTER"))).toContain("CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  });

  it("down drops the three columns, and only those that are there", async () => {
    const db = makeDb(["curriculumid", "curriculumname", "levelrecognition", "curriculumrecognition"]);
    await migration.down(db.queryInterface);
    expect([...db.cols].sort()).toEqual(["curriculumid", "curriculumname"]);
    expect(db.queryInterface.removeColumn.mock.calls.map((c) => c[1])).toEqual(["levelrecognition", "curriculumrecognition"]);
    for (const call of db.queryInterface.removeColumn.mock.calls) expect(call[2]).toEqual({ transaction: TX });
  });
});
