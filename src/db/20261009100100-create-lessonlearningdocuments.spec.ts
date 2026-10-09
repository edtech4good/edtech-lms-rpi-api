/**
 * S-LI2: the `lessonlearningdocuments` link table. Drives up()/down() against a stand-in QueryInterface that keeps
 * the table, its indexes, foreign keys and row count: it proves what the migration asks MySQL for, in what order, and
 * what a re-run does. The real runs are in the change description.
 */
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261009100100-create-lessonlearningdocuments");

const TX = { id: "the-transaction" };

type State = {
  tables?: string[];
  rows?: number;
  collations?: Record<string, string>; // "table.column" -> collation
  indexes?: string[];
  keys?: string[];
};

const makeQI = (state: State = {}) => {
  const tables = new Set(state.tables ?? ["lessonlearnings", "documents"]);
  const indexes = new Set(state.indexes ?? []);
  const keys = new Set(state.keys ?? []);
  const collations: Record<string, string> = {
    "lessonlearnings.lessonlearningid": "utf8mb4_unicode_ci",
    "documents.documentid": "utf8mb4_unicode_ci",
    "lessonlearningdocuments.lessonlearningid": "utf8mb4_unicode_ci",
    "lessonlearningdocuments.documentid": "utf8mb4_unicode_ci",
    ...state.collations,
  };
  const statements: string[] = [];
  const qi = {
    showAllTables: jest.fn(async () => [...tables]),
    createTable: jest.fn(async (name: string) => {
      tables.add(name);
    }),
    dropTable: jest.fn(async (name: string) => {
      tables.delete(name);
    }),
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
        statements.push(sql);
        if (/CHARACTER_SET_NAME AS cs/.test(sql)) {
          const [table, column] = opts.replacements as [string, string];
          const coll = collations[`${table}.${column}`];
          return [[coll ? { cs: "utf8mb4", coll } : undefined].filter(Boolean)];
        }
        if (/information_schema\.statistics/.test(sql)) return [...indexes].map((name) => ({ name }));
        if (/information_schema\.table_constraints/.test(sql)) return [...keys].map((name) => ({ name }));
        if (/^SELECT COUNT\(\*\) AS n FROM `lessonlearningdocuments`/.test(sql)) return [{ n: state.rows ?? 0 }];
        const modify = /^ALTER TABLE `lessonlearningdocuments` MODIFY COLUMN `(\w+)` VARCHAR\(36\) CHARACTER SET (\w+) COLLATE (\w+) NOT NULL$/.exec(sql);
        if (modify) {
          collations[`lessonlearningdocuments.${modify[1]}`] = modify[3];
          return [[], undefined];
        }
        const addIndex = /ADD (UNIQUE )?INDEX `(\w+)`/.exec(sql);
        if (addIndex) {
          indexes.add(addIndex[2]);
          return [[], undefined];
        }
        const addKey = /ADD CONSTRAINT `(\w+)` FOREIGN KEY/.exec(sql);
        if (addKey) {
          keys.add(addKey[1]);
          return [[], undefined];
        }
        throw new Error(`unexpected statement: ${sql}`);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi: qi as never, raw: qi, tables, indexes, keys, collations, statements };
};

const created = (db: ReturnType<typeof makeQI>) => db.raw.createTable.mock.calls[0] as unknown as [string, Record<string, Record<string, unknown>>, Record<string, unknown>];

