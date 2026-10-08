/**
 * The indexes the server's boot-time `sequelize.sync()` used to add become a migration. Drives up()/down()
 * against a stand-in for MySQL's index bookkeeping: it proves what the migration ASKS MySQL for, in what
 * order, and what it leaves alone. That a migration-built database then equals a sync-built one for all 41 tables
 * (SHOW CREATE TABLE before and after a boot) was run on real MySQL; see the change description.
 */
// A module (not a script), so the helpers below are not shared with the other migration specs.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261008130000-indexes-sync-created");

const TX = { id: "the-transaction" };

/** What a boot of the server adds, measured on real MySQL, written out independently of the migration. table -> [name, columns][] in sync() order. */
const EXPECTED: Array<[string, Array<[string, string[]]>]> = [
  ["studentlearningsprogress", [["studentid", ["studentid"]], ["lessonlearningid", ["lessonlearningid"]]]],
  ["studentlessonsprogress", [["studentid", ["studentid"]], ["lessonid", ["lessonid"]], ["levelid", ["levelid"]], ["gradeid", ["gradeid"]], ["curid", ["curid"]]]],
  ["studentlevelsprogress", [["studentid", ["studentid"]], ["levelid", ["levelid"]], ["gradeid", ["gradeid"]], ["curid", ["curid"]]]],
  ["studentgradesprogress", [["studentid", ["studentid"]], ["gradeid", ["gradeid"]], ["curriculumid", ["curriculumid"]]]],
  ["studentactives", [["studentid", ["studentid"]]]],
  ["studentpoints", [["studentid", ["studentid"]], ["lessonid", ["lessonid"]]]],
  ["studentappusages", [["schooluserid", ["schooluserid"]]]],
  ["schools", [["countryid", ["countryid"]]]],
  ["studenttrash", [["studentid", ["studentid"]]]],
  ["lessonplans", [["lessonid", ["lessonid"]]]],
];
const TABLES = EXPECTED.map(([t]) => t);
const ADDED = EXPECTED.flatMap(([t, ixs]) => ixs.map(([n]) => `${t}.${n}`));
const FK_INDEX = "schools_countryid_foreign_idx";

interface Ix {
  name: string;
  columns: string[];
  /** Created by MySQL for a foreign key, so MySQL drops it again when an index covering the same columns is added. */
  implicit?: boolean;
}

/** The indexes a migration-built database has on each of the ten tables before this migration (the rest of the tables are not touched). */
const migrationBuilt = (): Map<string, Ix[]> =>
  new Map<string, Ix[]>([
    ["lessonplans", [{ name: "PRIMARY", columns: ["lessonplanid"] }]],
    [
      "schools",
      [
        { name: "PRIMARY", columns: ["schoolid"] },
        { name: "schoolname", columns: ["schoolname"] },
        { name: FK_INDEX, columns: ["countryid"], implicit: true },
        { name: "schools_organisationid_idx", columns: ["organisationid"] },
      ],
    ],
    ["studentactives", [{ name: "PRIMARY", columns: ["studentactiveid"] }, { name: "studentactives_studentid_referenceid", columns: ["studentid", "referenceid"] }]],
    ["studentappusages", [{ name: "PRIMARY", columns: ["studentappusageid"] }]],
    ["studentgradesprogress", [{ name: "PRIMARY", columns: ["studentgradeprogressid"] }]],
    ["studentlearningsprogress", [{ name: "PRIMARY", columns: ["studentlearningprogressid"] }]],
    ["studentlessonsprogress", [{ name: "PRIMARY", columns: ["studentlessonprogressid"] }]],
    ["studentlevelsprogress", [{ name: "PRIMARY", columns: ["studentlevelprogressid"] }]],
    ["studentpoints", [{ name: "PRIMARY", columns: ["studentpointid"] }]],
    ["studenttrash", [{ name: "PRIMARY", columns: ["studenttrashid"] }]],
  ]);

/** The same tables after a boot's sync(): the 21 indexes added, and the schools foreign key's own index replaced by `countryid`. */
const syncBuilt = (): Map<string, Ix[]> => {
  const m = migrationBuilt();
  for (const [table, ixs] of EXPECTED) {
    const list = m.get(table)!.filter((i) => !(table === "schools" && i.name === FK_INDEX));
    for (const [name, columns] of ixs) list.push({ name, columns });
    m.set(table, list);
  }
  return m;
};

