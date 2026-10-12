/**
 * S-ML1: `documenttitle`, `documentlicence` and `documentattribution` on `documents`.
 * Drives up() and down() against a stand-in database that keeps the table's columns and rows and answers the
 * statements the migration sends, so it proves what the migration asks MySQL for, what it refuses, what it prints
 * and what a re-run does. The real runs (a fresh database, the down/up round trip, a populated copy) are in the
 * change description.
 */
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261012100000-document-title-licence-attribution");

type Doc = { id: string; typeid: number; name: string; title?: string | null; licence?: string; attribution?: unknown };
type State = { docs?: Doc[]; columns?: string[] };

const BASE_COLUMNS = ["documentid", "documenttypeid", "documentname"];
// The old upload rule: letters, digits and underscores, 1 to 25 of them, then one extension. (The statement's pattern is
// asserted verbatim below; this is its meaning for the stand-in database.)
const fitsOldRule = (name: string) => /^[a-zA-Z0-9_]{1,25}\.[^.]*$/.test(name);

const makeDb = (state: State = {}) => {
  const columns = new Set(state.columns ?? BASE_COLUMNS);
  const docs: Doc[] = (state.docs ?? []).map((d) => ({ ...d }));
  const statements: string[] = [];
  const added: Array<{ column: string; definition: Record<string, unknown> }> = [];
  const removed: string[] = [];
  const TX = { id: "the-transaction" };

  const where = (sql: string): ((d: Doc) => boolean) => {
    if (/`documenttitle` IS NOT NULL/.test(sql)) return (d) => d.title !== undefined && d.title !== null;
    if (/`documentlicence` <> 'unspecified'/.test(sql)) return (d) => d.licence !== undefined && d.licence !== "unspecified";
    if (/`documentattribution` IS NOT NULL/.test(sql)) return (d) => d.attribution !== undefined && d.attribution !== null;
    return () => false;
  };

  const queryInterface = {
    describeTable: jest.fn(async () => Object.fromEntries([...columns].map((c) => [c, {}]))),
    addColumn: jest.fn(async (_t: string, column: string, definition: Record<string, unknown>) => {
      columns.add(column);
      added.push({ column, definition });
      // MySQL fills existing rows with the column's DEFAULT as part of the ALTER.
      for (const d of docs) {
        if (column === "documenttitle") d.title = null;
        if (column === "documentlicence") d.licence = String(definition.defaultValue);
        if (column === "documentattribution") d.attribution = null;
      }
    }),
    removeColumn: jest.fn(async (_t: string, column: string) => {
      columns.delete(column);
      removed.push(column);
    }),
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
        statements.push(sql);
        if (/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = \? AND COLUMN_NAME = \?/.test(sql)) {
          expect(opts.replacements[0]).toBe("documents");
          return [{ n: columns.has(opts.replacements[1]) ? 1 : 0 }];
        }
        if (/^SELECT documenttypeid AS type, COUNT\(\*\) AS n FROM `documents` GROUP BY documenttypeid/.test(sql)) {
          const per = new Map<number, number>();
          for (const d of docs) per.set(d.typeid, (per.get(d.typeid) ?? 0) + 1);
          return [...per.entries()].sort((a, b) => a[0] - b[0]).map(([type, n]) => ({ type, n: String(n) }));
        }
        if (/REGEXP_LIKE\(documentname, '\^\[a-zA-Z0-9_\]\{1,25\}\[\.\]\[\^\.\]\*\$', 'c'\)/.test(sql)) {
          return [{ n: docs.filter((d) => !fitsOldRule(d.name)).length }];
        }
        if (/^SELECT COUNT\(\*\) AS n FROM `documents` WHERE/.test(sql)) return [{ n: docs.filter(where(sql)).length }];
        if (/^SELECT documentid AS id FROM `documents` WHERE/.test(sql)) {
          const limit = /LIMIT (\d+)$/.exec(sql);
          const ids = docs.filter(where(sql)).map((d) => ({ id: d.id })).sort((a, b) => a.id.localeCompare(b.id));
          return limit ? ids.slice(0, Number(limit[1])) : ids;
        }
        throw new Error(`unexpected statement: ${sql}`);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi: queryInterface as never, columns, docs, statements, added, removed, TX, raw: queryInterface };
};

