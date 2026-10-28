/**
 * B-1: the `contenttranslations` table and `organisations.contentlanguage`. Drives up()/down() against a stand-in
 * QueryInterface that keeps the tables, columns, indexes, foreign keys and row counts: it proves what the migration
 * asks MySQL for, in what order, and what a re-run does. The real run (migrate, undo, migrate, SHOW CREATE
 * identical) is in the change description.
 */
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261028120000-content-translations");

const TX = { id: "the-transaction" };

type State = {
  tables?: string[];
  rows?: number;
  languages?: number;
  organisationColumns?: string[];
  collations?: Record<string, string>; // "table.column" -> collation
  indexes?: string[];
  keys?: string[];
};

const makeQI = (state: State = {}) => {
  const tables = new Set(state.tables ?? ["organisations"]);
  const indexes = new Set(state.indexes ?? []);
  const keys = new Set(state.keys ?? []);
  const organisationColumns = new Set(state.organisationColumns ?? ["organisationid", "organisationname"]);
  const collations: Record<string, string> = {
    "organisations.organisationid": "utf8mb4_unicode_ci",
    "contenttranslations.organisationid": "utf8mb4_unicode_ci",
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
    describeTable: jest.fn(async (name: string) => {
      if (name !== "organisations") return {};
      return Object.fromEntries([...organisationColumns].map((c) => [c, {}]));
    }),
    addColumn: jest.fn(async (table: string, column: string) => {
      if (table === "organisations") organisationColumns.add(column);
    }),
    removeColumn: jest.fn(async (table: string, column: string) => {
      if (table === "organisations") organisationColumns.delete(column);
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
        if (/^SELECT COUNT\(\*\) AS n FROM `contenttranslations`/.test(sql)) return [{ n: state.rows ?? 0 }];
        if (/^SELECT COUNT\(\*\) AS n FROM `organisations` WHERE `contentlanguage` IS NOT NULL/.test(sql)) return [{ n: state.languages ?? 0 }];
        const modify = /^ALTER TABLE `contenttranslations` MODIFY COLUMN `(\w+)` VARCHAR\(36\) CHARACTER SET (\w+) COLLATE (\w+) NOT NULL$/.exec(sql);
        if (modify) {
          collations[`contenttranslations.${modify[1]}`] = modify[3];
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
  return { qi: qi as never, raw: qi, tables, indexes, keys, collations, statements, organisationColumns };
};

const created = (db: ReturnType<typeof makeQI>) => db.raw.createTable.mock.calls[0] as unknown as [string, Record<string, Record<string, unknown>>, Record<string, unknown>];
const ddl = (db: ReturnType<typeof makeQI>) => db.statements.filter((s) => /^ALTER TABLE/.test(s));
const typeOf = (c: Record<string, unknown>) => String(c.type);

describe("B-1 up()", () => {
  it("creates the table with exactly the designed columns, in the transaction, naming charset and collation", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    const [name, columns, options] = created(db);
    expect(name).toBe("contenttranslations");
    expect(Object.keys(columns)).toEqual(["translationid", "organisationid", "tablename", "rowid", "field", "subkey", "language", "text", "sourcehash", "lastupdated"]);
    expect(columns.translationid.primaryKey).toBe(true);
    for (const c of Object.keys(columns)) expect(columns[c].allowNull).toBe(false);
    expect(typeOf(columns.translationid)).toBe("VARCHAR(36)");
    expect(typeOf(columns.organisationid)).toBe("VARCHAR(36)");
    expect(typeOf(columns.tablename)).toBe("VARCHAR(40)");
    expect(typeOf(columns.rowid)).toBe("VARCHAR(36)");
    expect(typeOf(columns.field)).toBe("VARCHAR(64)");
    expect(typeOf(columns.subkey)).toBe("VARCHAR(36)");
    expect(typeOf(columns.language)).toBe("VARCHAR(8)");
    expect(typeOf(columns.text)).toBe("TEXT");
    expect(typeOf(columns.sourcehash)).toBe("CHAR(64)");
    expect(typeOf(columns.lastupdated)).toBe("DATETIME");
    expect((columns.lastupdated.type as unknown as { options: { length: number } }).options.length).toBe(3); // DATETIME(3)
    // '' is "no subkey": the unique key cannot hold a NULL
    expect(columns.subkey.defaultValue).toBe("");
    expect(options).toMatchObject({ transaction: TX, charset: "utf8mb4", collate: "utf8mb4_unicode_ci" });
    // hard-deleted: no soft-delete or audit columns
    expect(Object.keys(columns).some((c) => /isdeleted|created|deleted/.test(c))).toBe(false);
  });

  it("takes the collation of the REAL organisations.organisationid column", async () => {
    const db = makeQI({ collations: { "organisations.organisationid": "utf8mb4_0900_ai_ci", "contenttranslations.organisationid": "utf8mb4_0900_ai_ci" } });
    await migration.up(db.qi);
    expect(created(db)[2]).toMatchObject({ charset: "utf8mb4", collate: "utf8mb4_0900_ai_ci" });
  });

  it("adds the unique key over (tablename, rowid, field, subkey, language), the two indexes, then the foreign key with the designed actions, indexes first", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    expect(ddl(db)).toEqual([
      "ALTER TABLE `contenttranslations` ADD UNIQUE INDEX `contenttranslations_parent_language_unique` USING BTREE (`tablename`, `rowid`, `field`, `subkey`, `language`)",
      "ALTER TABLE `contenttranslations` ADD INDEX `contenttranslations_organisationid` USING BTREE (`organisationid`)",
      "ALTER TABLE `contenttranslations` ADD INDEX `contenttranslations_table_row` USING BTREE (`tablename`, `rowid`)",
      "ALTER TABLE `contenttranslations` ADD CONSTRAINT `contenttranslations_organisationid_fk` FOREIGN KEY (`organisationid`) REFERENCES `organisations` (`organisationid`) ON DELETE RESTRICT ON UPDATE CASCADE",
    ]);
  });

  it("adds organisations.contentlanguage as a nullable STRING(8) with no default value", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    expect(db.raw.addColumn).toHaveBeenCalledTimes(1);
    const [table, column, definition, options] = db.raw.addColumn.mock.calls[0] as unknown as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect([table, column]).toEqual(["organisations", "contentlanguage"]);
    expect(String(definition.type)).toBe("VARCHAR(8)");
    expect(definition.allowNull).toBe(true);
    expect(definition.defaultValue).toBeNull();
    expect(options).toMatchObject({ transaction: TX });
  });

  it("is idempotent: with everything there, a second run creates and alters nothing", async () => {
    const db = makeQI();
    await migration.up(db.qi);
    const created1 = db.raw.createTable.mock.calls.length;
    const ddl1 = ddl(db).length;
    await migration.up(db.qi);
    expect(db.raw.createTable.mock.calls.length).toBe(created1);
    expect(ddl(db).length).toBe(ddl1);
    expect(db.raw.addColumn).toHaveBeenCalledTimes(1);
  });

  it("finishes a run that stopped halfway (table and unique key there, the rest not)", async () => {
    const db = makeQI({ tables: ["organisations", "contenttranslations"], indexes: ["PRIMARY", "contenttranslations_parent_language_unique"] });
    await migration.up(db.qi);
    expect(db.raw.createTable).not.toHaveBeenCalled();
    expect(ddl(db)).toHaveLength(3);
    expect([...db.keys]).toEqual(["contenttranslations_organisationid_fk"]);
    expect(db.organisationColumns.has("contentlanguage")).toBe(true);
  });

  it("refuses, changing nothing, when organisations is not there", async () => {
    const db = makeQI({ tables: [] });
    await expect(migration.up(db.qi)).rejects.toThrow(/organisations must exist/);
    expect(db.raw.createTable).not.toHaveBeenCalled();
    expect(db.raw.addColumn).not.toHaveBeenCalled();
  });

  it("stops with a message, changing nothing, when a populated table has organisationid in the wrong collation", async () => {
    const db = makeQI({
      tables: ["organisations", "contenttranslations"],
      rows: 2,
      collations: { "contenttranslations.organisationid": "utf8mb4_0900_ai_ci" },
    });
    await expect(migration.up(db.qi)).rejects.toThrow(/contenttranslations\.organisationid has collation utf8mb4_0900_ai_ci but organisations\.organisationid has utf8mb4_unicode_ci, and the table holds rows/);
    expect(ddl(db)).toEqual([]);
  });
});

describe("B-1 down()", () => {
  const present = { tables: ["organisations", "contenttranslations"], organisationColumns: ["organisationid", "contentlanguage"] };

  it("drops the empty table and the column, in the transaction", async () => {
    const db = makeQI(present);
    await migration.down(db.qi);
    expect(db.raw.dropTable).toHaveBeenCalledWith("contenttranslations", { transaction: TX });
    expect(db.raw.removeColumn).toHaveBeenCalledWith("organisations", "contentlanguage", { transaction: TX });
    expect(db.tables.has("contenttranslations")).toBe(false);
    expect(db.organisationColumns.has("contentlanguage")).toBe(false);
  });

  it("refuses, naming the counts and dropping nothing, while the table holds rows", async () => {
    const db = makeQI({ ...present, rows: 3 });
    await expect(migration.down(db.qi)).rejects.toThrow(/B-1 down\(\) refused: contenttranslations holds 3 row\(s\) and 0 organisation\(s\)/);
    expect(db.raw.dropTable).not.toHaveBeenCalled();
    expect(db.raw.removeColumn).not.toHaveBeenCalled();
  });

  it("refuses while an organisation has a contentlanguage", async () => {
    const db = makeQI({ ...present, languages: 1 });
    await expect(migration.down(db.qi)).rejects.toThrow(/holds 0 row\(s\) and 1 organisation\(s\) have a contentlanguage/);
    expect(db.raw.dropTable).not.toHaveBeenCalled();
    expect(db.raw.removeColumn).not.toHaveBeenCalled();
  });

  it("is a no-op when the table and the column are already gone", async () => {
    const db = makeQI();
    await migration.down(db.qi);
    expect(db.raw.dropTable).not.toHaveBeenCalled();
    expect(db.raw.removeColumn).not.toHaveBeenCalled();
  });

  it("never drops anything but contenttranslations and the one column", async () => {
    const db = makeQI(present);
    await migration.down(db.qi);
    expect(db.raw.dropTable.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["contenttranslations"]);
    expect(db.raw.removeColumn.mock.calls.map((c) => (c as unknown[]).slice(0, 2))).toEqual([["organisations", "contentlanguage"]]);
  });
});
