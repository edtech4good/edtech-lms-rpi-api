/**
 * The baseline for the four tables that only the boot-time `sequelize.sync()` used to create.
 * Drives up()/down() against a fake QueryInterface: it proves what the migration ASKS MySQL for
 * (and that on a database that has the tables it asks for nothing). That the DDL equals what
 * `sync()` builds, and that a fresh database migrates end to end, were run on real MySQL copies
 * (see the change description); this spec pins the DDL so a column cannot go missing quietly.
 */
// A module (not a script), so the helpers below are not shared with the other migration specs.
export {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20260818080000-create-sync-only-tables-baseline");

const TX = { id: "the-transaction" };
const TABLES = ["studentprogressquestions", "lessonpracticequestions", "lessonquizquestions", "tokens"];
const PARENTS = ["studentprogress", "lessonpractices", "lessonquizzes", "questions", "curriculums"];

type State = {
  /** Tables that already exist (the parents are always there). */
  tables?: string[];
  /** `table.column` -> collation, for the parent columns. Anything not listed is utf8mb4_unicode_ci. */
  collations?: Record<string, string>;
  /** Rows per table, for down(). */
  rows?: Record<string, number>;
};

const makeQI = (state: State = {}) => {
  const tables = new Set([...PARENTS, ...(state.tables ?? [])]);
  const qi = {
    showAllTables: jest.fn(() => Promise.resolve([...tables])),
    dropTable: jest.fn((name: string, _opts?: unknown) => {
      tables.delete(name);
      return Promise.resolve();
    }),
    sequelize: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: jest.fn((sql: string, opts?: any): Promise<unknown> => {
        if (/^SELECT 1 AS present FROM/.test(sql)) {
          // down()'s existence probe: a row back means the table holds data.
          const name = /FROM `(\w+)`/.exec(sql)![1];
          return Promise.resolve([(state.rows?.[name] ?? 0) > 0 ? [{ present: 1 }] : []]);
        }
        if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
          // tableOptionsMatchingCurriculums names curriculums.curriculumid in the SQL; the others pass replacements.
          const [table, column] = (opts?.replacements as [string, string] | undefined) ?? ["curriculums", "curriculumid"];
          const coll = state.collations?.[`${table}.${column}`] ?? "utf8mb4_unicode_ci";
          return Promise.resolve([[{ cs: "utf8mb4", coll }]]);
        }
        const created = /^\s*CREATE TABLE IF NOT EXISTS `(\w+)`/.exec(sql);
        if (created) {
          tables.add(created[1]);
        }
        return Promise.resolve([[]]);
      }),
      transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
    },
  };
  return { qi, tables };
};

const creates = (qi: ReturnType<typeof makeQI>["qi"]): string[] =>
  qi.sequelize.query.mock.calls.map((c) => c[0] as string).filter((q) => /CREATE TABLE/.test(q));

const ddlOf = (qi: ReturnType<typeof makeQI>["qi"], table: string): string => {
  const found = creates(qi).find((q) => q.includes(`\`${table}\` (`));
  if (!found) {
    throw new Error(`no CREATE for ${table}`);
  }
  return found;
};

/** The column lines and the constraint lines of a CREATE, trimmed. */
const lines = (ddl: string): string[] =>
  ddl
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .filter((l) => l.startsWith("`") || l.startsWith("PRIMARY") || l.startsWith("FOREIGN"));

describe("up() on a database without the tables", () => {
  it("creates exactly the four tables, each once, in the transaction", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    expect(creates(qi)).toHaveLength(4);
    for (const t of TABLES) {
      expect(ddlOf(qi, t)).toMatch(/^\s*CREATE TABLE IF NOT EXISTS/);
    }
    for (const call of qi.sequelize.query.mock.calls.filter((c) => /CREATE TABLE/.test(c[0]))) {
      expect(call[1]).toEqual({ transaction: TX });
    }
  });

  it("builds studentprogressquestions as sync() does (columns, NULL-ness, defaults, key, foreign key)", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    expect(lines(ddlOf(qi, "studentprogressquestions"))).toEqual([
      "`studentprogressid` VARCHAR(36) NOT NULL",
      "`studentprogressquestionid` VARCHAR(36) NOT NULL",
      "`tries` INT NULL DEFAULT 0",
      "`iscorrect` TINYINT(1) NOT NULL DEFAULT 0",
      "`referencequestionid` VARCHAR(36) NOT NULL",
      "`answer` JSON NULL DEFAULT NULL",
      "`clientiscorrect` TINYINT(1) NULL DEFAULT NULL",
      "`servergrade` ENUM('correct','incorrect','ungradable') NULL DEFAULT NULL",
      "PRIMARY KEY (`studentprogressquestionid`)",
      "FOREIGN KEY (`studentprogressid`) REFERENCES `studentprogress` (`studentprogressid`) ON UPDATE CASCADE",
    ]);
  });

  it("builds lessonpracticequestions as sync() does", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    expect(lines(ddlOf(qi, "lessonpracticequestions"))).toEqual([
      "`lessonpracticequestionid` VARCHAR(36) NOT NULL",
      "`lessonpracticeid` VARCHAR(36) NOT NULL",
      "`lessonpracticequestionstatus` TINYINT(1) NOT NULL DEFAULT 1",
      "`questionid` VARCHAR(36) NOT NULL",
      "`lessonpracticequestionorder` INT NOT NULL",
      "PRIMARY KEY (`lessonpracticequestionid`)",
      "FOREIGN KEY (`lessonpracticeid`) REFERENCES `lessonpractices` (`lessonpracticeid`) ON UPDATE CASCADE",
      "FOREIGN KEY (`questionid`) REFERENCES `questions` (`questionid`) ON UPDATE CASCADE",
    ]);
  });

  it("builds lessonquizquestions as sync() does", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    expect(lines(ddlOf(qi, "lessonquizquestions"))).toEqual([
      "`lessonquizquestionid` VARCHAR(36) NOT NULL",
      "`lessonquizid` VARCHAR(36) NOT NULL",
      "`questionid` VARCHAR(36) NOT NULL",
      "`lessonquizquestionstatus` TINYINT(1) NOT NULL DEFAULT 1",
      "`lessonquizquestionorder` INT NOT NULL",
      "PRIMARY KEY (`lessonquizquestionid`)",
      "FOREIGN KEY (`lessonquizid`) REFERENCES `lessonquizzes` (`lessonquizid`) ON UPDATE CASCADE",
      "FOREIGN KEY (`questionid`) REFERENCES `questions` (`questionid`) ON UPDATE CASCADE",
    ]);
  });

  it("builds tokens as sync() does (no foreign key)", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    expect(lines(ddlOf(qi, "tokens"))).toEqual([
      "`token` VARCHAR(500) NOT NULL",
      "`lmsuserid` VARCHAR(36) NOT NULL",
      "`tokentype` VARCHAR(8) NOT NULL",
      "PRIMARY KEY (`token`)",
    ]);
  });

  it("gives every table the InnoDB engine and the charset and collation of its parent column", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    for (const t of TABLES) {
      expect(ddlOf(qi, t)).toMatch(/\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci\s*$/);
    }
  });

  it("running twice creates each table once", async () => {
    const { qi } = makeQI();
    await migration.up(qi);
    await migration.up(qi);
    expect(creates(qi)).toHaveLength(4);
  });
});