interface Opts {
  indexes?: Map<string, Ix[]>;
  /** Tables that do not exist. */
  missing?: string[];
  /** An ALTER whose SQL matches fails. */
  failOn?: RegExp;
  sqlMode?: string;
}

const clausesOf = (sql: string): string[] => sql.replace(/^ALTER TABLE `\w+` /, "").split(/, (?=ADD |DROP )/);

/**
 * A stand-in for the part of MySQL these ALTERs touch: indexes by name per table, the foreign key on schools.countryid
 * (an ALTER that would leave it with no index throws, as MySQL's error 1553 does), and the implicit-index replacement.
 * `log` records every statement with the transaction it ran in and the indexes the table had when it ran.
 */
const makeQI = (opts: Opts = {}) => {
  const indexes = opts.indexes ?? migrationBuilt();
  const missing = new Set(opts.missing ?? []);
  let mode = opts.sqlMode ?? "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION";
  const log: string[] = [];
  const alters: string[] = [];
  const unprotected: string[] = [];
  const txOf = new Map<string, unknown>();

  const fkProtected = (): boolean => (indexes.get("schools") ?? []).some((i) => i.columns[0] === "countryid");

  const query = jest.fn((sql: string, o?: { replacements?: string[]; transaction?: unknown }): Promise<unknown> => {
    log.push(sql);
    txOf.set(sql, o?.transaction);
    if (/FROM information_schema\.statistics/.test(sql)) {
      const table = o!.replacements![0];
      return Promise.resolve((indexes.get(table) ?? []).map((i) => ({ name: i.name })));
    }
    if (/SELECT @@SESSION\.sql_mode/.test(sql)) {
      return Promise.resolve([{ mode }]);
    }
    const set = /^SET SESSION sql_mode = (.*)$/.exec(sql);
    if (set) {
      mode = set[1].startsWith("CONCAT") ? `${mode},STRICT_TRANS_TABLES` : set[1].replace(/^'|'$/g, "");
      return Promise.resolve([]);
    }
    const alter = /^ALTER TABLE `(\w+)` /.exec(sql);
    if (alter) {
      const table = alter[1];
      if (missing.has(table)) throw new Error(`Table '${table}' doesn't exist`);
      if (opts.failOn?.test(sql)) throw new Error("boom");
      alters.push(sql);
      const list = indexes.get(table)!;
      for (const clause of clausesOf(sql)) {
        const add = /^ADD INDEX `(\w+)`( USING BTREE)? \((.*)\)$/.exec(clause);
        const drop = /^DROP INDEX `(\w+)`$/.exec(clause);
        if (add) {
          if (list.some((i) => i.name === add[1])) throw new Error(`Duplicate key name '${add[1]}'`);
          const columns = add[3].split(", ").map((c) => c.replace(/`/g, ""));
          // MySQL drops an implicitly created index that a new index covers.
          for (let k = list.length - 1; k >= 0; k--) if (list[k].implicit && list[k].columns.join() === columns.join()) list.splice(k, 1);
          list.push({ name: add[1], columns });
        } else if (drop) {
          const at = list.findIndex((i) => i.name === drop[1]);
          if (at < 0) throw new Error(`Can't DROP '${drop[1]}'; check that column/key exists`);
          list.splice(at, 1);
        } else {
          throw new Error(`unrecognised clause: ${clause}`);
        }
      }
      if (table === "schools" && !fkProtected()) {
        unprotected.push(sql);
        throw new Error("Cannot drop index: needed in a foreign key constraint");
      }
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });

  const qi = {
    showAllTables: jest.fn(() => Promise.resolve([...TABLES, "students", "countries"].filter((t) => !missing.has(t)))),
    sequelize: {
      query,
      escape: (v: string) => `'${v}'`,
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, indexes, log, alters, txOf, unprotected, mode: () => mode };
};

/** table -> index names (primary and unrelated indexes excluded) as a sorted list of `table.name`. */
const named = (indexes: Map<string, Ix[]>, of: (n: string) => boolean = () => true): string[] =>
  [...indexes.entries()].flatMap(([t, l]) => l.filter((i) => of(i.name)).map((i) => `${t}.${i.name}:${i.columns.join("+")}`)).sort();

describe("up() on a migration-built database", () => {
  it("issues exactly one ALTER per table, in sync()'s table order, adding each index with sync()'s name, columns and BTREE", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const want = EXPECTED.map(
      ([t, ixs]) => `ALTER TABLE \`${t}\` ` + ixs.map(([n, cols]) => `ADD INDEX \`${n}\` USING BTREE (${cols.map((c) => `\`${c}\``).join(", ")})`).join(", "),
    );
    expect(f.alters).toEqual(want);
  });

  it("adds 21 indexes, none unique", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(ADDED).toHaveLength(21);
    expect(f.alters.join("\n")).not.toMatch(/UNIQUE/i);
    expect(f.alters.join("\n").match(/ADD INDEX/g)).toHaveLength(21);
  });

  it("ends in the index set a sync-built database has, for every one of the ten tables", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(named(f.indexes)).toEqual(named(syncBuilt()));
  });

  it("leaves the existing indexes alone (primary keys, unique keys, the composite indexes, the organisation index)", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const kept = ["PRIMARY", "schoolname", "schools_organisationid_idx", "studentactives_studentid_referenceid"];
    expect(named(f.indexes, (n) => kept.includes(n))).toEqual(named(migrationBuilt(), (n) => kept.includes(n)));
    expect(f.alters.join("\n")).not.toMatch(/DROP INDEX `(PRIMARY|schoolname|schools_organisationid_idx|studentactives_studentid_referenceid)`/);
  });

  it("runs every statement in the transaction", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.qi.sequelize.transaction).toHaveBeenCalledTimes(1);
    for (const sql of [...f.alters, ...f.log.filter((s) => /information_schema/.test(s))]) {
      expect(f.txOf.get(sql)).toBe(TX);
    }
  });
});

describe("up() on the schools foreign key", () => {
  it("adds `countryid` and MySQL replaces the implicit foreign-key index; the foreign key has an index after every statement", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.unprotected).toEqual([]);
    expect((f.indexes.get("schools") ?? []).map((i) => i.name)).toEqual(["PRIMARY", "schoolname", "schools_organisationid_idx", "countryid"]);
  });

  it("adds `countryid` BEFORE any DROP of the old index", async () => {
    const f = makeQI();
    // An EXPLICIT old index (not auto-replaced by MySQL): it has to be dropped by name, after the new one exists.
    f.indexes.get("schools")!.find((i) => i.name === FK_INDEX)!.implicit = false;
    await migration.up(f.qi);
    const schools = f.alters.filter((s) => s.startsWith("ALTER TABLE `schools`"));
    expect(schools).toEqual([
      "ALTER TABLE `schools` ADD INDEX `countryid` USING BTREE (`countryid`)",
      `ALTER TABLE \`schools\` DROP INDEX \`${FK_INDEX}\``,
    ]);
    expect(f.unprotected).toEqual([]);
    expect((f.indexes.get("schools") ?? []).map((i) => i.name)).not.toContain(FK_INDEX);
  });
});

