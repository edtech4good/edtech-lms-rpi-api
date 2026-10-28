/**
 * The 15 foreign keys and six NOT NULLs of the student API. Drives up()/down() against a stand-in for the part of
 * MySQL they touch (indexes, foreign keys, the six column definitions, the rows that break a key or a NOT NULL),
 * which refuses what MySQL refuses: a key with no index leading its column, a key over a dangling value, a NOT NULL
 * over a NULL, and the drop of an index a key still uses (ERROR 1553). It proves what the migration ASKS MySQL for
 * and in what order; that a real migrated database holds the 15 keys, and that migrate, undo, migrate gives the
 * same schema, was run on real MySQL 8 (see the change description).
 */
import { Sequelize } from "sequelize";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { FOREIGN_KEYS, NOT_NULL_COLUMNS } from "./foreign-keys";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261026120000-foreign-keys-and-not-nulls");

const TX = { id: "the-transaction" };

/** Written out independently of the migration's list: child.column -> parent.column. */
const EXPECTED_FKS = [
  "rpiuseraccess.userid>schoolusers.schooluserid",
  "studentappusages.schooluserid>schoolusers.schooluserid",
  "studentgradesprogress.curriculumid>curriculums.curriculumid",
  "studentgradesprogress.gradeid>grades.gradeid",
  "studentgradesprogress.studentid>students.studentid",
  "studentlessonsprogress.curid>curriculums.curriculumid",
  "studentlessonsprogress.gradeid>grades.gradeid",
  "studentlessonsprogress.lessonid>lessons.lessonid",
  "studentlessonsprogress.levelid>levels.levelid",
  "studentlessonsprogress.studentid>students.studentid",
  "studentlevelsprogress.curid>curriculums.curriculumid",
  "studentlevelsprogress.gradeid>grades.gradeid",
  "studentlevelsprogress.levelid>levels.levelid",
  "studentlevelsprogress.studentid>students.studentid",
  "students.standard>standards.standardid",
];

/** The two columns no index leads with on a migrated database: the migration makes one named after the column. */
const NEW_INDEXES = ["rpiuseraccess.userid", "students.standard"];

const NOT_NULLS = ["scores", "totalgradepoints", "totallearningpoints", "totallevelpoints", "totalpracticepoints", "totalquizpoints"].map((c) => `studentpoints.${c}`);

const PARENTS = ["curriculums", "grades", "lessons", "levels", "schoolusers", "standards", "students"];
const CHILDREN = [...new Set(EXPECTED_FKS.map((f) => f.split(".")[0]))];
const ALL_TABLES = [...PARENTS, ...CHILDREN, "studentpoints"];

