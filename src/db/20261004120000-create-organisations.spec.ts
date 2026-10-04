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

type State = { tables?: string[]; charset?: string; collate?: string };

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
      query: jest.fn((_sql: string, _opts?: any): Promise<unknown> =>
        Promise.resolve([[{ cs: state.charset ?? "utf8mb4", coll: state.collate ?? "utf8mb4_unicode_ci" }]]),
      ),
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

  it("is idempotent: with the table already there it creates nothing and reads nothing", async () => {
    const { qi } = makeQI({ tables: ["schools", "organisations"] });
    await migration.up(qi);
    expect(qi.createTable).not.toHaveBeenCalled();
    expect(qi.sequelize.query).not.toHaveBeenCalled();
  });

  it("running twice creates the table once", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    await migration.up(qi);
    expect(qi.createTable).toHaveBeenCalledTimes(1);
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