describe("up() is idempotent", () => {
  it("on a database sync() already ran on: sends no DDL at all", async () => {
    const f = makeQI({ indexes: syncBuilt() });
    await migration.up(f.qi);
    expect(f.alters).toEqual([]);
    expect(named(f.indexes)).toEqual(named(syncBuilt()));
  });

  it("run twice: the second run sends no DDL", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    const first = f.alters.length;
    await migration.up(f.qi);
    expect(first).toBe(10);
    expect(f.alters).toHaveLength(first);
  });

  it("skips an index by NAME, as sync() does, and adds only what is missing, in one ALTER for that table", async () => {
    const indexes = migrationBuilt();
    indexes.get("studentlessonsprogress")!.push({ name: "levelid", columns: ["levelid"] }, { name: "curid", columns: ["curid"] });
    const f = makeQI({ indexes });
    await migration.up(f.qi);
    expect(f.alters.filter((s) => s.startsWith("ALTER TABLE `studentlessonsprogress`"))).toEqual([
      "ALTER TABLE `studentlessonsprogress` ADD INDEX `studentid` USING BTREE (`studentid`), ADD INDEX `lessonid` USING BTREE (`lessonid`), ADD INDEX `gradeid` USING BTREE (`gradeid`)",
    ]);
    expect(named(f.indexes)).toEqual(named(syncBuilt()));
  });

  it("a name that already exists with other columns is left alone (sync() would too)", async () => {
    const indexes = migrationBuilt();
    indexes.get("studentpoints")!.push({ name: "lessonid", columns: ["levelid", "lessonid"] });
    const f = makeQI({ indexes });
    await migration.up(f.qi);
    expect(f.alters.filter((s) => s.startsWith("ALTER TABLE `studentpoints`"))).toEqual(["ALTER TABLE `studentpoints` ADD INDEX `studentid` USING BTREE (`studentid`)"]);
    expect(f.indexes.get("studentpoints")!.find((i) => i.name === "lessonid")!.columns).toEqual(["levelid", "lessonid"]);
  });

  it("does not create a table that is absent, and does not touch it", async () => {
    const f = makeQI({ missing: ["studenttrash"] });
    await migration.up(f.qi);
    expect(f.alters.some((s) => s.includes("`studenttrash`"))).toBe(false);
    expect(f.alters).toHaveLength(9);
  });
});