describe("the lists match the models", () => {
  it("lists the 15 foreign keys of the student API, the 2 new indexes and the 6 NOT NULLs", () => {
    expect(FOREIGN_KEYS.map((s) => `${s.table}.${s.column}>${s.parentTable}.${s.parentColumn}`)).toEqual(EXPECTED_FKS);
    expect(EXPECTED_FKS).toHaveLength(15);
    expect(FOREIGN_KEYS.filter((s) => s.index).map((s) => `${s.table}.${s.index}`)).toEqual(NEW_INDEXES);
    expect(NOT_NULL_COLUMNS.map((s) => `${s.table}.${s.column}`)).toEqual(NOT_NULLS);
    expect(NOT_NULLS).toHaveLength(6);
  });

  /** Every reference the models declare: `table.column` -> `parentTable.parentColumn`. */
  const declaredReferences = (sequelize: Sequelize): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of Object.values(sequelize.models)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [column, attribute] of Object.entries(m.rawAttributes as Record<string, any>)) {
        const ref = attribute.references;
        if (!ref) continue;
        const parent = typeof ref.model === "string" ? ref.model : (ref.model.tableName ?? ref.model.table ?? String(ref.model));
        out.set(`${String(m.getTableName())}.${column}`, `${parent}.${ref.key}`);
      }
    }
    return out;
  };

  it("the child and parent columns of all 15 keys are columns of the compiled models; the models declare some of these references (initModels) and the boot path adds more, never a different one", () => {
    const sequelize = new Sequelize("none", "none", "none", { dialect: "mysql" });
    initModels(sequelize);
    const byTable = new Map(Object.values(sequelize.models).map((m) => [String(m.getTableName()), m]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributes = (table: string): Record<string, any> => byTable.get(table)!.rawAttributes as any;
    for (const s of FOREIGN_KEYS) {
      expect(attributes(s.table)[s.column]).toBeDefined();
      expect(attributes(s.parentTable)[s.parentColumn]).toBeDefined();
    }
    const parentOf = new Map(FOREIGN_KEYS.map((s) => [`${s.table}.${s.column}`, `${s.parentTable}.${s.parentColumn}`]));
    // initModels alone (what exists when sync() runs): 25 references. A reference on one of our 15 columns must be the key's own.
    const initial = declaredReferences(sequelize);
    expect(initial.size).toBe(25);
    for (const [column, parent] of initial) {
      if (parentOf.has(column)) expect(parent).toBe(parentOf.get(column));
    }
    // the polymorphic column is no key: it names a quiz, a practice or a baseline, and initModels declares nothing on it
    expect(initial.has("studentprogress.studentprogressreferenceid")).toBe(false);

    // the boot path (src/server.ts calls this after initModels): 8 more belongsTo, six of them on columns of this migration
    setuprelationshipforreport(sequelize);
    const boot = declaredReferences(sequelize);
    expect(boot.size).toBe(33);
    const added = [...boot.keys()].filter((c) => !initial.has(c)).sort();
    expect(added.filter((c) => parentOf.has(c))).toHaveLength(6);
    expect(added).toContain("studentprogress.studentprogressreferenceid");
    for (const [column, parent] of boot) {
      // the polymorphic column is the one declared reference without a key behind it, and it must stay so: the migration adds none
      if (column === "studentprogress.studentprogressreferenceid") continue;
      if (parentOf.has(column)) expect(parent).toBe(parentOf.get(column));
    }
    expect(parentOf.has("studentprogress.studentprogressreferenceid")).toBe(false);
  });

  it("each of the 6 columns is declared allowNull: false by its model", () => {
    const sequelize = new Sequelize("none", "none", "none", { dialect: "mysql" });
    initModels(sequelize);
    const byTable = new Map(Object.values(sequelize.models).map((m) => [String(m.getTableName()), m]));
    for (const s of NOT_NULL_COLUMNS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((byTable.get(s.table)!.rawAttributes as any)[s.column].allowNull).toBe(false);
    }
  });
});

interface Ix {
  name: string;
  columns: string[];
}
interface Key {
  name: string;
  table: string;
  column: string;
  parentTable: string;
  parentColumn: string;
}
interface Col {
  type: string;
  nullable: boolean;
  def: string | null;
  extra: string;
  cs: string | null;
  coll: string | null;
  comment: string;
}

/**
 * What a migrated database has before this migration (read from a migrated, seeded MySQL 8): the single-column indexes of
 * `20261008130000-indexes-sync-created` and the composites that lead with studentid from the create-table migrations.
 */
const migratedIndexes = (): Map<string, Ix[]> => {
  const m = new Map<string, Ix[]>(ALL_TABLES.map((t) => [t, [{ name: "PRIMARY", columns: [`${t}id`] }]]));
  m.get("studentappusages")!.push({ name: "schooluserid", columns: ["schooluserid"] });
  m.get("studentgradesprogress")!.push({ name: "studentid", columns: ["studentid"] }, { name: "gradeid", columns: ["gradeid"] }, { name: "curriculumid", columns: ["curriculumid"] }, { name: "studentgradesprogress_studentid_gradeid_curriculumid", columns: ["studentid", "gradeid", "curriculumid"] });
  m.get("studentlevelsprogress")!.push({ name: "studentid", columns: ["studentid"] }, { name: "levelid", columns: ["levelid"] }, { name: "gradeid", columns: ["gradeid"] }, { name: "curid", columns: ["curid"] }, { name: "studentlevelsprogress_studentid_levelid_gradeid_curid", columns: ["studentid", "levelid", "gradeid", "curid"] });
  m.get("studentlessonsprogress")!.push({ name: "studentid", columns: ["studentid"] }, { name: "lessonid", columns: ["lessonid"] }, { name: "levelid", columns: ["levelid"] }, { name: "gradeid", columns: ["gradeid"] }, { name: "curid", columns: ["curid"] }, { name: "studentlessonsprogress_studentid_lessonid_levelid_gradeid_curid", columns: ["studentid", "lessonid", "levelid", "gradeid", "curid"] });
  return m;
};

