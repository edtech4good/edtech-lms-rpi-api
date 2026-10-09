/**
 * S-LI1: `lessonlearningtype`, `lessonlearningbody`, and a nullable `documentid` on `lessonlearnings`.
 * Drives up() and down() against a stand-in database that keeps the table's columns and rows and answers the
 * statements the migration (and src/db/required-columns.ts) sends, so it proves what the migration asks MySQL
 * for, what it refuses, and what a re-run does. The real runs (a fresh database, the down/up round trip, a
 * populated copy) are in the change description.
 */
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261009100000-learning-item-type-and-body");

type Item = { id: string; lessonid: string; order: number; type?: string; body?: unknown; documentid: string | null };
type State = { items?: Item[]; columns?: string[]; documentidNullable?: boolean; documents?: Record<string, number> };

const makeDb = (state: State = {}) => {
  const columns = new Set(state.columns ?? ["lessonlearningid", "lessonid", "documentid", "lessonlearningorder"]);
  const hasTypeAlready = columns.has("lessonlearningtype");
  const items: Item[] = (state.items ?? []).map((i) => ({ ...i, type: i.type ?? (hasTypeAlready ? "video" : undefined) }));
  let documentidNullable = state.documentidNullable ?? false;
  const statements: string[] = [];
  const added: Array<{ column: string; definition: Record<string, unknown> }> = [];
  const removed: string[] = [];
  const TX = { id: "the-transaction" };

  const where = (sql: string): ((i: Item) => boolean) => {
    if (/`lessonlearningtype` <> 'video'/.test(sql)) return (i) => i.type !== undefined && i.type !== "video";
    if (/`lessonlearningbody` IS NOT NULL/.test(sql)) return (i) => i.body !== undefined && i.body !== null;
    if (/`documentid` IS NULL/.test(sql)) return (i) => i.documentid === null;
    return () => false;
  };

  const queryInterface = {
    describeTable: jest.fn(async () => Object.fromEntries([...columns].map((c) => [c, {}]))),
    addColumn: jest.fn(async (_t: string, column: string, definition: Record<string, unknown>) => {
      columns.add(column);
      added.push({ column, definition });
      // MySQL fills existing rows with the column's DEFAULT as part of the ALTER.
      if (column === "lessonlearningtype") for (const i of items) i.type = String(definition.defaultValue);
      if (column === "lessonlearningbody") for (const i of items) i.body = null;
    }),
    removeColumn: jest.fn(async (_t: string, column: string) => {
      columns.delete(column);
      removed.push(column);
    }),
    sequelize: {
      escape: (v: string) => `'${v}'`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
        statements.push(sql);
        if (/^SELECT @@SESSION\.sql_mode/.test(sql)) return [{ mode: "STRICT_TRANS_TABLES" }];
        if (/COLUMN_TYPE AS type/.test(sql)) {
          return opts.replacements[1] === "documentid"
            ? [{ type: "varchar(36)", nullable: documentidNullable ? "YES" : "NO", cs: "utf8mb4", coll: "utf8mb4_unicode_ci", comment: "" }]
            : [];
        }
        if (/INFORMATION_SCHEMA\.COLUMNS WHERE TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = \? AND COLUMN_NAME = \?/.test(sql)) {
          return [{ n: columns.has(opts.replacements[1]) ? 1 : 0 }];
        }
        const alter = /^ALTER TABLE `lessonlearnings` MODIFY COLUMN `documentid` .* (NOT NULL|NULL DEFAULT NULL)/.exec(sql);
        if (alter) {
          if (alter[1] === "NOT NULL" && items.some((i) => i.documentid === null)) throw new Error("Invalid use of NULL value");
          documentidNullable = alter[1] !== "NOT NULL";
          return [[], undefined];
        }
        if (/GROUP BY lessonid, lessonlearningorder HAVING COUNT/.test(sql)) {
          const seen = new Map<string, number>();
          for (const i of items) seen.set(`${i.lessonid}/${i.order}`, (seen.get(`${i.lessonid}/${i.order}`) ?? 0) + 1);
          return [{ n: [...seen.values()].filter((n) => n > 1).length }];
        }
        if (/JOIN documents d ON/.test(sql)) {
          return [{ n: items.filter((i) => i.documentid !== null && (state.documents?.[i.documentid] ?? 2) !== 2).length }];
        }
        if (/^SELECT COUNT\(\*\) AS n FROM `lessonlearnings` WHERE/.test(sql)) return [{ n: items.filter(where(sql)).length }];
        if (/^SELECT lessonlearningid AS id FROM `lessonlearnings` WHERE/.test(sql)) {
          const limit = /LIMIT (\d+)$/.exec(sql);
          const ids = items.filter(where(sql)).map((i) => ({ id: i.id })).sort((a, b) => a.id.localeCompare(b.id));
          return limit ? ids.slice(0, Number(limit[1])) : ids;
        }
        throw new Error(`unexpected statement: ${sql}`);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi: queryInterface as never, columns, items, statements, added, removed, TX, isNullable: () => documentidNullable, raw: queryInterface };
};

const alters = (db: ReturnType<typeof makeDb>) => db.statements.filter((s) => /^ALTER TABLE/.test(s));
const writes = (db: ReturnType<typeof makeDb>) => db.statements.filter((s) => /^\s*(UPDATE|INSERT|DELETE|REPLACE)/i.test(s));

describe("S-LI1 up()", () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  it("adds the type as NOT NULL with default 'video' and the body as nullable JSON, in the transaction", async () => {
    const db = makeDb({ items: [{ id: "a", lessonid: "l1", order: 1, documentid: "d1" }] });
    await migration.up(db.qi);
    const type = db.added.find((a) => a.column === "lessonlearningtype")!.definition as { allowNull: boolean; defaultValue: string; type: { options?: { length?: number } } };
    expect(type.allowNull).toBe(false);
    expect(type.defaultValue).toBe("video");
    expect(type.type.options?.length).toBe(16);
    const body = db.added.find((a) => a.column === "lessonlearningbody")!.definition as { allowNull: boolean };
    expect(body.allowNull).toBe(true);
    expect(db.raw.addColumn.mock.calls.map((c) => (c as unknown[])[3])).toEqual([{ transaction: db.TX }, { transaction: db.TX }]);
  });

  it("an existing learning becomes a video item with the same id and no row is written by a statement", async () => {
    const db = makeDb({ items: [{ id: "a", lessonid: "l1", order: 1, documentid: "d1" }, { id: "b", lessonid: "l1", order: 2, documentid: "d2" }] });
    await migration.up(db.qi);
    expect(db.items.map((i) => [i.id, i.type, i.body, i.documentid])).toEqual([["a", "video", null, "d1"], ["b", "video", null, "d2"]]);
    expect(writes(db)).toEqual([]);
  });

  it("makes documentid nullable with exactly one MODIFY of that column, keeping type and collation", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    expect(alters(db)).toEqual(["ALTER TABLE `lessonlearnings` MODIFY COLUMN `documentid` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL"]);
    expect(db.isNullable()).toBe(true);
  });

  it("is idempotent: a second run adds no column and sends no ALTER", async () => {
    const db = makeDb();
    await migration.up(db.qi);
    const addsAfterFirst = db.raw.addColumn.mock.calls.length;
    const altersAfterFirst = alters(db).length;
    await migration.up(db.qi);
    expect(db.raw.addColumn.mock.calls.length).toBe(addsAfterFirst);
    expect(alters(db).length).toBe(altersAfterFirst);
  });

  it("finishes a run that stopped halfway (the type is there, the body and the flip are not)", async () => {
    const db = makeDb({ columns: ["lessonlearningid", "lessonid", "documentid", "lessonlearningorder", "lessonlearningtype"] });
    await migration.up(db.qi);
    expect(db.added.map((a) => a.column)).toEqual(["lessonlearningbody"]);
    expect(db.isNullable()).toBe(true);
  });

  it("reports ties and non-video documents as counts only, and changes nothing because of them", async () => {
    const db = makeDb({
      items: [
        { id: "a", lessonid: "l1", order: 1, documentid: "d1" },
        { id: "b", lessonid: "l1", order: 1, documentid: "d2" },
        { id: "c", lessonid: "l2", order: 1, documentid: "d3" },
      ],
      documents: { d3: 5 },
    });
    await migration.up(db.qi);
    expect(log).toHaveBeenCalledWith("S-LI1 lessonlearnings: lessons_with_order_ties=1 learnings_on_a_non_video_document=1 (reported, nothing changed)");
    expect(db.items.map((i) => i.order)).toEqual([1, 1, 1]);
  });
});

