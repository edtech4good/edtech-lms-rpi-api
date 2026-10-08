/**
 * The unique key on `countries.countryname`. Drives up() and down() against a stand-in QueryInterface that
 * answers the statements the migration sends and records them: it proves what the migration asks MySQL for,
 * in what order, and what it refuses. The real runs (a migrated database, a table built by sync(), a table
 * with two collation-equal names, the key under another name) are described in the change description.
 */
// A module (not a script), so the helpers below are not shared with the other migration specs.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261008120000-unique-country-name");

const TX = { id: "the-transaction" };

interface FakeIndex {
  name: string;
  unique: boolean;
  columns: string[];
  /** A prefix index (`countryname(10)`). */
  prefix?: boolean;
}
interface FakeRow {
  id: string;
  name: string;
  /** Rows with the same group are equal under the column's collation. */
  group: string;
}

const makeQI = (state: { indexes?: FakeIndex[]; rows?: FakeRow[] } = {}) => {
  const indexes: FakeIndex[] = [...(state.indexes ?? [{ name: "PRIMARY", unique: true, columns: ["countryid"] }])];
  const rows = state.rows ?? [];
  const statements: string[] = [];
  const optionsSeen: unknown[] = [];
  const qi = {
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
        const text = sql.replace(/\s+/g, " ").trim();
        statements.push(text);
        optionsSeen.push(opts);
        if (/FROM INFORMATION_SCHEMA\.STATISTICS/.test(text)) {
          expect(opts.replacements).toEqual(["countries"]);
          return indexes.flatMap((i) =>
            i.columns.map((c, n) => ({
              index_name: i.name,
              non_unique: i.unique ? 0 : 1,
              seq_in_index: n + 1,
              column_name: c,
              sub_part: i.prefix ? 10 : null,
            })),
          );
        }
        if (/GROUP BY countryname HAVING COUNT\(\*\) > 1/.test(text)) {
          const groups = new Map<string, FakeRow[]>();
          for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
          return [...groups.values()]
            .filter((g) => g.length > 1)
            .flatMap((g) => {
              const sorted = [...g].sort((a, b) => a.id.localeCompare(b.id));
              return sorted.map((r) => ({ grp: sorted[0].id, countryid: r.id, countryname: r.name }));
            })
            .sort((a, b) => a.grp.localeCompare(b.grp) || a.countryid.localeCompare(b.countryid));
        }
        const add = /^ALTER TABLE `countries` ADD UNIQUE KEY `(\w+)` \(`(\w+)`\)$/.exec(text);
        if (add) {
          if (rows.some((r, i) => rows.findIndex((o) => o.group === r.group) !== i)) throw new Error("Duplicate entry");
          indexes.push({ name: add[1], unique: true, columns: [add[2]] });
          return [[], undefined];
        }
        throw new Error(`unexpected statement: ${text}`);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, indexes, statements, optionsSeen, alters: () => statements.filter((s) => /^ALTER/.test(s)) };
};

const ADD = "ALTER TABLE `countries` ADD UNIQUE KEY `countryname` (`countryname`)";

