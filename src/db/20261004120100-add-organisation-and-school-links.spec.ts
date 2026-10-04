/**
 * S2: nullable `organisationid` on schools and the four content tables, nullable
 * `schoolid` on students and schoolusers, and the name backfill of the latter.
 *
 * Like the other migration specs this drives up()/down() against a mocked,
 * STATEFUL QueryInterface: it proves what the migration ASKS MySQL for, in what
 * order, and that a re-run or a half-applied run is completed. The fake refuses
 * what MySQL refuses (dropping an index a foreign key uses, dropping a column a
 * foreign key is on), so the order of down() is checked by behaviour.
 *
 * It cannot prove what the backfill SQL DOES with real names (a Khmer mark that
 * weighs nothing under the collation, a trailing space): that is run against a
 * real database copy (see the change description). What it does pin is every
 * clause that decides it, so loosening one turns this red.
 */
// A module (not a script), so the helpers below are not shared with the other migration specs.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261004120100-add-organisation-and-school-links");

const TX = { id: "the-transaction" };

const OWNED = ["schools", "curriculums", "questions", "documents", "subjects"];
const LINKED = ["students", "schoolusers"];

type Fk = { column: string; index: string };
type TableState = { columns: Set<string>; indexes: Set<string>; fks: Map<string, Fk> };

type Options = {
  /** `organisations` exists (S1 ran). Default true. */
  organisations?: boolean;
  orgCharset?: string;
  orgCollate?: string;
  schoolCharset?: string;
  schoolCollate?: string;
  schoolIdType?: string;
  nameCollation?: string;
  /** Tables that already have these (partial-state recovery), as `table.column` etc. */
  haveColumns?: string[];
  haveIndexes?: string[];
  haveKeys?: string[];
  /** Rows already holding a value in `table.column`. */
  filled?: Record<string, number>;
  /** Rows the exact / loose backfill passes will report as updated, per table. */
  exact?: Record<string, number>;
  loose?: Record<string, number>;
  /** Make the next ADD CONSTRAINT throw. */
  failAddKey?: boolean;
};

const keyName = (table: string, column: string) =>
  column === "schoolid" ? `fk_${table}_schoolid` : `${table}_organisationid_fk`;
const indexName = (table: string, column: string) =>
  column === "schoolid" ? `${table}_schoolid_idx` : `${table}_organisationid_idx`;