describe("up() on a database that already has the tables (every existing server)", () => {
  it("asks for nothing at all: no CREATE, no ALTER, no read of the tables", async () => {
    const { qi } = makeQI({ tables: TABLES });
    await migration.up(qi);
    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(qi.dropTable).not.toHaveBeenCalled();
  });

  it("creates only the table that is missing when one is absent", async () => {
    const { qi } = makeQI({ tables: ["studentprogressquestions", "tokens", "lessonquizquestions"] });
    await migration.up(qi);
    expect(creates(qi)).toHaveLength(1);
    expect(ddlOf(qi, "lessonpracticequestions")).toMatch(/CREATE TABLE IF NOT EXISTS `lessonpracticequestions`/);
  });
});

describe("up(): collation", () => {
  it("leaves a foreign-key column undeclared when its parent has the table's collation", async () => {
    const { qi } = makeQI({ collations: { "questions.questionid": "utf8mb4_unicode_ci", "lessonquizzes.lessonquizid": "utf8mb4_unicode_ci" } });
    await migration.up(qi);
    expect(ddlOf(qi, "lessonquizquestions")).not.toMatch(/CHARACTER SET/);
  });

  it("takes the table's charset and collation from the first parent and each key column's from its own parent", async () => {
    const { qi } = makeQI({
      collations: { "lessonquizzes.lessonquizid": "utf8mb4_0900_ai_ci", "questions.questionid": "utf8mb4_unicode_ci" },
    });
    await migration.up(qi);
    const ddl = ddlOf(qi, "lessonquizquestions");
    expect(ddl).toMatch(/COLLATE=utf8mb4_0900_ai_ci\s*$/);
    expect(lines(ddl)).toContain("`questionid` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL");
    expect(lines(ddl)).toContain("`lessonquizid` VARCHAR(36) NOT NULL");
    const read = qi.sequelize.query.mock.calls.filter((c) => /INFORMATION_SCHEMA/.test(c[0]) && c[1]).map((c) => c[1].replacements);
    expect(read).toEqual(expect.arrayContaining([["lessonquizzes", "lessonquizid"], ["questions", "questionid"], ["studentprogress", "studentprogressid"]]));
  });

  it("refuses a collation name that is not a plain identifier, before creating anything", async () => {
    const { qi } = makeQI({ collations: { "studentprogress.studentprogressid": "x'; DROP TABLE y; --" } });
    await expect(migration.up(qi)).rejects.toThrow(/Unexpected collation/);
    expect(creates(qi)).toEqual([]);
  });
});

describe("down()", () => {
  it("drops a table only when it is empty, and leaves one that holds rows", async () => {
    const { qi, tables } = makeQI({ tables: TABLES, rows: { studentprogressquestions: 62, tokens: 11 } });
    await migration.down(qi);
    expect(qi.dropTable.mock.calls.map((c) => c[0]).sort()).toEqual(["lessonpracticequestions", "lessonquizquestions"]);
    expect(qi.dropTable.mock.calls.every((c) => (c[1] as { transaction: unknown } | undefined)?.transaction === TX)).toBe(true);
    expect(tables.has("studentprogressquestions")).toBe(true);
    expect(tables.has("tokens")).toBe(true);
  });

  it("never drops a table that holds learners' results, however many rows", async () => {
    const { qi } = makeQI({ tables: TABLES, rows: { studentprogressquestions: 1, lessonpracticequestions: 1, lessonquizquestions: 1, tokens: 1 } });
    await migration.down(qi);
    expect(qi.dropTable).not.toHaveBeenCalled();
  });

  it("is a no-op when the tables are already gone, and never touches anything else", async () => {
    const { qi } = makeQI();
    await migration.down(qi);
    expect(qi.dropTable).not.toHaveBeenCalled();
    const full = makeQI({ tables: [...TABLES, "students", "organisations"] });
    await migration.down(full.qi);
    expect(full.qi.dropTable.mock.calls.map((c) => c[0]).sort()).toEqual([...TABLES].sort());
  });
});
