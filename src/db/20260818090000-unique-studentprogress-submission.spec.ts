/**
 * down() of the unique submission key on `studentprogress`. The unique index starts with `studentid`, so it is
 * what the foreign key studentprogress_ibfk_1 (studentid -> students) runs on once MySQL has dropped the plain
 * `studentid` index the table had before up(). MySQL refuses to drop it while nothing else starts with
 * `studentid` (1553), which stopped `db:migrate:undo:all`. These specs drive down() against a stand-in
 * QueryInterface that applies that same rule; the real runs (a fresh database migrated, undone and migrated
 * again; the table compared before up() and after down()) are described in the change description.
 */
// A module (not a script), so the helpers below are not shared with the other migration specs.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20260818090000-unique-studentprogress-submission");

const TX = { id: "the-transaction" };
const UNIQUE = "uq_studentprogress_submission";

interface FakeIndex {
  name: string;
  columns: string[];
  prefix?: boolean;
}

const makeQI = (indexes: FakeIndex[]) => {
  const state: FakeIndex[] = indexes.map((i) => ({ ...i, columns: [...i.columns] }));
  const calls: string[] = [];
  const transactions: unknown[] = [];
  const servesForeignKey = (excluding: string) => state.some((i) => i.name !== excluding && !i.prefix && i.columns[0] === "studentid");
  const qi = {
    addIndex: jest.fn(async (table: string, fields: string[], opts: { name: string; transaction: unknown }) => {
      calls.push(`addIndex ${table} (${fields.join(",")}) as ${opts.name}`);
      transactions.push(opts.transaction);
      state.push({ name: opts.name, columns: fields });
    }),
    removeIndex: jest.fn(async (table: string, name: string, opts: { transaction: unknown }) => {
      calls.push(`removeIndex ${table} ${name}`);
      transactions.push(opts.transaction);
      // MySQL 1553: the index the foreign key runs on cannot go while no other index can serve it.
      if (name.startsWith("uq_") && !servesForeignKey(name)) {
        throw new Error(`Cannot drop index '${name}': needed in a foreign key constraint`);
      }
      state.splice(state.findIndex((i) => i.name === name), 1);
    }),
    showIndex: jest.fn(async () => []),
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
        calls.push("read indexes");
        transactions.push(opts.transaction);
        expect(sql).toContain("INFORMATION_SCHEMA.STATISTICS");
        expect(sql).toContain("TABLE_NAME = 'studentprogress'");
        return state.flatMap((i) => i.columns.map((c, n) => ({ index_name: i.name, seq_in_index: n + 1, column_name: c, sub_part: i.prefix ? 10 : null })));
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, state, calls, transactions };
};

const UNIQUE_INDEX: FakeIndex = { name: UNIQUE, columns: ["studentid", "studentprogressreferenceid", "starttime"] };
const PRIMARY: FakeIndex = { name: "PRIMARY", columns: ["studentprogressid"] };