const unsignedInt = (): Col => ({ type: "int unsigned", nullable: true, def: null, extra: "", cs: null, coll: null, comment: "" });
const columns = (): Map<string, Col> => new Map(NOT_NULLS.map((k) => [k, unsignedInt()]));

interface Opts {
  /** child.column -> values that name no parent row. */
  dangling?: Record<string, string[]>;
  /** table.column -> how many rows hold NULL. */
  nulls?: Record<string, number>;
  indexes?: Map<string, Ix[]>;
  keys?: Key[];
  cols?: Map<string, Col>;
  missing?: string[];
  sqlMode?: string;
}

/** The stand-in. `log` has every statement and every addConstraint/removeConstraint call, in order. */
const makeQI = (opts: Opts = {}) => {
  const indexes = opts.indexes ?? migratedIndexes();
  const keys = opts.keys ?? [];
  const cols = opts.cols ?? columns();
  const dangling = opts.dangling ?? {};
  const nulls = opts.nulls ?? {};
  const missing = new Set(opts.missing ?? []);
  let mode = opts.sqlMode ?? "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION";
  const log: string[] = [];
  const txOf = new Map<string, unknown>();
  const writes: string[] = [];

  const led = (table: string, column: string) => (indexes.get(table) ?? []).some((i) => i.columns[0] === column);
  const stillUsed = (table: string) => keys.filter((k) => k.table === table && !led(table, k.column));

  const query = jest.fn((sql: string, o?: { replacements?: string[]; transaction?: unknown }): Promise<unknown> => {
    log.push(sql);
    txOf.set(sql, o?.transaction);
    if (/^\s*(UPDATE|INSERT|DELETE|REPLACE)/i.test(sql)) writes.push(sql);

    let m = /^SELECT (COUNT\(\*\) AS n|DISTINCT child\.`(\w+)` AS value) FROM `(\w+)` AS child WHERE child\.`(\w+)` IS NOT NULL/.exec(sql);
    if (m) {
      const values = [...new Set(dangling[`${m[3]}.${m[4]}`] ?? [])].sort();
      if (m[1].startsWith("COUNT")) return Promise.resolve([{ n: (dangling[`${m[3]}.${m[4]}`] ?? []).length }]);
      const limit = Number(/LIMIT (\d+)$/.exec(sql)![1]);
      return Promise.resolve(values.slice(0, limit).map((value) => ({ value })));
    }
    m = /^SELECT COUNT\(\*\) AS n FROM `(\w+)` WHERE `(\w+)` IS NULL/.exec(sql);
    if (m) return Promise.resolve([{ n: nulls[`${m[1]}.${m[2]}`] ?? 0 }]);

    if (/FROM information_schema\.statistics/.test(sql)) {
      const table = o!.replacements![0];
      return Promise.resolve((indexes.get(table) ?? []).flatMap((i) => i.columns.map((c, at) => ({ name: i.name, col: c, seq: at + 1 }))));
    }
    if (/FROM information_schema\.KEY_COLUMN_USAGE/.test(sql)) {
      const table = o!.replacements![0];
      return Promise.resolve(keys.filter((k) => k.table === table).map((k) => ({ name: k.name, col: k.column, ptable: k.parentTable, pcol: k.parentColumn })));
    }
    if (/FROM INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
      const c = cols.get(`${o!.replacements![0]}.${o!.replacements![1]}`);
      return Promise.resolve(c ? [{ type: c.type, nullable: c.nullable ? "YES" : "NO", def: c.def, extra: c.extra, cs: c.cs, coll: c.coll, comment: c.comment }] : []);
    }
    if (/SELECT @@SESSION\.sql_mode/.test(sql)) return Promise.resolve([{ mode }]);
    const set = /^SET SESSION sql_mode = (.*)$/.exec(sql);
    if (set) {
      mode = set[1].startsWith("CONCAT") ? `${mode},STRICT_TRANS_TABLES` : set[1].replace(/^'|'$/g, "");
      return Promise.resolve([]);
    }

    const add = /^ALTER TABLE `(\w+)` ADD INDEX `(\w+)` USING BTREE \(`(\w+)`\)$/.exec(sql);
    if (add) {
      const list = indexes.get(add[1])!;
      if (list.some((i) => i.name === add[2])) throw new Error(`Duplicate key name '${add[2]}'`);
      list.push({ name: add[2], columns: [add[3]] });
      return Promise.resolve([]);
    }
    const drop = /^ALTER TABLE `(\w+)` DROP INDEX `(\w+)`$/.exec(sql);
    if (drop) {
      const list = indexes.get(drop[1])!;
      const at = list.findIndex((i) => i.name === drop[2]);
      if (at < 0) throw new Error(`Can't DROP '${drop[2]}'; check that column/key exists`);
      const [gone] = list.splice(at, 1);
      if (stillUsed(drop[1]).length > 0) {
        list.splice(at, 0, gone);
        throw new Error("ERROR 1553: Cannot drop index needed in a foreign key constraint");
      }
      return Promise.resolve([]);
    }
    const modify = /^ALTER TABLE `(\w+)` MODIFY COLUMN `(\w+)` (.*?) (NOT NULL|NULL)( DEFAULT .+?)?$/.exec(sql);
    if (modify) {
      const key = `${modify[1]}.${modify[2]}`;
      const c = cols.get(key)!;
      if (modify[4] === "NOT NULL" && (nulls[key] ?? 0) > 0) {
        if (/STRICT_(TRANS|ALL)_TABLES/.test(mode)) throw new Error("Invalid use of NULL value");
      }
      c.nullable = modify[4] === "NULL";
      c.def = modify[5] ? modify[5].replace(/^ DEFAULT /, "") : null;
      if (c.def === "NULL") c.def = null;
      return Promise.resolve([]);
    }
    throw new Error(`unexpected statement: ${sql}`);
  });

  const calls: string[] = [];
  const qi = {
    showAllTables: jest.fn(() => Promise.resolve(ALL_TABLES.filter((t) => !missing.has(t)))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addConstraint: jest.fn(async (table: string, o: any) => {
      expect(o.type).toBe("foreign key");
      expect(o.onUpdate).toBe("CASCADE");
      expect(o.onDelete).toBe("RESTRICT");
      expect(o.transaction).toBe(TX);
      expect(o.fields).toHaveLength(1);
      const [column] = o.fields as string[];
      calls.push(`add ${o.name}`);
      log.push(`addConstraint ${o.name}`);
      if (keys.some((k) => k.name === o.name)) throw new Error(`Duplicate foreign key constraint name '${o.name}'`);
      if (!led(table, column)) throw new Error(`Failed to add the foreign key constraint. Missing index for constraint '${o.name}'`);
      if ((dangling[`${table}.${column}`] ?? []).length > 0) throw new Error(`Cannot add or update a child row: a foreign key constraint fails (${o.name})`);
      keys.push({ name: o.name, table, column, parentTable: o.references.table, parentColumn: o.references.field });
    }),
    removeConstraint: jest.fn(async (table: string, name: string, o?: { transaction?: unknown }) => {
      expect(o?.transaction).toBe(TX);
      calls.push(`remove ${name}`);
      log.push(`removeConstraint ${name}`);
      const at = keys.findIndex((k) => k.table === table && k.name === name);
      if (at < 0) throw new Error(`Can't DROP '${name}'; check that column/key exists`);
      keys.splice(at, 1);
    }),
    sequelize: {
      query,
      escape: (v: string) => `'${v}'`,
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, indexes, keys, cols, log, calls, txOf, writes, mode: () => mode };
};

const keyNames = (keys: Key[]) => keys.map((k) => `${k.table}.${k.column}>${k.parentTable}.${k.parentColumn}`).sort();
const alters = (log: string[]) => log.filter((s) => /^ALTER TABLE/.test(s));
const ixList = (indexes: Map<string, Ix[]>) => [...indexes.entries()].flatMap(([t, l]) => l.map((i) => `${t}.${i.name}:${i.columns.join("+")}`)).sort();

describe("the guard", () => {
  it("one dangling value in any single one of the 15 columns refuses, names that column and its count, and changes nothing", async () => {
    for (const s of FOREIGN_KEYS) {
      const f = makeQI({ dangling: { [`${s.table}.${s.column}`]: ["gone-1", "gone-2"] } });
      const err = await migration.up(f.qi).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain(`${s.table}.${s.column} -> ${s.parentTable}.${s.parentColumn}: 2 row(s) name a ${s.parentTable} row that does not exist (gone-1, gone-2)`);
      expect(err.message).toContain("Nothing was changed.");
      expect(err.message.match(/row\(s\)/g)).toHaveLength(1);
      expect(alters(f.log)).toEqual([]);
      expect(f.calls).toEqual([]);
    }
  });

  it("a NULL in any single one of the 6 columns refuses, names that column and its count, and changes nothing", async () => {
    for (const k of NOT_NULLS) {
      const f = makeQI({ nulls: { [k]: 3 } });
      const err = await migration.up(f.qi).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain(`${k}: 3 row(s) hold NULL`);
      expect(err.message).toContain("Nothing was changed.");
      expect(err.message.match(/row\(s\)/g)).toHaveLength(1);
      expect(alters(f.log)).toEqual([]);
      expect(f.calls).toEqual([]);
    }
  });

  it("with all 21 columns offending, ONE error names every one of them", async () => {
    const dangling = Object.fromEntries(FOREIGN_KEYS.map((s) => [`${s.table}.${s.column}`, ["x"]]));
    const nulls = Object.fromEntries(NOT_NULLS.map((k) => [k, 1]));
    const f = makeQI({ dangling, nulls });
    const err = await migration.up(f.qi).catch((e: Error) => e);
    expect(err.message.match(/row\(s\)/g)).toHaveLength(21);
    for (const k of NOT_NULLS) expect(err.message).toContain(k);
    for (const s of FOREIGN_KEYS) expect(err.message).toContain(`${s.table}.${s.column} ->`);
    expect(alters(f.log)).toEqual([]);
  });

  it("counts everything BEFORE the first DDL, and lists a sample of at most 10 dangling values with the exact count", async () => {
    const many = Array.from({ length: 25 }, (_, i) => `id-${String(i).padStart(2, "0")}`);
    const f = makeQI({ dangling: { "studentlessonsprogress.curid": many } });
    const err = await migration.up(f.qi).catch((e: Error) => e);
    expect(err.message).toContain("25 row(s) name a curriculums row that does not exist (id-00, id-01, id-02, id-03, id-04, id-05, id-06, id-07, id-08, id-09, first 10 distinct values)");
  });

  it("does not count a NULL child value as dangling (the count query excludes NULL)", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.log.filter((s) => /AS child WHERE/.test(s)).every((s) => /IS NOT NULL AND NOT EXISTS/.test(s))).toBe(true);
  });
});