const makeQI = (options: Options = {}) => {
  const log: string[] = [];
  const sqls: string[] = [];
  let fkChecks = 1;
  const state = new Map<string, TableState>();
  const table = (name: string): TableState => {
    if (!state.has(name)) {
      state.set(name, { columns: new Set(["pk"]), indexes: new Set(["PRIMARY"]), fks: new Map() });
    }
    return state.get(name)!;
  };
  [...OWNED, ...LINKED].forEach(table);
  for (const spec of options.haveColumns ?? []) {
    const [t, c] = spec.split(".");
    table(t).columns.add(c);
  }
  for (const spec of options.haveIndexes ?? []) {
    const [t, c] = spec.split(".");
    table(t).indexes.add(indexName(t, c));
  }
  for (const spec of options.haveKeys ?? []) {
    const [t, c] = spec.split(".");
    table(t).fks.set(keyName(t, c), { column: c, index: indexName(t, c) });
  }

  const qi = {
    showAllTables: jest.fn(() => Promise.resolve(options.organisations === false ? ["schools"] : ["schools", "organisations"])),
    describeTable: jest.fn((name: string) => {
      const t = state.get(name);
      if (!t) {
        return Promise.reject(new Error(`No description found for "${name}" table.`));
      }
      return Promise.resolve(Object.fromEntries([...t.columns].map((c) => [c, {}])));
    }),
    showIndex: jest.fn((name: string) => Promise.resolve([...table(name).indexes].map((n) => ({ name: n })))),
    addIndex: jest.fn((name: string, fields: string[], opts: { name: string }) => {
      log.push(`addIndex ${name}.${fields[0]}`);
      table(name).indexes.add(opts.name);
      return Promise.resolve();
    }),
    removeIndex: jest.fn((name: string, indexNameArg: string) => {
      const inUse = [...table(name).fks.values()].some((fk) => fk.index === indexNameArg);
      if (inUse) {
        return Promise.reject(new Error("Cannot drop index needed in a foreign key constraint"));
      }
      log.push(`removeIndex ${name}.${indexNameArg}`);
      table(name).indexes.delete(indexNameArg);
      return Promise.resolve();
    }),
    removeColumn: jest.fn((name: string, column: string) => {
      const t = table(name);
      if ([...t.fks.values()].some((fk) => fk.column === column)) {
        return Promise.reject(new Error("Cannot drop column needed in a foreign key constraint"));
      }
      log.push(`removeColumn ${name}.${column}`);
      t.columns.delete(column);
      return Promise.resolve();
    }),
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn((sql: string, opts?: any): Promise<unknown> => {
        sqls.push(sql);
        const typed = opts?.type === "SELECT";
        const rows = (r: unknown[]) => Promise.resolve(typed ? r : [r, undefined]);

        if (/TABLE_CONSTRAINTS/.test(sql)) {
          const [t, constraint] = opts.replacements as [string, string];
          return rows(table(t).fks.has(constraint) ? [{ name: constraint }] : []);
        }
        if (/COLUMN_TYPE AS type/.test(sql)) {
          return rows([{ type: options.schoolIdType ?? "varchar(36)" }]);
        }
        if (/COLLATION_NAME AS coll FROM/.test(sql)) {
          return rows([{ coll: options.nameCollation ?? "utf8mb4_unicode_ci" }]);
        }
        if (/CHARACTER_SET_NAME AS cs/.test(sql)) {
          const [t, c] = opts.replacements as [string, string];
          if (t === "organisations" && c === "organisationid") {
            return rows([{ cs: options.orgCharset ?? "utf8mb4", coll: options.orgCollate ?? "utf8mb4_unicode_ci" }]);
          }
          return rows([{ cs: options.schoolCharset ?? "utf8mb4", coll: options.schoolCollate ?? "utf8mb4_unicode_ci" }]);
        }
        const add = /^ALTER TABLE `(\w+)` ADD COLUMN `(\w+)`/.exec(sql);
        if (add) {
          log.push(`addColumn ${add[1]}.${add[2]}`);
          table(add[1]).columns.add(add[2]);
          return Promise.resolve([undefined, undefined]);
        }
        const key = /^ALTER TABLE `(\w+)` ADD CONSTRAINT `(\w+)` FOREIGN KEY \(`(\w+)`\)/.exec(sql);
        if (key) {
          if (options.failAddKey) {
            return Promise.reject(new Error("add key failed"));
          }
          log.push(`addKey ${key[1]}.${key[3]} (fk_checks=${fkChecks})`);
          table(key[1]).fks.set(key[2], { column: key[3], index: indexName(key[1], key[3]) });
          return Promise.resolve([undefined, undefined]);
        }
        const drop = /^ALTER TABLE `(\w+)` DROP FOREIGN KEY `(\w+)`/.exec(sql);
        if (drop) {
          log.push(`dropKey ${drop[1]}.${drop[2]}`);
          table(drop[1]).fks.delete(drop[2]);
          return Promise.resolve([undefined, undefined]);
        }
        const fk = /^SET foreign_key_checks = (\d)/.exec(sql);
        if (fk) {
          fkChecks = Number(fk[1]);
          log.push(`fk_checks=${fkChecks}`);
          return Promise.resolve([undefined, undefined]);
        }
        const count = /^SELECT COUNT\(\*\) AS n FROM `(\w+)` WHERE `(\w+)` IS NOT NULL/.exec(sql);
        if (count) {
          return rows([{ n: options.filled?.[`${count[1]}.${count[2]}`] ?? 0 }]);
        }
        const update = /^UPDATE `(\w+)` t/.exec(sql);
        if (update) {
          const kind = /SET t\.schoolid = m\.schoolid, t\.schoolname = m\.schoolname/.test(sql) ? "loose" : "exact";
          log.push(`update ${update[1]} ${kind}`);
          const n = (kind === "loose" ? options.loose : options.exact)?.[update[1]] ?? 0;
          return Promise.resolve([undefined, n]);
        }
        if (/^SELECT COUNT/.test(sql)) {
          return rows([{ n: 0 }]);
        }
        return rows([]);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, log, sqls, state, fkChecks: () => fkChecks };
};

type Fake = ReturnType<typeof makeQI>;
const ddl = (f: Fake) => f.sqls.filter((s) => /^ALTER TABLE/.test(s));
const updates = (f: Fake) => f.sqls.filter((s) => /^UPDATE/.test(s));

let consoleLog: jest.SpyInstance;
beforeEach(() => {
  consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => consoleLog.mockRestore());

describe("S2 up(): structure", () => {
  it("adds a NULLABLE organisationid to exactly schools, curriculums, questions, documents and subjects, typed from organisations.organisationid", async () => {
    const f = makeQI({ orgCollate: "utf8mb4_0900_ai_ci" });
    await migration.up(f.qi);
    const adds = ddl(f).filter((s) => /ADD COLUMN `organisationid`/.test(s));
    expect(adds).toEqual(
      OWNED.map(
        (t) =>
          `ALTER TABLE \`${t}\` ADD COLUMN \`organisationid\` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL`,
      ),
    );
    const read = f.qi.sequelize.query.mock.calls.find(
      (c) => /CHARACTER_SET_NAME/.test(c[0]) && c[1].replacements[0] === "organisations",
    )!;
    expect(read[1].replacements).toEqual(["organisations", "organisationid"]);
  });

  it("adds a NULLABLE schoolid to exactly students and schoolusers, typed and collated from the REAL schools.schoolid", async () => {
    const f = makeQI({ schoolIdType: "char(36)", schoolCharset: "utf8mb4", schoolCollate: "utf8mb4_bin" });
    await migration.up(f.qi);
    const adds = ddl(f).filter((s) => /ADD COLUMN `schoolid`/.test(s));
    expect(adds).toEqual(
      LINKED.map(
        (t) =>
          `ALTER TABLE \`${t}\` ADD COLUMN \`schoolid\` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL DEFAULT NULL`,
      ),
    );
    const read = f.qi.sequelize.query.mock.calls.find(
      (c) => /CHARACTER_SET_NAME/.test(c[0]) && c[1].replacements[0] === "schools",
    )!;
    expect(read[1].replacements).toEqual(["schools", "schoolid"]);
  });

  it("gives every new column an index and a RESTRICT foreign key to the right table", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    for (const t of OWNED) {
      expect(f.state.get(t)!.indexes.has(`${t}_organisationid_idx`)).toBe(true);
      expect(f.state.get(t)!.fks.get(`${t}_organisationid_fk`)).toBeDefined();
    }
    for (const t of LINKED) {
      expect(f.state.get(t)!.indexes.has(`${t}_schoolid_idx`)).toBe(true);
      expect(f.state.get(t)!.fks.get(`fk_${t}_schoolid`)).toBeDefined();
    }
    const keys = ddl(f).filter((s) => /ADD CONSTRAINT/.test(s));
    expect(keys).toHaveLength(7);
    for (const sql of keys) {
      expect(sql).toMatch(/ON DELETE RESTRICT ON UPDATE CASCADE$/);
    }
    expect(keys.filter((s) => /REFERENCES `organisations` \(`organisationid`\)/.test(s))).toHaveLength(5);
    expect(keys.filter((s) => /REFERENCES `schools` \(`schoolid`\)/.test(s))).toHaveLength(2);
  });

  it("leaves the tables that have no model here alone", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    for (const sql of f.sqls) {
      expect(sql).not.toMatch(/`?(lmsusers|questiontags|documenttags|curriculumcountry)`?/);
    }
  });

  it("does the structure before any backfill, and per table column, then index, then key", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const firstUpdate = f.log.findIndex((l) => l.startsWith("update"));
    const lastStructure = Math.max(
      ...f.log.map((l, i) => (/^(addColumn|addIndex|addKey)/.test(l) ? i : -1)),
    );
    expect(lastStructure).toBeLessThan(firstUpdate);
    for (const t of [...OWNED, ...LINKED]) {
      const column = LINKED.includes(t) ? "schoolid" : "organisationid";
      const order = ["addColumn", "addIndex", "addKey"].map((verb) =>
        f.log.findIndex((l) => l.startsWith(`${verb} ${t}.${column}`)),
      );
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it("refuses, before any DDL, when the organisations table does not exist", async () => {
    const f = makeQI({ organisations: false });
    await expect(migration.up(f.qi)).rejects.toThrow(/organisations table does not exist/);
    expect(ddl(f)).toEqual([]);
    expect(f.qi.addIndex).not.toHaveBeenCalled();
  });

  it.each([
    ["organisations.organisationid", { orgCollate: "utf8mb4_unicode_ci; DROP TABLE x" }],
    ["schools.schoolid", { schoolCollate: "utf8mb4_unicode_ci; DROP TABLE x" }],
    ["schools.schoolid type", { schoolIdType: "varchar(36); DROP TABLE x" }],
  ])("refuses a charset, collation or type from %s that is not a plain name, before any DDL", async (_label, opts) => {
    const f = makeQI(opts as Options);
    await expect(migration.up(f.qi)).rejects.toThrow(/Unexpected/);
    expect(ddl(f)).toEqual([]);
  });

  it("runs entirely inside the migration's transaction", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.qi.sequelize.transaction).toHaveBeenCalledTimes(1);
    for (const call of f.qi.addIndex.mock.calls) {
      expect((call as unknown as unknown[])[2]).toMatchObject({ transaction: TX });
    }
    // Every statement but the helper's reads of the reference columns' charset.
    for (const call of f.qi.sequelize.query.mock.calls.filter((c) => !/CHARACTER_SET_NAME/.test(c[0]))) {
      expect(call[1]).toMatchObject({ transaction: TX });
    }
  });
});

describe("S2 up(): foreign_key_checks", () => {
  it("adds each key in place with foreign_key_checks off while the column is empty, and turns it back on", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const keyLines = f.log.filter((l) => /^addKey/.test(l));
    expect(keyLines).toHaveLength(7);
    for (const line of keyLines) {
      expect(line).toMatch(/\(fk_checks=0\)$/);
    }
    expect(f.fkChecks()).toBe(1);
    // each key is bracketed: off, add, on
    f.log.forEach((l, i) => {
      if (/^addKey/.test(l)) {
        expect(f.log[i - 1]).toBe("fk_checks=0");
        expect(f.log[i + 1]).toBe("fk_checks=1");
      }
    });
  });

  it("restores foreign_key_checks when adding a key fails", async () => {
    const f = makeQI({ failAddKey: true });
    await expect(migration.up(f.qi)).rejects.toThrow("add key failed");
    expect(f.fkChecks()).toBe(1);
    expect(f.log[f.log.length - 1]).toBe("fk_checks=1");
  });

  it("adds the key the normal, validating way (checks left on) when the column already holds values", async () => {
    const f = makeQI({
      haveColumns: ["students.schoolid"],
      haveIndexes: ["students.schoolid"],
      filled: { "students.schoolid": 3 },
    });
    await migration.up(f.qi);
    expect(f.log).toContain("addKey students.schoolid (fk_checks=1)");
    // the toggle is not used for that table
    const i = f.log.indexOf("addKey students.schoolid (fk_checks=1)");
    expect(f.log[i - 1]).not.toBe("fk_checks=0");
  });
});