describe("strict SQL mode", () => {
  it("is switched on for the ALTERs and restored to the session's own mode afterwards", async () => {
    const f = makeQI({ sqlMode: "ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION" });
    await migration.up(f.qi);
    const sets = f.log.filter((s) => /^SET SESSION sql_mode/.test(s));
    expect(sets).toHaveLength(2);
    expect(f.log.indexOf(sets[0])).toBeLessThan(f.log.findIndex((s) => /^ALTER TABLE/.test(s)));
    expect(f.log.lastIndexOf(sets[1])).toBeGreaterThan(f.log.map((s, i) => (/^ALTER TABLE/.test(s) ? i : -1)).reduce((a, b) => Math.max(a, b), -1));
    expect(f.mode()).toBe("ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION");
  });

  it("sends nothing when the session is already strict", async () => {
    const f = makeQI();
    await migration.up(f.qi);
    expect(f.log.filter((s) => /^SET SESSION/.test(s))).toEqual([]);
  });

  it("restores the mode even when an ALTER fails", async () => {
    const f = makeQI({ sqlMode: "NO_ENGINE_SUBSTITUTION", failOn: /^ALTER TABLE `studentpoints`/ });
    await expect(migration.up(f.qi)).rejects.toThrow("boom");
    expect(f.mode()).toBe("NO_ENGINE_SUBSTITUTION");
  });
});

describe("down()", () => {
  const upped = async () => {
    const f = makeQI();
    await migration.up(f.qi);
    return f;
  };

  it("after up(): removes the 21 indexes and nothing else, and gives the schools foreign key its own index back", async () => {
    const f = await upped();
    f.alters.length = 0;
    await migration.down(f.qi);
    expect(f.unprotected).toEqual([]);
    expect(named(f.indexes).filter((n) => ADDED.some((a) => n.startsWith(`${a}:`)))).toEqual([]);
    expect(named(f.indexes)).toEqual(named(migrationBuilt()));
  });

  it("adds `schools_countryid_foreign_idx` (no USING clause, as createTable left it) BEFORE it drops `countryid`", async () => {
    const f = await upped();
    f.alters.length = 0;
    await migration.down(f.qi);
    const schools = f.alters.filter((s) => s.startsWith("ALTER TABLE `schools`"));
    expect(schools).toEqual([`ALTER TABLE \`schools\` ADD INDEX \`${FK_INDEX}\` (\`countryid\`)`, "ALTER TABLE `schools` DROP INDEX `countryid`"]);
    expect(f.unprotected).toEqual([]);
  });

  it("is safe on a database sync() built: same result as after up()", async () => {
    const f = makeQI({ indexes: syncBuilt() });
    await migration.down(f.qi);
    expect(f.unprotected).toEqual([]);
    expect(named(f.indexes)).toEqual(named(migrationBuilt()));
  });

  it("drops only the indexes that are present, by name", async () => {
    const indexes = migrationBuilt();
    indexes.get("studentpoints")!.push({ name: "studentid", columns: ["studentid"] });
    const f = makeQI({ indexes });
    await migration.down(f.qi);
    expect(f.alters).toEqual(["ALTER TABLE `studentpoints` DROP INDEX `studentid`"]);
  });

  it("on a database that never had them: sends no DDL", async () => {
    const f = makeQI();
    await migration.down(f.qi);
    expect(f.alters).toEqual([]);
  });

  it("up() again after down() ends where the first up() did", async () => {
    const f = await upped();
    const first = named(f.indexes);
    await migration.down(f.qi);
    await migration.up(f.qi);
    expect(named(f.indexes)).toEqual(first);
  });

  it("does not drop the schools primary key, unique key, organisation index or the composite indexes", async () => {
    const f = await upped();
    await migration.down(f.qi);
    expect(f.alters.join("\n")).not.toMatch(/DROP INDEX `(PRIMARY|schoolname|schools_organisationid_idx|studentactives_studentid_referenceid)`/);
  });
});