describe("up() on a migrated database", () => {
  it("creates the two indexes first, each named after its column, and nothing else of the kind", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const adds = alters(f.log).filter((s) => /ADD INDEX/.test(s));
    expect(adds).toEqual([
      "ALTER TABLE `rpiuseraccess` ADD INDEX `userid` USING BTREE (`userid`)",
      "ALTER TABLE `students` ADD INDEX `standard` USING BTREE (`standard`)",
    ]);
    const lastIndex = f.log.map((s, i) => (/ADD INDEX/.test(s) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstKey = f.log.findIndex((s) => /^addConstraint/.test(s));
    expect(lastIndex).toBeLessThan(firstKey);
    const want = migratedIndexes();
    for (const k of NEW_INDEXES) {
      const [t, c] = k.split(".");
      want.get(t)!.push({ name: c, columns: [c] });
    }
    expect(ixList(f.indexes)).toEqual(ixList(want));
  });

  it("adds exactly the 15 foreign keys, each named <table>_<column>_fk", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.keys).toHaveLength(15);
    expect(keyNames(f.keys)).toEqual([...EXPECTED_FKS].sort());
    expect(f.keys.map((k) => k.name).sort()).toEqual(EXPECTED_FKS.map((e) => `${e.split(">")[0].replace(".", "_")}_fk`).sort());
    expect(f.qi.addConstraint).toHaveBeenCalledTimes(15);
  });

  it("adds no key for studentprogress.studentprogressreferenceid", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.keys.some((k) => k.table === "studentprogress")).toBe(false);
    expect(f.log.join("\n")).not.toContain("studentprogress");
  });

  it("makes the 6 columns NOT NULL keeping their type and default: the six integers keep no default", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const modifies = alters(f.log).filter((s) => /MODIFY/.test(s));
    expect(modifies).toEqual(
      ["scores", "totalgradepoints", "totallearningpoints", "totallevelpoints", "totalpracticepoints", "totalquizpoints"].map(
        (c) => `ALTER TABLE \`studentpoints\` MODIFY COLUMN \`${c}\` int unsigned NOT NULL`,
      ),
    );
    for (const k of NOT_NULLS) expect(f.cols.get(k)!.nullable).toBe(false);
    expect(f.cols.get("studentpoints.scores")!.def).toBeNull();
  });

  it("a column that has a DEFAULT keeps it in the NOT NULL MODIFY (only its nullability changes)", async () => {
    const cols = columns();
    cols.get("studentpoints.scores")!.def = "0";
    const f = makeQI({ cols });
    await migration.up(f.qi);
    const modifies = alters(f.log).filter((s) => /MODIFY/.test(s));
    expect(modifies).toContain("ALTER TABLE `studentpoints` MODIFY COLUMN `scores` int unsigned NOT NULL DEFAULT '0'");
    expect(modifies.filter((s) => /DEFAULT/.test(s))).toHaveLength(1);
    expect(f.cols.get("studentpoints.scores")!.nullable).toBe(false);
    expect(f.cols.get("studentpoints.scores")!.def).toBe("'0'");
  });

  it("writes no data and runs every read and statement in the transaction", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.writes).toEqual([]);
    expect(f.qi.sequelize.transaction).toHaveBeenCalledTimes(1);
    for (const sql of f.log.filter((s) => /information_schema|INFORMATION_SCHEMA|^ALTER/.test(s))) expect(f.txOf.get(sql)).toBe(TX);
  });

  it("refuses a column or type it does not understand rather than guess", async () => {
    const cols = columns();
    cols.get("studentpoints.scores")!.extra = "auto_increment";
    await expect(migration.up(makeQI({ cols }).qi)).rejects.toThrow("Unexpected EXTRA for studentpoints.scores");
    const odd = columns();
    odd.get("studentpoints.scores")!.type = "enum('a','b')";
    await expect(migration.up(makeQI({ cols: odd }).qi)).rejects.toThrow("Unexpected type for studentpoints.scores");
  });
});