describe("S-LI2 up()", () => {
  it("creates the table with exactly the designed columns, in the transaction, naming charset and collation", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    const [name, columns, options] = created(db);
    expect(name).toBe("lessonlearningdocuments");
    expect(Object.keys(columns)).toEqual([
      "lessonlearningdocumentid",
      "lessonlearningid",
      "documentid",
      "lessonlearningdocumentrole",
      "lessonlearningdocumentorder",
    ]);
    expect(columns.lessonlearningdocumentid.primaryKey).toBe(true);
    for (const c of ["lessonlearningid", "documentid", "lessonlearningdocumentrole", "lessonlearningdocumentorder"]) expect(columns[c].allowNull).toBe(false);
    expect(columns.lessonlearningdocumentorder.defaultValue).toBe(0);
    expect((columns.lessonlearningdocumentrole.type as unknown as { options: { length: number } }).options.length).toBe(16);
    expect(options).toMatchObject({ transaction: TX, charset: "utf8mb4", collate: "utf8mb4_unicode_ci" });
    // no owner column and no audit columns
    expect(Object.keys(columns).some((c) => /organisation|created|updated|deleted/.test(c))).toBe(false);
  });

  it("takes the collation of the REAL lessonlearnings.lessonlearningid column", async () => {
    const db = makeQI({ collations: { "lessonlearnings.lessonlearningid": "utf8mb4_0900_ai_ci", "documents.documentid": "utf8mb4_0900_ai_ci", "lessonlearningdocuments.lessonlearningid": "utf8mb4_0900_ai_ci", "lessonlearningdocuments.documentid": "utf8mb4_0900_ai_ci" } });
    await migration.up(db.qi);
    expect(created(db)[2]).toMatchObject({ charset: "utf8mb4", collate: "utf8mb4_0900_ai_ci" });
  });

  it("aligns documentid with the REAL documents.documentid when that differs, before any foreign key", async () => {
    const db = makeQI({ collations: { "documents.documentid": "utf8mb4_0900_ai_ci" } });
    await migration.up(db.qi);
    const modify = db.statements.findIndex((s) => /MODIFY COLUMN `documentid` VARCHAR\(36\) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL/.test(s));
    const firstKey = db.statements.findIndex((s) => /FOREIGN KEY/.test(s));
    expect(modify).toBeGreaterThanOrEqual(0);
    expect(firstKey).toBeGreaterThan(modify);
  });

  it("adds the unique (lessonlearningid, documentid) key, the documentid index, then both foreign keys with the designed actions, indexes first", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    const ddl = db.statements.filter((s) => /^ALTER TABLE/.test(s));
    expect(ddl).toEqual([
      "ALTER TABLE `lessonlearningdocuments` ADD UNIQUE INDEX `lessonlearningdocuments_item_document_unique` USING BTREE (`lessonlearningid`, `documentid`)",
      "ALTER TABLE `lessonlearningdocuments` ADD INDEX `lessonlearningdocuments_documentid` USING BTREE (`documentid`)",
      "ALTER TABLE `lessonlearningdocuments` ADD CONSTRAINT `lessonlearningdocuments_lessonlearningid_fk` FOREIGN KEY (`lessonlearningid`) REFERENCES `lessonlearnings` (`lessonlearningid`) ON DELETE CASCADE ON UPDATE CASCADE",
      "ALTER TABLE `lessonlearningdocuments` ADD CONSTRAINT `lessonlearningdocuments_documentid_fk` FOREIGN KEY (`documentid`) REFERENCES `documents` (`documentid`) ON DELETE RESTRICT ON UPDATE CASCADE",
    ]);
  });

  it("is idempotent: with everything there, a second run creates and alters nothing", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    const created1 = db.raw.createTable.mock.calls.length;
    const ddl1 = db.statements.filter((s) => /^ALTER TABLE/.test(s)).length;
    await migration.up(db.qi);
    expect(db.raw.createTable.mock.calls.length).toBe(created1);
    expect(db.statements.filter((s) => /^ALTER TABLE/.test(s)).length).toBe(ddl1);
  });

  it("finishes a run that stopped halfway (table and unique key there, the rest not)", async () => {
    const db = makeQI({ tables: ["lessonlearnings", "documents", "lessonlearningdocuments"], indexes: ["PRIMARY", "lessonlearningdocuments_item_document_unique"] });
    await migration.up(db.qi);
    expect(db.raw.createTable).not.toHaveBeenCalled();
    expect(db.statements.filter((s) => /^ALTER TABLE/.test(s))).toHaveLength(3);
    expect([...db.keys].sort()).toEqual(["lessonlearningdocuments_documentid_fk", "lessonlearningdocuments_lessonlearningid_fk"]);
  });

  it("refuses, changing nothing, when lessonlearnings or documents is not there", async () => {
    const db = makeQI({ tables: ["documents"] });
    await expect(migration.up(db.qi)).rejects.toThrow(/lessonlearnings and documents must exist/);
    expect(db.raw.createTable).not.toHaveBeenCalled();
  });

  it("stops with a message, changing nothing, when a populated table has an id column in the wrong collation", async () => {
    const db = makeQI({
      tables: ["lessonlearnings", "documents", "lessonlearningdocuments"],
      rows: 2,
      collations: { "lessonlearningdocuments.documentid": "utf8mb4_0900_ai_ci" },
    });
    await expect(migration.up(db.qi)).rejects.toThrow(/lessonlearningdocuments\.documentid has collation utf8mb4_0900_ai_ci but documents\.documentid has utf8mb4_unicode_ci, and the table holds rows/);
    expect(db.statements.filter((s) => /^ALTER TABLE/.test(s))).toEqual([]);
  });
});

describe("S-LI2 down()", () => {
  it("drops the empty table, in the transaction", async () => {
    const db = makeQI({ tables: ["lessonlearnings", "documents", "lessonlearningdocuments"], rows: 0 });
    await migration.down(db.qi);
    expect(db.raw.dropTable).toHaveBeenCalledWith("lessonlearningdocuments", { transaction: TX });
    expect(db.tables.has("lessonlearningdocuments")).toBe(false);
  });

  it("refuses, naming the row count and dropping nothing, while the table holds rows", async () => {
    const db = makeQI({ tables: ["lessonlearnings", "documents", "lessonlearningdocuments"], rows: 3 });
    await expect(migration.down(db.qi)).rejects.toThrow(/S-LI2 down\(\) refused: lessonlearningdocuments holds 3 row\(s\)/);
    expect(db.raw.dropTable).not.toHaveBeenCalled();
    expect(db.tables.has("lessonlearningdocuments")).toBe(true);
  });

  it("is a no-op when the table is already gone", async () => {
    const db = makeQI();
    await migration.down(db.qi);
    expect(db.raw.dropTable).not.toHaveBeenCalled();
  });

  it("never drops anything but lessonlearningdocuments", async () => {
    const db = makeQI({ tables: ["lessonlearnings", "documents", "lessonlearningdocuments"] });
    await migration.down(db.qi);
    expect(db.raw.dropTable.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["lessonlearningdocuments"]);
  });
});