const alters = (db: ReturnType<typeof makeDb>) => db.statements.filter((s) => /^ALTER TABLE/.test(s));
const writes = (db: ReturnType<typeof makeDb>) => db.statements.filter((s) => /^\s*(UPDATE|INSERT|DELETE|REPLACE)/i.test(s));
const defOf = (db: ReturnType<typeof makeDb>, column: string) =>
  db.added.find((a) => a.column === column)!.definition as { allowNull: boolean; defaultValue: unknown; type: { options?: { length?: number }; key?: string } };

// Khmer copied from docs/khmer-text.md (a place name) and an existing spec (a document name).
const KHMER_TITLE = "ភ្នំពេញ";

describe("S-ML1 up()", () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it("adds the title as nullable STRING(255) with default null, in the transaction", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    const title = defOf(db, "documenttitle");
    expect(title.allowNull).toBe(true);
    expect(title.defaultValue).toBeNull();
    expect(title.type.options?.length).toBe(255);
    expect(db.raw.addColumn.mock.calls.map((c) => (c as unknown[]).slice(0, 2))).toContainEqual(["documents", "documenttitle"]);
  });

  it("adds the licence as NOT NULL STRING(64) with default 'unspecified'", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    const licence = defOf(db, "documentlicence");
    expect(licence.allowNull).toBe(false);
    expect(licence.defaultValue).toBe("unspecified");
    expect(licence.type.options?.length).toBe(64);
  });

  it("adds the attribution as nullable JSON with default null", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    const attribution = defOf(db, "documentattribution");
    expect(attribution.allowNull).toBe(true);
    expect(attribution.defaultValue).toBeNull();
    expect(String(attribution.type.key ?? (attribution.type as object).constructor.name)).toMatch(/JSON/);
  });

  it("adds exactly these three columns, every one inside the one transaction, and names no charset or collation (the table's own applies)", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    expect(db.added.map((a) => a.column)).toEqual(["documenttitle", "documentlicence", "documentattribution"]);
    expect(db.raw.addColumn.mock.calls.map((c) => (c as unknown[])[3])).toEqual([{ transaction: db.TX }, { transaction: db.TX }, { transaction: db.TX }]);
    for (const a of db.added) expect(Object.keys(a.definition).sort()).toEqual(["allowNull", "defaultValue", "type"]);
    expect(db.raw.sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it("an existing document keeps its id, key and type, gets no title or attribution and the licence 'unspecified', and no row is written by a statement", async () => {
    const db = makeDb({ docs: [{ id: "a", typeid: 2, name: "intro.mp4" }, { id: "b", typeid: 6, name: "map.png" }] });
    await migration.up(db.qi);
    expect(db.docs).toEqual([
      { id: "a", typeid: 2, name: "intro.mp4", title: null, licence: "unspecified", attribution: null },
      { id: "b", typeid: 6, name: "map.png", title: null, licence: "unspecified", attribution: null },
    ]);
    expect(writes(db)).toEqual([]);
    expect(alters(db)).toEqual([]);
  });

  it("is idempotent: a second run adds no column and writes nothing", async () => {
    const db = makeDb({ docs: [{ id: "a", typeid: 2, name: "intro.mp4" }] });
    await migration.up(db.qi);
    const addsAfterFirst = db.raw.addColumn.mock.calls.length;
    await migration.up(db.qi);
    expect(db.raw.addColumn.mock.calls.length).toBe(addsAfterFirst);
    expect(writes(db)).toEqual([]);
  });

  it("finishes a run that stopped halfway (the title is there, the other two are not) without touching the title", async () => {
    const db = makeDb({ columns: [...BASE_COLUMNS, "documenttitle"], docs: [{ id: "a", typeid: 2, name: "intro.mp4", title: KHMER_TITLE }] });
    await migration.up(db.qi);
    expect(db.added.map((a) => a.column)).toEqual(["documentlicence", "documentattribution"]);
    expect(db.docs[0].title).toBe(KHMER_TITLE);
  });

  it("prints two counts and nothing else: the documents per type, and the names that fail the old upload rule", async () => {
    const db = makeDb({
      docs: [
        { id: "a", typeid: 2, name: "intro.mp4" },
        { id: "b", typeid: 2, name: "lesson_one.mp4" },
        { id: "c", typeid: 6, name: "dcrs-m1-l1.png" }, // a hyphen
        { id: "d", typeid: 5, name: "demo/counting.pdf" }, // a slash
        { id: "e", typeid: 5, name: "a_very_long_file_name_over_25_chars.pdf" },
        { id: "f", typeid: 1, name: "ភ្នំពេញ.mp3" },
        { id: "g", typeid: 1, name: "two.dots.mp3" },
      ],
    });
    await migration.up(db.qi);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "S-ML1 documents: documents_by_documenttypeid=1:2,2:2,5:2,6:1 names_failing_the_old_upload_rule=5 (reported, nothing changed)",
    );
    expect(String(log.mock.calls[0][0])).not.toMatch(/intro|dcrs|demo|ភ្នំពេញ/);
    expect(writes(db)).toEqual([]);
  });

  it("an empty table prints 'none' and 0", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    expect(log).toHaveBeenCalledWith("S-ML1 documents: documents_by_documenttypeid=none names_failing_the_old_upload_rule=0 (reported, nothing changed)");
  });
});