describe("up() is idempotent", () => {
  it("run twice: the second run sends no DDL", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const first = alters(f.log).length + f.calls.length;
    expect(first).toBe(2 + 15 + 6);
    await migration.up(f.qi);
    expect(alters(f.log).length + f.calls.length).toBe(first);
    expect(f.keys).toHaveLength(15);
  });

  it("finishes a run that stopped halfway: keeps the keys that are there, adds the rest", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    f.keys.splice(3, 4);
    f.cols.get("studentpoints.scores")!.nullable = true;
    f.calls.length = 0;
    await migration.up(f.qi);
    expect(f.calls).toHaveLength(4);
    expect(f.keys).toHaveLength(15);
    expect(f.cols.get("studentpoints.scores")!.nullable).toBe(false);
  });

  it("leaves alone a key that already runs from the column to its parent under another name", async () => {
    const keys: Key[] = [{ name: "hand_built", table: "students", column: "standard", parentTable: "standards", parentColumn: "standardid" }];
    const f = makeQI({ keys });
    await migration.up(f.qi);
    expect(f.keys.filter((k) => k.table === "students" && k.column === "standard").map((k) => k.name)).toEqual(["hand_built"]);
    expect(f.keys).toHaveLength(15);
  });

  it("does not add an index where one leads with the column or the name is taken", async () => {
    const indexes = migratedIndexes();
    indexes.get("rpiuseraccess")!.push({ name: "rpiuseraccess_userid_logintime", columns: ["userid", "logintime"] });
    indexes.get("students")!.push({ name: "standard", columns: ["standard"] });
    const f = makeQI({ indexes });
    await migration.up(f.qi);
    expect(alters(f.log).filter((s) => /ADD INDEX/.test(s))).toEqual([]);
    expect(f.keys).toHaveLength(15);
  });

  it("a composite index with the column in SECOND position does not lead with it: the single-column index is still created", async () => {
    const indexes = migratedIndexes();
    indexes.get("rpiuseraccess")!.push({ name: "rpiuseraccess_logintime_userid", columns: ["logintime", "userid"] });
    indexes.get("students")!.push({ name: "students_schoolid_standard", columns: ["schoolid", "standard"] });
    const f = makeQI({ indexes });
    await migration.up(f.qi);
    expect(alters(f.log).filter((s) => /ADD INDEX/.test(s))).toEqual([
      "ALTER TABLE `rpiuseraccess` ADD INDEX `userid` USING BTREE (`userid`)",
      "ALTER TABLE `students` ADD INDEX `standard` USING BTREE (`standard`)",
    ]);
    expect(f.keys).toHaveLength(15);
  });

  it("skips a table that is not there, and creates none", async () => {
    const f = makeQI({ missing: ["rpiuseraccess", "studentpoints"] });
    await migration.up(f.qi);
    expect(f.log.join("\n")).not.toMatch(/`rpiuseraccess`|`studentpoints`/);
    expect(f.keys).toHaveLength(14);
  });
});

