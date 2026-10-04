/**
 * S1: the `organisations` mirror table. Drives up()/down() against a mocked
 * QueryInterface: it proves what the migration ASKS MySQL for (and that a re-run
 * asks for nothing); the real up, down, up and partial-state recovery are run on
 * a real database copy (see the change description).
 */
// A module (not a script), so the helpers below are not shared with the other migration specs.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261004120000-create-organisations");

const TX = { id: "the-transaction" };

type State = { tables?: string[]; charset?: string; collate?: string; existingCollate?: string; rows?: number };

const makeQI = (state: State = {}) => {
  const tables = new Set(state.tables ?? ["schools"]);
  const qi = {
    showAllTables: jest.fn(() => Promise.resolve([...tables])),
    createTable: jest.fn((name: string) => {
      tables.add(name);
      return Promise.resolve();
    }),
    dropTable: jest.fn((name: string) => {
      tables.delete(name);
      return Promise.resolve();
    }),
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn((sql: string, opts?: any): Promise<unknown> => {
        if (/COUNT\(\*\)/.test(sql)) {
          return Promise.resolve([[{ n: state.rows ?? 0 }]]);
        }
        if (/CHARACTER_SET_NAME/.test(sql) && opts.replacements[0] === "organisations") {
          return Promise.resolve([[{ cs: "utf8mb4", coll: state.existingCollate ?? state.collate ?? "utf8mb4_unicode_ci" }]]);
        }
        if (/CHARACTER_SET_NAME/.test(sql)) {
          return Promise.resolve([[{ cs: state.charset ?? "utf8mb4", coll: state.collate ?? "utf8mb4_unicode_ci" }]]);
        }
        return Promise.resolve([[]]);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, tables };
};

describe("S1 up()", () => {
  it("creates organisations with exactly the mirrored columns and no audit columns, in the transaction", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    expect(qi.createTable).toHaveBeenCalledTimes(1);
    const [name, columns, options] = qi.createTable.mock.calls[0] as unknown as [string, Record<string, unknown>, Record<string, unknown>];
    expect(name).toBe("organisations");
    expect(Object.keys(columns).sort()).toEqual(
      [
        "brandingconfig",
        "isdeleted",
        "organisationcode",
        "organisationid",
        "organisationname",
        "organisationstatus",
        "settingsconfig",
        "uitheme",
      ].sort(),
    );
    expect(options.transaction).toBe(TX);
  });

  it("takes the charset and collation of the REAL schools.schoolid column", async () => {
    const { qi } = makeQI({ charset: "utf8mb4", collate: "utf8mb4_0900_ai_ci" });
    await migration.up(qi);
    const read = qi.sequelize.query.mock.calls.find((c) => /INFORMATION_SCHEMA\.COLUMNS/.test(c[0]))!;
    expect(read[1].replacements).toEqual(["schools", "schoolid"]);
    const options = (qi.createTable.mock.calls[0] as unknown as unknown[])[2] as Record<string, unknown>;
    expect(options).toMatchObject({ charset: "utf8mb4", collate: "utf8mb4_0900_ai_ci" });
  });

  it("is idempotent: with the table already there and matching it creates and alters nothing", async () => {
    const { qi } = makeQI({ tables: ["schools", "organisations"] });
    await migration.up(qi);
    expect(qi.createTable).not.toHaveBeenCalled();
    const alters = qi.sequelize.query.mock.calls.filter((c) => /^ALTER/.test(c[0]));
    expect(alters).toEqual([]);
  });

  it("running twice creates the table once", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    await migration.up(qi);
    expect(qi.createTable).toHaveBeenCalledTimes(1);
  });
});

describe("S1 up(): a table that boot-time sync() created first", () => {
  const alters = (qi: ReturnType<typeof makeQI>["qi"]) => qi.sequelize.query.mock.calls.map((c) => c[0] as string).filter((q) => /^ALTER/.test(q));

  it("converts an EMPTY table with the wrong collation to schools.schoolid's charset and collation", async () => {
    const { qi } = makeQI({ tables: ["schools", "organisations"], existingCollate: "utf8mb4_0900_ai_ci", collate: "utf8mb4_unicode_ci", rows: 0 });
    await migration.up(qi);
    expect(alters(qi)).toEqual(["ALTER TABLE `organisations` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"]);
    expect(qi.createTable).not.toHaveBeenCalled();
  });

  it("stops with a clear message, changing nothing, when the wrong-collation table already has rows", async () => {
    const { qi } = makeQI({ tables: ["schools", "organisations"], existingCollate: "utf8mb4_0900_ai_ci", rows: 3 });
    await expect(migration.up(qi)).rejects.toThrow(/already exists with collation utf8mb4_0900_ai_ci instead of utf8mb4_unicode_ci.*3 row/);
    expect(alters(qi)).toEqual([]);
  });

  it("refuses a collation name that is not a plain identifier before altering", async () => {
    const { qi } = makeQI({ tables: ["schools", "organisations"], collate: "x; DROP TABLE y", existingCollate: "utf8mb4_0900_ai_ci" });
    await expect(migration.up(qi)).rejects.toThrow(/Unexpected charset/);
    expect(alters(qi)).toEqual([]);
  });
});

describe("S1 down()", () => {
  it("drops organisations, in the transaction", async () => {
    const { qi, tables } = makeQI({ tables: ["schools", "organisations"] });
    await migration.down(qi);
    expect(qi.dropTable).toHaveBeenCalledWith("organisations", { transaction: TX });
    expect(tables.has("organisations")).toBe(false);
  });

  it("is a no-op when the table is already gone (a partial up, or a second down)", async () => {
    const { qi } = makeQI();
    await migration.down(qi);
    expect(qi.dropTable).not.toHaveBeenCalled();
  });

  it("never drops anything but organisations", async () => {
    const { qi } = makeQI({ tables: ["schools", "organisations", "students"] });
    await migration.down(qi);
    expect(qi.dropTable.mock.calls.map((c) => c[0])).toEqual(["organisations"]);
  });
});