describe("S-LI1 down()", () => {
  const migrated = (items: Item[] = []) =>
    makeDb({ columns: ["lessonlearningid", "lessonid", "documentid", "lessonlearningorder", "lessonlearningtype", "lessonlearningbody"], documentidNullable: true, items });

  it("on a table of video items with a document: restores NOT NULL and drops both columns", async () => {
    const db = migrated([{ id: "a", lessonid: "l1", order: 1, type: "video", body: null, documentid: "d1" }]);
    await migration.down(db.qi);
    expect(db.isNullable()).toBe(false);
    expect(db.removed).toEqual(["lessonlearningbody", "lessonlearningtype"]);
    expect(writes(db)).toEqual([]);
  });

  it("refuses, listing the ids and changing nothing, while an item has a type other than video", async () => {
    const db = migrated([{ id: "x1", lessonid: "l1", order: 1, type: "audio", body: null, documentid: "d1" }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("S-LI1 down() refused");
    expect(err.message).toContain("lessonlearnings: 1 item(s) with a type other than 'video' (all): x1");
    expect(alters(db)).toEqual([]);
    expect(db.removed).toEqual([]);
    expect(db.isNullable()).toBe(true);
  });

  it("refuses while an item has a body", async () => {
    const db = migrated([{ id: "x2", lessonid: "l1", order: 1, type: "video", body: { v: 1 }, documentid: "d1" }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("lessonlearnings: 1 item(s) with a body (all): x2");
    expect(db.removed).toEqual([]);
  });

  it("refuses while an item has no document", async () => {
    const db = migrated([{ id: "x3", lessonid: "l1", order: 1, type: "video", body: null, documentid: null }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("lessonlearnings: 1 item(s) with no document (all): x3");
    expect(alters(db)).toEqual([]);
    expect(db.removed).toEqual([]);
  });

  it("names every broken rule at once, and shows the first 50 ids of a longer list with the exact count", async () => {
    const many: Item[] = Array.from({ length: 53 }, (_, n) => ({ id: `n${String(n).padStart(3, "0")}`, lessonid: "l", order: n, type: "video", body: null, documentid: null }));
    const db = migrated([...many, { id: "z", lessonid: "l", order: 99, type: "audio", body: { v: 1 }, documentid: "d" }]);
    const err = await migration.down(db.qi).catch((e: Error) => e);
    expect(err.message).toContain("3 rule(s)");
    expect(err.message).toContain("53 item(s) with no document (first 50)");
    expect(err.message).toContain("n000");
    expect(err.message).not.toContain("n050");
  });

  it("is safe on a database where up() never ran (the columns are not there)", async () => {
    const db = makeDb({ documentidNullable: false });
    await migration.down(db.qi);
    expect(db.removed).toEqual([]);
  });
});