describe("what MySQL would refuse without the guard (the stand-in is not lenient)", () => {
  it("a key over a dangling value is refused at the key, not before", async () => {
    // the guard is bypassed by asking the library for the keys directly: add a key over the value
    const f = makeQI({ dangling: { "studentlevelsprogress.levelid": ["no-such-level"] } });
    await expect(f.qi.addConstraint("studentlevelsprogress", { type: "foreign key", fields: ["levelid"], name: "x", references: { table: "levels", field: "levelid" }, onUpdate: "CASCADE", onDelete: "RESTRICT", transaction: TX })).rejects.toThrow("foreign key constraint fails");
  });
});

describe("strict SQL mode", () => {
  it("is switched on for the DDL and restored to the session's own mode afterwards, also when a statement fails", async () => {
    const f = makeQI({ sqlMode: "NO_ENGINE_SUBSTITUTION" });
    await migration.up(f.qi);
    expect(f.log.filter((s) => /^SET SESSION/.test(s))).toHaveLength(2);
    expect(f.mode()).toBe("NO_ENGINE_SUBSTITUTION");
    const g = makeQI({ sqlMode: "NO_ENGINE_SUBSTITUTION" });
    g.qi.addConstraint.mockRejectedValueOnce(new Error("boom"));
    await expect(migration.up(g.qi)).rejects.toThrow("boom");
    expect(g.mode()).toBe("NO_ENGINE_SUBSTITUTION");
  });
});

