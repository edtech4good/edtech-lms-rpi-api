/**
 * 20261111100000-backfill-learner-grade, run for real against MySQL.
 *
 * The migration's SQL runs on a real MySQL connection, against TEMPORARY `students` and `grades` tables the spec
 * creates on that one connection. A temporary table shadows the real one, so nothing in the configured database is
 * read or written, and the spec cleans up by closing the connection. It runs ONLY when BACKFILL_DB_SPEC=1 is set
 * (it needs a reachable MySQL); otherwise it is skipped.
 *
 * Learner ids carry no names. One grade is a live grade, one curriculum has two, one has only a deleted grade.
 */
import { Sequelize, QueryTypes } from "sequelize";
import { Config } from "src/config";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261111100000-backfill-learner-grade");

const suite = process.env.BACKFILL_DB_SPEC === "1" ? describe : describe.skip;

const CUR_ONE = "cur-one";
const CUR_TWO = "cur-two";
const CUR_DELETED = "cur-deleted";
const CUR_NONE = "cur-none";

suite("backfill-learner-grade", () => {
  let sequelize: Sequelize;
  let logged: string[];
  const run = (sql: string, replacements: unknown[] = []) =>
    sequelize.query(sql, { replacements: replacements as never, type: QueryTypes.RAW });
  const gradeOf = async (studentid: string): Promise<string | null> => {
    const rows = await sequelize.query<{ gradeid: string | null }>("SELECT gradeid FROM students WHERE studentid = ?", {
      replacements: [studentid],
      type: QueryTypes.SELECT,
    });
    return rows[0].gradeid;
  };
  const up = () => migration.up({ sequelize });

  beforeAll(async () => {
    const db = Config.fortyk.api.rpi.database;
    // One connection, so the temporary tables are seen by every statement, the migration's transaction included.
    sequelize = new Sequelize(db.name, db.user, db.password, {
      host: db.host,
      port: db.port,
      dialect: "mysql",
      logging: false,
      pool: { max: 1, min: 1 },
    });
  });
  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await run("DROP TEMPORARY TABLE IF EXISTS students");
    await run("DROP TEMPORARY TABLE IF EXISTS grades");
    await run(
      "CREATE TEMPORARY TABLE grades (gradeid VARCHAR(36) PRIMARY KEY, curriculumid VARCHAR(36) NOT NULL, isdeleted TINYINT(1) NOT NULL DEFAULT 0)",
    );
    await run(
      `CREATE TEMPORARY TABLE students (studentid VARCHAR(36) PRIMARY KEY, curriculumid VARCHAR(36) NULL, gradeid VARCHAR(36) NULL,
         is_teacher_acc TINYINT(1) NOT NULL DEFAULT 0, note VARCHAR(20) NOT NULL DEFAULT 'untouched')`,
    );
    await run(
      `INSERT INTO grades (gradeid, curriculumid, isdeleted) VALUES
         ('g-one', '${CUR_ONE}', 0), ('g-one-old', '${CUR_ONE}', 1),
         ('g-two-a', '${CUR_TWO}', 0), ('g-two-b', '${CUR_TWO}', 0),
         ('g-gone', '${CUR_DELETED}', 1)`,
    );
    logged = [];
    jest.spyOn(console, "log").mockImplementation((m: string) => void logged.push(String(m)));
  });
  afterEach(() => jest.restoreAllMocks());

  const addLearner = (id: string, curriculumid: string | null, gradeid: string | null, teacher = 0) =>
    run("INSERT INTO students (studentid, curriculumid, gradeid, is_teacher_acc) VALUES (?, ?, ?, ?)", [id, curriculumid, gradeid, teacher]);

  it("a. sets the grade of a learner whose curriculum has exactly one live grade (a deleted one beside it is ignored)", async () => {
    await addLearner("s-a", CUR_ONE, null);
    await up();
    expect(await gradeOf("s-a")).toBe("g-one");
  });

  it("a2. gives a teacher account with no grade the grade too (no filter on role)", async () => {
    await addLearner("s-teacher", CUR_ONE, null, 1);
    await up();
    expect(await gradeOf("s-teacher")).toBe("g-one");
  });

  it("b. leaves a learner whose curriculum has two live grades without one", async () => {
    await addLearner("s-b", CUR_TWO, null);
    await up();
    expect(await gradeOf("s-b")).toBeNull();
  });

  it("c. leaves a learner whose curriculum's only grade is deleted, or that has none, without one", async () => {
    await addLearner("s-c1", CUR_DELETED, null);
    await addLearner("s-c2", CUR_NONE, null);
    await up();
    expect(await gradeOf("s-c1")).toBeNull();
    expect(await gradeOf("s-c2")).toBeNull();
  });

  it("d. never changes a learner whose grade is already set, even to a grade of another curriculum", async () => {
    await addLearner("s-d1", CUR_ONE, "g-two-a");
    await addLearner("s-d2", CUR_ONE, "g-one");
    await up();
    expect(await gradeOf("s-d1")).toBe("g-two-a");
    expect(await gradeOf("s-d2")).toBe("g-one");
  });

  it("e. leaves a learner with no curriculum alone", async () => {
    await addLearner("s-e", null, null);
    await up();
    expect(await gradeOf("s-e")).toBeNull();
  });

  it("f. a second run updates nothing, and no other column is written", async () => {
    await addLearner("s-f1", CUR_ONE, null);
    await addLearner("s-f2", CUR_TWO, null);
    await up();
    expect(logged.join("\n")).toContain("1 learner(s) given");
    logged.length = 0;
    await up();
    expect(logged.join("\n")).toContain("0 learner(s) given");
    expect(await gradeOf("s-f1")).toBe("g-one");
    expect(await gradeOf("s-f2")).toBeNull();
    const rows = await sequelize.query("SELECT studentid, curriculumid, is_teacher_acc, note FROM students ORDER BY studentid", {
      type: QueryTypes.SELECT,
    });
    expect(rows).toEqual([
      { studentid: "s-f1", curriculumid: CUR_ONE, is_teacher_acc: 0, note: "untouched" },
      { studentid: "s-f2", curriculumid: CUR_TWO, is_teacher_acc: 0, note: "untouched" },
    ]);
  });

  it("logs counts only: updated, no live grade, several live grades", async () => {
    await addLearner("s-1", CUR_ONE, null);
    await addLearner("s-2", CUR_TWO, null);
    await addLearner("s-3", CUR_TWO, null);
    await addLearner("s-4", CUR_DELETED, null);
    await up();
    expect(logged).toEqual([
      "backfill-learner-grade: 1 learner(s) given their curriculum's only grade; " +
        "1 left without a grade (curriculum has no live grade); 2 left without a grade (curriculum has several live grades)",
    ]);
  });

  it("down does nothing and says so", async () => {
    await addLearner("s-g", CUR_ONE, null);
    await migration.down();
    expect(await gradeOf("s-g")).toBeNull();
    expect(logged.join("\n")).toContain("down does nothing");
  });
});