describe("S-ML1 down()", () => {
  const ALL = [...BASE_COLUMNS, "documenttitle", "documentlicence", "documentattribution"];
  const migrated = (docs: Doc[] = []) => makeDb({ columns: ALL, docs });
  const clean = (id: string): Doc => ({ id, typeid: 2, name: `${id}.mp4`, title: null, licence: "unspecified", attribution: null });

  it("on documents that hold no value: drops the three columns and writes nothing", async () => {
    const db = migrated([clean("a")]);
    await migration.down(db.qi);
    expect(db.removed.sort()).toEqual(["documentattribution", "documentlicence", "documenttitle"]);
    expect(writes(db)).toEqual([]);
  });

  it("refuses, listing the ids and changing nothing, while a document has a title", async () => {
    const db = migrated([clean("a"), { ...clean("t1"), title: KHMER_TITLE }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("S-ML1 down() refused");
    expect(err.message).toContain("documents: 1 document(s) with a title (all): t1");
    expect(db.removed).toEqual([]);
  });

  it("refuses while a document has a licence other than 'unspecified'", async () => {
    const db = migrated([clean("a"), { ...clean("l1"), licence: "CC-BY-4.0" }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("documents: 1 document(s) with a licence other than 'unspecified' (all): l1");
    expect(db.removed).toEqual([]);
  });

  it("refuses while a document has an attribution", async () => {
    const db = migrated([clean("a"), { ...clean("r1"), attribution: { v: 1, author: "x" } }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("documents: 1 document(s) with an attribution (all): r1");
    expect(db.removed).toEqual([]);
  });

  it("names every broken rule at once, and shows the first 50 ids of a longer list with the exact count", async () => {
    const many: Doc[] = Array.from({ length: 53 }, (_, n) => ({ ...clean(`n${String(n).padStart(3, "0")}`), title: KHMER_TITLE }));
    const db = migrated([...many, { ...clean("z"), licence: "CC0-1.0", attribution: { v: 1 } }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("3 rule(s)");
    expect(err.message).toContain("53 document(s) with a title (first 50)");
    expect(err.message).toContain("n000");
    expect(err.message).toContain("n049");
    expect(err.message).not.toContain("n050");
    expect(db.removed).toEqual([]);
  });

  it("is safe on a database where up() never ran (the columns are not there)", async () => {
    const db = makeDb();
    await migration.down(db.qi);
    expect(db.removed).toEqual([]);
  });

  it("a half-migrated database (only the title is there) is also guarded", async () => {
    const db = makeDb({ columns: [...BASE_COLUMNS, "documenttitle"], docs: [{ id: "h1", typeid: 2, name: "a.mp4", title: KHMER_TITLE }] });
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("with a title (all): h1");
    expect(db.removed).toEqual([]);
  });
});