describe("studentprogress submission key down()", () => {
  it("when the unique index is all the foreign key has: puts the plain studentid index back FIRST, then drops the unique one", async () => {
    const fake = makeQI([PRIMARY, UNIQUE_INDEX]);
    await migration.down(fake.qi);
    expect(fake.calls).toEqual([
      "read indexes",
      "addIndex studentprogress (studentid) as studentid",
      `removeIndex studentprogress ${UNIQUE}`,
    ]);
    expect(fake.state.map((i) => i.name)).toEqual(["PRIMARY", "studentid"]);
    expect(fake.state.find((i) => i.name === "studentid")!.columns).toEqual(["studentid"]);
  });

  it("runs everything inside the transaction", async () => {
    const fake = makeQI([PRIMARY, UNIQUE_INDEX]);
    await migration.down(fake.qi);
    expect(fake.qi.sequelize.transaction).toHaveBeenCalledTimes(1);
    expect(fake.transactions).toHaveLength(3);
    for (const t of fake.transactions) expect(t).toBe(TX);
  });

  it("when another index already starts with studentid: only drops the unique one, adds nothing", async () => {
    const fake = makeQI([PRIMARY, UNIQUE_INDEX, { name: "studentid", columns: ["studentid"] }]);
    await migration.down(fake.qi);
    expect(fake.calls).toEqual(["read indexes", `removeIndex studentprogress ${UNIQUE}`]);
    expect(fake.state.map((i) => i.name)).toEqual(["PRIMARY", "studentid"]);
  });

  it("a composite index that starts with studentid serves the key as well", async () => {
    const fake = makeQI([PRIMARY, UNIQUE_INDEX, { name: "idx_pair", columns: ["studentid", "ispass"] }]);
    await migration.down(fake.qi);
    expect(fake.qi.addIndex).not.toHaveBeenCalled();
    expect(fake.state.map((i) => i.name)).toEqual(["PRIMARY", "idx_pair"]);
  });

  it("an index that has studentid only as a later column, or only as a prefix, does not serve the key: the plain index is added", async () => {
    for (const other of [{ name: "idx_ref", columns: ["studentprogressreferenceid", "studentid"] }, { name: "idx_pfx", columns: ["studentid"], prefix: true }]) {
      const fake = makeQI([PRIMARY, UNIQUE_INDEX, other]);
      await migration.down(fake.qi);
      expect(fake.qi.addIndex).toHaveBeenCalledTimes(1);
      expect(fake.calls.indexOf("addIndex studentprogress (studentid) as studentid")).toBeLessThan(fake.calls.indexOf(`removeIndex studentprogress ${UNIQUE}`));
    }
  });

  it("is safe to run again: with the unique index already gone it does nothing", async () => {
    const fake = makeQI([PRIMARY, { name: "studentid", columns: ["studentid"] }]);
    await migration.down(fake.qi);
    expect(fake.calls).toEqual(["read indexes"]);
    expect(fake.state.map((i) => i.name)).toEqual(["PRIMARY", "studentid"]);
  });

  it("finishes a down() that stopped after adding the plain index", async () => {
    const fake = makeQI([PRIMARY, UNIQUE_INDEX]);
    await migration.down(fake.qi);
    const again = makeQI(fake.state);
    await migration.down(again.qi);
    expect(again.calls).toEqual(["read indexes"]);
    const half = makeQI([PRIMARY, UNIQUE_INDEX, { name: "studentid", columns: ["studentid"] }]);
    await migration.down(half.qi);
    expect(half.state.map((i) => i.name)).toEqual(["PRIMARY", "studentid"]);
  });

  it("the stand-in is faithful: dropping the unique index with nothing else on studentid is refused, as MySQL does", async () => {
    const fake = makeQI([PRIMARY, UNIQUE_INDEX]);
    await expect(fake.qi.removeIndex("studentprogress", UNIQUE, { transaction: TX })).rejects.toThrow(
      "Cannot drop index 'uq_studentprogress_submission': needed in a foreign key constraint",
    );
  });
});

describe("studentprogress submission key up() is untouched", () => {
  it("adds the unique index on the natural key and never touches the plain studentid index", async () => {
    const fake = makeQI([PRIMARY]);
    const sqls: string[] = [];
    fake.qi.sequelize.query = jest.fn(async (sql: string) => {
      sqls.push(sql.replace(/\s+/g, " ").trim());
      return [[], undefined];
    });
    await migration.up(fake.qi);
    expect(sqls.map((s) => s.split(" ")[0])).toEqual(["DELETE", "DELETE"]);
    expect(fake.qi.addIndex).toHaveBeenCalledWith(
      "studentprogress",
      ["studentid", "studentprogressreferenceid", "starttime"],
      { unique: true, name: UNIQUE, transaction: TX },
    );
    expect(fake.qi.removeIndex).not.toHaveBeenCalled();
  });
});