describe("unique country name up()", () => {
  it("adds exactly UNIQUE KEY countryname (countryname), once, inside the transaction, to a table without it", async () => {
    const fake = makeQI({ rows: [{ id: "c1", name: "Testland", group: "a" }, { id: "c2", name: "Otherland", group: "b" }] });
    await migration.up(fake.qi);
    expect(fake.alters()).toEqual([ADD]);
    expect(fake.qi.sequelize.transaction).toHaveBeenCalledTimes(1);
    for (const opts of fake.optionsSeen) expect((opts as { transaction: unknown }).transaction).toBe(TX);
    expect(fake.indexes.filter((i) => i.unique && i.columns.join() === "countryname").map((i) => i.name)).toEqual(["countryname"]);
  });

  it("looks for duplicates BEFORE reading the indexes and before any ALTER", async () => {
    const fake = makeQI();
    await migration.up(fake.qi);
    const guard = fake.statements.findIndex((s) => /GROUP BY countryname HAVING COUNT\(\*\) > 1/.test(s));
    const read = fake.statements.findIndex((s) => /INFORMATION_SCHEMA\.STATISTICS/.test(s));
    const alter = fake.statements.findIndex((s) => /^ALTER/.test(s));
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(guard);
    expect(alter).toBeGreaterThan(read);
  });

  it("refuses when two names are equal under the collation: names both rows and their ids, sends no ALTER, changes nothing", async () => {
    const fake = makeQI({
      rows: [
        { id: "id-1", name: "Testland", group: "a" },
        { id: "id-2", name: "Téstland", group: "a" },
        { id: "id-3", name: "Otherland", group: "b" },
      ],
    });
    const err = await migration.up(fake.qi).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("1 group(s)");
    expect(err.message).toContain('"Testland" (id-1), "Téstland" (id-2)');
    expect(err.message).not.toContain("Otherland");
    expect(err.message).toContain("nothing was changed");
    expect(fake.alters()).toEqual([]);
    expect(fake.indexes.map((i) => i.name)).toEqual(["PRIMARY"]);
  });

  it("names every group when several share a name, three rows in one group included", async () => {
    const fake = makeQI({
      rows: [
        { id: "id-1", name: "Anyland", group: "a" },
        { id: "id-2", name: "ANYLAND", group: "a" },
        { id: "id-3", name: "anyland", group: "a" },
        { id: "id-4", name: "Testland", group: "b" },
        { id: "id-5", name: "Téstland", group: "b" },
      ],
    });
    const err = await migration.up(fake.qi).catch((e: Error) => e);
    expect(err.message).toContain("2 group(s)");
    expect(err.message).toContain('"Anyland" (id-1), "ANYLAND" (id-2), "anyland" (id-3)');
    expect(err.message).toContain('"Testland" (id-4), "Téstland" (id-5)');
    expect(fake.alters()).toEqual([]);
  });

  it("lists at most 50 groups but counts them all", async () => {
    const rows: FakeRow[] = [];
    for (let n = 0; n < 53; n++) {
      const id = String(n).padStart(3, "0");
      rows.push({ id: `a${id}`, name: `Name${id}`, group: id }, { id: `b${id}`, name: `NAME${id}`, group: id });
    }
    const err = await migration.up(makeQI({ rows }).qi).catch((e: Error) => e);
    expect(err.message).toContain("53 group(s)");
    expect(err.message).toContain('"Name049" (a049)');
    expect(err.message).not.toContain('"Name050" (a050)');
    expect(err.message).toContain("and 3 more group(s)");
  });

  it("is idempotent: a unique key over countryname under the usual name is left alone", async () => {
    const fake = makeQI({ indexes: [{ name: "PRIMARY", unique: true, columns: ["countryid"] }, { name: "countryname", unique: true, columns: ["countryname"] }] });
    await migration.up(fake.qi);
    expect(fake.alters()).toEqual([]);
  });

  it("is idempotent under ANY name: a unique key called something else counts, and no second key is added", async () => {
    const fake = makeQI({ indexes: [{ name: "PRIMARY", unique: true, columns: ["countryid"] }, { name: "uq_country_name", unique: true, columns: ["countryname"] }] });
    await migration.up(fake.qi);
    expect(fake.alters()).toEqual([]);
    expect(fake.indexes).toHaveLength(2);
  });

  it("a second run after the first is a no-op", async () => {
    const fake = makeQI();
    await migration.up(fake.qi);
    await migration.up(fake.qi);
    expect(fake.alters()).toEqual([ADD]);
  });

  it("does not count other indexes as the key: a plain index, a composite unique, a prefix unique, or the primary key", async () => {
    const others: FakeIndex[][] = [
      [{ name: "idx_name", unique: false, columns: ["countryname"] }],
      [{ name: "uq_pair", unique: true, columns: ["countryname", "isdeleted"] }],
      [{ name: "uq_prefix", unique: true, columns: ["countryname"], prefix: true }],
      [{ name: "uq_other", unique: true, columns: ["expectedusage"] }],
    ];
    for (const extra of others) {
      const fake = makeQI({ indexes: [{ name: "PRIMARY", unique: true, columns: ["countryid"] }, ...extra] });
      await migration.up(fake.qi);
      expect(fake.alters()).toEqual([ADD]);
    }
  });

  it("refuses, changing nothing, when an index named countryname exists that is not that unique key", async () => {
    const fake = makeQI({ indexes: [{ name: "PRIMARY", unique: true, columns: ["countryid"] }, { name: "countryname", unique: false, columns: ["countryname"] }] });
    const err = await migration.up(fake.qi).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("already has an index named countryname");
    expect(err.message).toContain("unique: false");
    expect(fake.alters()).toEqual([]);
  });
});

describe("unique country name down()", () => {
  it("is a no-op: it sends no statement and leaves a key it may not have made", async () => {
    const fake = makeQI({ indexes: [{ name: "PRIMARY", unique: true, columns: ["countryid"] }, { name: "countryname", unique: true, columns: ["countryname"] }] });
    await expect(migration.down(fake.qi)).resolves.toBeUndefined();
    expect(fake.statements).toEqual([]);
    expect(fake.indexes.map((i) => i.name)).toEqual(["PRIMARY", "countryname"]);
  });

  it("round-trips: up, down, up leaves exactly one unique key over countryname", async () => {
    const fake = makeQI();
    await migration.up(fake.qi);
    await migration.down(fake.qi);
    await migration.up(fake.qi);
    expect(fake.alters()).toEqual([ADD]);
    expect(fake.indexes.filter((i) => i.unique && i.columns.join() === "countryname")).toHaveLength(1);
  });
});