describe("S2 up(): idempotence and partial-state recovery", () => {
  it("a second run adds no column, index or key", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const before = f.log.length;
    await migration.up(f.qi);
    const second = f.log.slice(before);
    expect(second.filter((l) => /^(addColumn|addIndex|addKey|dropKey|removeIndex|removeColumn)/.test(l))).toEqual([]);
  });

  it("a re-run still runs the backfill, but it can only touch rows with no schoolid yet", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    await migration.up(f.qi);
    expect(updates(f)).toHaveLength(8);
    for (const sql of updates(f)) {
      expect(sql).toMatch(/WHERE t\.schoolid IS NULL/);
    }
  });

  it.each([
    ["column and index exist on schools, the key is missing", { haveColumns: ["schools.organisationid"], haveIndexes: ["schools.organisationid"] }],
    ["only the column exists on one table", { haveColumns: ["questions.organisationid"] }],
    ["column and index exist, the key is missing", { haveColumns: ["documents.organisationid"], haveIndexes: ["documents.organisationid"] }],
    ["everything exists on schoolusers", { haveColumns: ["schoolusers.schoolid"], haveIndexes: ["schoolusers.schoolid"], haveKeys: ["schoolusers.schoolid"] }],
  ])("completes a half-applied run: %s", async (_label, opts) => {
    const f = makeQI(opts as Options);
    await migration.up(f.qi);
    for (const t of OWNED) {
      expect(f.state.get(t)!.columns.has("organisationid")).toBe(true);
      expect(f.state.get(t)!.indexes.has(`${t}_organisationid_idx`)).toBe(true);
      expect(f.state.get(t)!.fks.has(`${t}_organisationid_fk`)).toBe(true);
    }
    for (const t of LINKED) {
      expect(f.state.get(t)!.columns.has("schoolid")).toBe(true);
      expect(f.state.get(t)!.indexes.has(`${t}_schoolid_idx`)).toBe(true);
      expect(f.state.get(t)!.fks.has(`fk_${t}_schoolid`)).toBe(true);
    }
    // it never re-added what was already there
    for (const spec of (opts as Options).haveColumns ?? []) {
      expect(f.log).not.toContain(`addColumn ${spec}`);
    }
  });
});