describe("down()", () => {
  const upped = async () => {
    const f = makeQI();
    await migration.up(f.qi);
    f.log.length = 0;
    f.calls.length = 0;
    return f;
  };

  it("removes the 15 keys by name in reverse, then the two indexes, then makes the 6 columns nullable again, in that order", async () => {
    const f = await upped();
    await migration.down(f.qi);
    expect(f.calls).toEqual([...EXPECTED_FKS].reverse().map((e) => `remove ${e.split(">")[0].replace(".", "_")}_fk`));
    const dropIx = f.log.map((s, i) => (/DROP INDEX/.test(s) ? i : -1)).filter((i) => i >= 0);
    const lastKey = f.log.map((s, i) => (/^removeConstraint/.test(s) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstModify = f.log.findIndex((s) => /MODIFY/.test(s));
    expect(dropIx).toHaveLength(2);
    expect(Math.min(...dropIx)).toBeGreaterThan(lastKey);
    expect(firstModify).toBeGreaterThan(Math.max(...dropIx));
    expect(f.keys).toEqual([]);
  });

  it("ends where a migrated database was: the same indexes, the 6 columns nullable with their defaults", async () => {
    const f = await upped();
    await migration.down(f.qi);
    expect(ixList(f.indexes)).toEqual(ixList(migratedIndexes()));
    expect(f.cols).toEqual(columns());
    expect(alters(f.log).filter((s) => /MODIFY/.test(s))).toContain("ALTER TABLE `studentpoints` MODIFY COLUMN `scores` int unsigned NULL DEFAULT NULL");
  });

  it("leaves the sync-created indexes (20261008130000) and primary keys alone, so that migration's own down() can then drop what it made", async () => {
    const f = await upped();
    await migration.down(f.qi);
    // 20261008130000 drops e.g. studentgradesprogress.gradeid: refused while a key uses it (ERROR 1553), fine once ours are gone
    const withKeys = makeQI();
    await migration.up(withKeys.qi);
    const dropModelIndex = () => withKeys.qi.sequelize.query("ALTER TABLE `studentgradesprogress` DROP INDEX `gradeid`");
    expect(() => dropModelIndex()).toThrow("ERROR 1553");
    await migration.down(withKeys.qi);
    await expect(Promise.resolve(dropModelIndex())).resolves.toBeDefined();
  });

  it("dropping the indexes before the keys would be refused (the order is load-bearing)", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(() => f.qi.sequelize.query("ALTER TABLE `students` DROP INDEX `standard`")).toThrow("ERROR 1553");
  });

  it("on a database that never had them: sends no DDL", async () => {
    const f = makeQI({ cols: new Map(NOT_NULLS.map((k) => [k, unsignedInt()])) });
    await migration.down(f.qi);
    expect(alters(f.log)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("when up() skipped an index because one of that name was already there, down() succeeds and drops that name (a name cannot say who made it), nothing else", async () => {
    const indexes = migratedIndexes();
    indexes.get("rpiuseraccess")!.push({ name: "userid", columns: ["userid", "logintime"] });
    const f = makeQI({ indexes });
    await migration.up(f.qi);
    expect(alters(f.log).filter((s) => /ADD INDEX `userid`/.test(s))).toEqual([]);
    f.log.length = 0;
    await migration.down(f.qi);
    expect(alters(f.log).filter((s) => /DROP INDEX/.test(s)).sort()).toEqual(
      NEW_INDEXES.map((k) => `ALTER TABLE \`${k.split(".")[0]}\` DROP INDEX \`${k.split(".")[1]}\``).sort(),
    );
    expect(indexes.get("rpiuseraccess")!.some((i) => i.name === "userid")).toBe(false);
  });

  it("when up() skipped an index because another index already led with the column, down() succeeds and leaves that index alone", async () => {
    const indexes = migratedIndexes();
    indexes.get("rpiuseraccess")!.push({ name: "rpiuseraccess_userid_logintime", columns: ["userid", "logintime"] });
    const f = makeQI({ indexes });
    await migration.up(f.qi);
    f.log.length = 0;
    await migration.down(f.qi);
    expect(alters(f.log).filter((s) => /DROP INDEX `userid`/.test(s) && /`rpiuseraccess`/.test(s))).toEqual([]);
    expect(indexes.get("rpiuseraccess")!.some((i) => i.name === "rpiuseraccess_userid_logintime")).toBe(true);
    expect(f.keys).toEqual([]);
  });

  it("up, down, up ends where the first up did", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const first = [ixList(f.indexes), keyNames(f.keys), [...f.cols.entries()].map(([k, c]) => `${k}:${c.nullable}:${c.def}`).sort()];
    await migration.down(f.qi);
    await migration.up(f.qi);
    expect([ixList(f.indexes), keyNames(f.keys), [...f.cols.entries()].map(([k, c]) => `${k}:${c.nullable}:${c.def}`).sort()]).toEqual(first);
  });
});