describe("S2 up(): the schoolid backfill", () => {
  it("runs an exact pass then a loose pass for each of students and schoolusers, in that order", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.log.filter((l) => l.startsWith("update"))).toEqual([
      "update students exact",
      "update students loose",
      "update schoolusers exact",
      "update schoolusers loose",
    ]);
  });

  it("the exact pass matches byte for byte (CAST AS BINARY), only a name held by exactly ONE school, and fills only NULL schoolid", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    for (const sql of updates(f).filter((s) => !/t\.schoolname = m\.schoolname/.test(s))) {
      expect(sql).toMatch(/GROUP BY CAST\(schoolname AS BINARY\)\s+HAVING COUNT\(\*\) = 1/);
      expect(sql).toMatch(/ON CAST\(t\.schoolname AS BINARY\) = CAST\(s\.schoolname AS BINARY\)/);
      expect(sql).toMatch(/SET t\.schoolid = s\.schoolid\s+WHERE t\.schoolid IS NULL AND t\.schoolname IS NOT NULL/);
      expect(sql).not.toMatch(/SET t\.schoolname/);
    }
  });

  it("the loose pass compares under the school name column's own collation, fills only when EXACTLY ONE school matches, and rewrites the row's name to the school's", async () => {
    const f = makeQI({ nameCollation: "utf8mb4_0900_ai_ci" });
    await migration.up(f.qi);
    const loose = updates(f).filter((s) => /t\.schoolname = m\.schoolname/.test(s));
    expect(loose).toHaveLength(2);
    for (const sql of loose) {
      expect(sql).toMatch(/ON t2\.schoolname = s\.schoolname COLLATE utf8mb4_0900_ai_ci/);
      expect(sql).toMatch(/HAVING COUNT\(\*\) = 1/);
      expect(sql).toMatch(/WHERE t2\.schoolid IS NULL AND t2\.schoolname IS NOT NULL/);
      expect(sql).toMatch(/SET t\.schoolid = m\.schoolid, t\.schoolname = m\.schoolname\s+WHERE t\.schoolid IS NULL/);
    }
    // keyed by each table's own primary key
    expect(loose[0]).toMatch(/t2\.`studentid`/);
    expect(loose[1]).toMatch(/t2\.`schooluserid`/);
  });

  it("refuses a school name collation that is not a plain identifier, before any backfill statement", async () => {
    const f = makeQI({ nameCollation: "x; DROP TABLE students" });
    await expect(migration.up(f.qi)).rejects.toThrow(/Unexpected collation/);
    expect(updates(f)).toEqual([]);
  });

  it("changes nothing but schoolid and the loose pass's schoolname: no DELETE, DROP or TRUNCATE, and no other UPDATE target", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    for (const sql of f.sqls) {
      expect(sql).not.toMatch(/^\s*(DELETE|DROP|TRUNCATE)\b/i);
    }
    for (const sql of updates(f)) {
      expect(sql).toMatch(/^UPDATE `(students|schoolusers)` t/);
      const sets = sql.match(/SET [^\n]+/g)!;
      expect(sets).toHaveLength(1);
    }
  });

  it("prints the counts, never a name", async () => {
    const f = makeQI({ exact: { students: 4, schoolusers: 9 }, loose: { students: 2, schoolusers: 1 } });
    await migration.up(f.qi);
    const lines = consoleLog.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^S2 students: rows=0 filled_exact=4 filled_loose_only=2 names_rewritten=2 /);
    expect(lines[1]).toMatch(/^S2 schoolusers: rows=0 filled_exact=9 filled_loose_only=1 names_rewritten=1 /);
    for (const line of lines) {
      expect(line).not.toMatch(/schoolname=/);
    }
  });
});

describe("S2 down()", () => {
  const applied = async () => {
    const f = makeQI();
    await migration.up(f.qi);
    f.log.length = 0;
    return f;
  };

  it("removes every key, index and column that up() added", async () => {
    const f = await applied();
    await migration.down(f.qi);
    for (const t of [...OWNED, ...LINKED]) {
      const column = LINKED.includes(t) ? "schoolid" : "organisationid";
      expect(f.state.get(t)!.columns.has(column)).toBe(false);
      expect(f.state.get(t)!.indexes.has(indexName(t, column))).toBe(false);
      expect(f.state.get(t)!.fks.size).toBe(0);
    }
  });

  it("drops the school links first, then the owners last table first; per table key, then index, then column", async () => {
    const f = await applied();
    await migration.down(f.qi);
    const tables = f.log.map((l) => l.split(" ")[1].split(".")[0]);
    const firstOfEach = [...new Set(tables)];
    expect(firstOfEach).toEqual(["schoolusers", "students", "subjects", "documents", "questions", "curriculums", "schools"]);
    for (const t of [...OWNED, ...LINKED]) {
      const own = f.log.filter((l) => l.split(" ")[1].startsWith(`${t}.`));
      expect(own.map((l) => l.split(" ")[0])).toEqual(["dropKey", "removeIndex", "removeColumn"]);
    }
  });

  it("is a no-op on a database up() never reached", async () => {
    const f = makeQI();
    await migration.down(f.qi);
    expect(f.log).toEqual([]);
  });

  it("completes a half-applied run, and a second down is a no-op", async () => {
    const f = makeQI({ haveColumns: ["students.schoolid", "schools.organisationid"], haveIndexes: ["schools.organisationid"] });
    await migration.down(f.qi);
    expect(f.state.get("students")!.columns.has("schoolid")).toBe(false);
    expect(f.state.get("schools")!.columns.has("organisationid")).toBe(false);
    f.log.length = 0;
    await migration.down(f.qi);
    expect(f.log).toEqual([]);
  });

  it("survives a table that is not there", async () => {
    const f = makeQI();
    f.state.delete("subjects");
    f.qi.describeTable.mockImplementation((name: string) =>
      f.state.has(name)
        ? Promise.resolve(Object.fromEntries([...f.state.get(name)!.columns].map((c) => [c, {}])))
        : Promise.reject(new Error("no such table")),
    );
    await expect(migration.down(f.qi)).resolves.toBeUndefined();
  });

  it("does not touch any row", async () => {
    const f = await applied();
    f.sqls.length = 0;
    await migration.down(f.qi);
    for (const sql of f.sqls) {
      expect(sql).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
    }
  });
});
