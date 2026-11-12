/**
 * 20261111110100-backfill-level-awards, run for real against MySQL.
 *
 * The migration's SQL runs on a real MySQL connection against plain `studentlevelsprogress`, `students`, `schools`,
 * `levels`, `grades` and `studentawards` tables the spec creates itself, and drops. They cannot be TEMPORARY tables: the
 * SQL reads `levels` twice (the level, and the live levels of its grade) and MySQL refuses a temporary table referenced
 * twice in one statement. Because the spec DROPS tables with those names, it is built so that it cannot touch a
 * database that holds anything:
 *  - it is skipped unless AWARDS_DB_SPEC=1 is set (this spec's own switch; BACKFILL_DB_SPEC belongs to the grade
 *    backfill spec, which is meant to run against shared databases and does not apply here);
 *  - it runs only when AWARDS_DB_SPEC_DATABASE names the configured database (RPI_DB_NAME) exactly; with the first
 *    switch on and the name missing or different, the suite fails with a message and does nothing else;
 *  - before anything else it asks MySQL how many tables (and views) the configured database holds, and sets
 *    `verifiedEmpty` only when the answer is 0. Every statement the spec sends that creates, drops, inserts or runs the
 *    migration goes through a guard that throws while `verifiedEmpty` is false, so a database that holds a table is
 *    left exactly as it was (the first guard failure fails the spec; nothing is dropped, not even in afterAll).
 * Point RPI_DB_NAME at a new, empty throwaway database; the spec leaves it empty.
 *
 * Ids carry no names. School A hides single-item tiers, school B does not (switch off), school C has no setting and
 * school D stores the switch as the text "true" (not the boolean, so not hidden). Grade g-one has one live level (and
 * a deleted one beside it), grade g-two has two live levels.
 */
import { Sequelize, QueryTypes } from "sequelize";
import { Config } from "src/config";
import { awardCompletedLevels } from "src/business/level-award";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261111110100-backfill-level-awards");

const TABLES = ["studentawards", "studentlevelsprogress", "students", "schools", "levels", "grades"];
const configuredName = (): string => String(Config.fortyk.api.rpi.database.name);
const switchedOn = process.env.AWARDS_DB_SPEC === "1";
const namesTheDatabase = process.env.AWARDS_DB_SPEC_DATABASE === configuredName() && configuredName() !== "";
const suite = switchedOn ? describe : describe.skip;

const LAST = "2026-03-05 10:11:12";

suite("backfill-level-awards", () => {
  let sequelize: Sequelize;
  let logged: string[];
  // True only after MySQL has said the configured database holds no table at all. Nothing is written before that.
  let verifiedEmpty = false;
  const guard = () => {
    if (!verifiedEmpty) {
      throw new Error("refusing to touch the database: it was not verified to be empty");
    }
  };
  const run = (sql: string, replacements: unknown[] = []) => {
    guard();
    return sequelize.query(sql, { replacements: replacements as never, type: QueryTypes.RAW });
  };
  const awardsOf = async () =>
    sequelize.query<{ studentid: string; levelid: string; gradeid: string; curid: string; earnedat: Date; earnedat_approximate: number; studentawardid: string }>(
      "SELECT * FROM studentawards ORDER BY studentid, levelid",
      { type: QueryTypes.SELECT },
    );
  const up = () => {
    guard();
    return migration.up({ sequelize });
  };
  const progress = (studentid: string, levelid: string, gradeid: string, completed: number | null, lastupdated: string | null = LAST) =>
    run("INSERT INTO studentlevelsprogress (studentlevelprogressid, studentid, levelid, gradeid, curid, completed, lastupdated) VALUES (UUID(), ?, ?, ?, 'c1', ?, ?)", [
      studentid,
      levelid,
      gradeid,
      completed,
      lastupdated,
    ]);

  beforeAll(async () => {
    if (!namesTheDatabase) {
      return; // verifiedEmpty stays false: every test below fails on the guard and nothing is sent
    }
    const db = Config.fortyk.api.rpi.database;
    // One connection, so every statement (the migration's transaction included) is seen on the same session.
    sequelize = new Sequelize(db.name, db.user, db.password, {
      host: db.host,
      port: db.port,
      dialect: "mysql",
      logging: false,
      pool: { max: 1, min: 1 },
    });
    // The guard query comes before anything else, and only a count of 0 for the configured database lifts the guard.
    const present = await sequelize.query<{ n: number | string }>("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?", {
      replacements: [db.name],
      type: QueryTypes.SELECT,
    });
    const current = await sequelize.query<{ d: string | null }>("SELECT DATABASE() AS d", { type: QueryTypes.SELECT });
    verifiedEmpty = Number(present[0].n) === 0 && current[0].d === db.name;
  }, 30000);
  afterAll(async () => {
    if (verifiedEmpty) {
      for (const t of TABLES) {
        await run(`DROP TABLE IF EXISTS ${t}`);
      }
    }
    if (sequelize) {
      await sequelize.close();
    }
  }, 30000);

  it("the database was named for this spec and verified to be empty", () => {
    expect({ named: namesTheDatabase, verifiedEmpty }).toEqual({ named: true, verifiedEmpty: true });
  });

  beforeEach(async () => {
    guard(); // a database that was not verified empty fails here, before a single statement
    for (const t of TABLES) {
      await run(`DROP TABLE IF EXISTS ${t}`);
    }
    await run("CREATE TABLE schools (schoolid VARCHAR(36) PRIMARY KEY, brandingconfig JSON NULL)");
    await run("CREATE TABLE students (studentid VARCHAR(36) PRIMARY KEY, schoolid VARCHAR(36) NULL)");
    await run("CREATE TABLE grades (gradeid VARCHAR(36) PRIMARY KEY, curriculumid VARCHAR(36) NOT NULL)");
    await run(
      "CREATE TABLE levels (levelid VARCHAR(36) PRIMARY KEY, gradeid VARCHAR(36) NOT NULL, levelstatus TINYINT(1) NOT NULL DEFAULT 1, isdeleted TINYINT(1) NOT NULL DEFAULT 0)",
    );
    await run(
      `CREATE TABLE studentlevelsprogress (studentlevelprogressid VARCHAR(36) PRIMARY KEY, studentid VARCHAR(36) NOT NULL,
         levelid VARCHAR(36) NOT NULL, gradeid VARCHAR(36) NOT NULL, curid VARCHAR(36) NOT NULL, completed TINYINT(1) NULL, lastupdated DATETIME NULL)`,
    );
    await run(
      `CREATE TABLE studentawards (studentawardid VARCHAR(36) PRIMARY KEY, studentid VARCHAR(36) NOT NULL, levelid VARCHAR(36) NOT NULL,
         gradeid VARCHAR(36) NOT NULL, curid VARCHAR(36) NOT NULL, earnedat DATETIME NOT NULL, earnedat_approximate TINYINT(1) NOT NULL DEFAULT 0,
         lastupdated DATETIME NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_studentawards_student_level (studentid, levelid))`,
    );
    await run(
      `INSERT INTO schools (schoolid, brandingconfig) VALUES
         ('sch-a', '{"hideSingleItemTiers": true}'), ('sch-b', '{"hideSingleItemTiers": false}'),
         ('sch-c', NULL), ('sch-d', '{"hideSingleItemTiers": "true"}')`,
    );
    await run(
      `INSERT INTO students (studentid, schoolid) VALUES ('s-a', 'sch-a'), ('s-b', 'sch-b'), ('s-c', 'sch-c'), ('s-d', 'sch-d'), ('s-none', NULL)`,
    );
    await run("INSERT INTO grades (gradeid, curriculumid) VALUES ('g-one', 'cur-one'), ('g-two', 'cur-two')");
    await run(
      `INSERT INTO levels (levelid, gradeid, levelstatus, isdeleted) VALUES
         ('lv-one', 'g-one', 1, 0), ('lv-one-gone', 'g-one', 1, 1), ('lv-two-a', 'g-two', 1, 0), ('lv-two-b', 'g-two', 1, 0)`,
    );
    logged = [];
    jest.spyOn(console, "log").mockImplementation((m: string) => void logged.push(String(m)));
  });
  afterEach(() => jest.restoreAllMocks());

  it("a. a completed row gets an approximate award dated by its lastupdated, with the level's current grade and that grade's curriculum", async () => {
    await progress("s-b", "lv-two-a", "g-two", 1);
    await up();
    const rows = await awardsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentid: "s-b", levelid: "lv-two-a", gradeid: "g-two", curid: "cur-two", earnedat_approximate: 1 });
    expect(rows[0].studentawardid).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await sequelize.query<{ same: number }>("SELECT earnedat = ? AS same FROM studentawards", { replacements: [LAST], type: QueryTypes.SELECT });
    expect(Number(stored[0].same)).toBe(1);
  });

  it("b. a row that is not completed (0 or NULL) gets nothing", async () => {
    await progress("s-b", "lv-two-a", "g-two", 0);
    await progress("s-b", "lv-two-b", "g-two", null);
    await up();
    expect(await awardsOf()).toEqual([]);
  });

  it("c. the hidden rule: one live level in a hiding school gets nothing; two live levels, a switch off, no setting, a text setting and no school all get one", async () => {
    await progress("s-a", "lv-one", "g-one", 1); // hiding school, one live level (the other is deleted): skipped
    await progress("s-a", "lv-two-a", "g-two", 1); // hiding school, two live levels: awarded
    await progress("s-b", "lv-one", "g-one", 1); // switch off: awarded
    await progress("s-c", "lv-one", "g-one", 1); // no setting: awarded
    await progress("s-d", "lv-one", "g-one", 1); // the text "true" is not the switch: awarded
    await progress("s-none", "lv-one", "g-one", 1); // no school: awarded
    await up();
    expect((await awardsOf()).map((a) => `${a.studentid}/${a.levelid}`)).toEqual([
      "s-a/lv-two-a",
      "s-b/lv-one",
      "s-c/lv-one",
      "s-d/lv-one",
      "s-none/lv-one",
    ]);
  });

  it("d. a level switched off beside the one live level makes it the only live one, as the learner app counts", async () => {
    await run("UPDATE levels SET levelstatus = 0 WHERE levelid = 'lv-two-b'");
    await progress("s-a", "lv-two-a", "g-two", 1);
    await up();
    expect(await awardsOf()).toEqual([]);
  });

  it("e. a pair that already has an award is left untouched, even with a different date", async () => {
    await run(
      "INSERT INTO studentawards (studentawardid, studentid, levelid, gradeid, curid, earnedat, earnedat_approximate) VALUES ('keep-me', 's-b', 'lv-two-a', 'g-two', 'c1', '2026-01-02 03:04:05', 0)",
    );
    await progress("s-b", "lv-two-a", "g-two", 1);
    await up();
    const rows = await awardsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentawardid: "keep-me", earnedat_approximate: 0 });
  });

  it("f. a second run inserts nothing, and several progress rows of one pair give one award, the earliest date", async () => {
    await progress("s-b", "lv-two-a", "g-two", 1, "2026-03-09 00:00:00");
    await progress("s-b", "lv-two-a", "g-two", 1, "2026-03-05 00:00:00");
    await progress("s-c", "lv-two-b", "g-two", 1);
    await up();
    const first = await awardsOf();
    expect(first).toHaveLength(2);
    expect(logged.join("\n")).toContain("2 award(s) made");
    logged.length = 0;
    await up();
    expect(logged.join("\n")).toContain("0 award(s) made");
    expect(logged.join("\n")).toContain("2 already had an award");
    expect(await awardsOf()).toEqual(first);
    const dates = await sequelize.query<{ d: string }>("SELECT DATE_FORMAT(earnedat, '%Y-%m-%d') AS d FROM studentawards WHERE studentid = 's-b'", { type: QueryTypes.SELECT });
    expect(dates[0].d).toBe("2026-03-05");
  });

  it("g. logs counts only: awarded, skipped as hidden, already had one", async () => {
    await progress("s-a", "lv-one", "g-one", 1);
    await progress("s-b", "lv-two-a", "g-two", 1);
    await run(
      "INSERT INTO studentawards (studentawardid, studentid, levelid, gradeid, curid, earnedat) VALUES ('x', 's-c', 'lv-one', 'g-one', 'c1', '2026-01-01')",
    );
    await progress("s-c", "lv-one", "g-one", 1);
    await up();
    expect(logged).toEqual(["backfill-level-awards: 1 award(s) made; 1 level(s) skipped (single-item tier hidden); 1 already had an award"]);
  });

  it("h. a level moved to another grade after completion is judged, and stored, by its current grade", async () => {
    // the progress row says g-one (one live level: would be hidden for school A); the level now sits in g-two (three live levels)
    await run("UPDATE levels SET gradeid = 'g-two' WHERE levelid = 'lv-one'");
    await progress("s-a", "lv-one", "g-one", 1);
    // the other way: the row says g-two (several live levels); the level now sits alone in a grade of its own
    await run("INSERT INTO grades (gradeid, curriculumid) VALUES ('g-three', 'cur-three')");
    await run("UPDATE levels SET gradeid = 'g-three' WHERE levelid = 'lv-two-a'");
    await progress("s-a", "lv-two-a", "g-two", 1);
    await up();
    const rows = await awardsOf();
    expect(rows.map((a) => [a.studentid, a.levelid, a.gradeid, a.curid])).toEqual([["s-a", "lv-one", "g-two", "cur-two"]]);
  });

  describe("the roster import's scoped copy (awardCompletedLevels)", () => {
    const scoped = (ids: string[] | null) => {
      guard();
      return sequelize.transaction((transaction) => awardCompletedLevels(ids, transaction, sequelize));
    };

    it("f. awards approximate rows only to the named learners, by the same rule, and a second call inserts nothing", async () => {
      await progress("s-b", "lv-two-a", "g-two", 1); // imported: awarded
      await progress("s-c", "lv-two-b", "g-two", 1); // not imported: untouched
      await progress("s-a", "lv-one", "g-one", 1); // imported, hidden: none
      await progress("s-b", "lv-one", "g-one", 0); // imported, not complete: none
      expect(await scoped(["s-a", "s-b"])).toBe(1);
      const rows = await awardsOf();
      expect(rows.map((a) => [a.studentid, a.levelid, a.curid, a.earnedat_approximate])).toEqual([["s-b", "lv-two-a", "cur-two", 1]]);
      const stored = await sequelize.query<{ same: number }>("SELECT earnedat = ? AS same FROM studentawards", { replacements: [LAST], type: QueryTypes.SELECT });
      expect(Number(stored[0].same)).toBe(1);
      expect(await scoped(["s-a", "s-b"])).toBe(0);
      expect(await scoped([])).toBe(0);
      expect((await awardsOf()).length).toBe(1);
    });

    it("f. an award already on this server for the pair is not overwritten", async () => {
      await run("INSERT INTO studentawards (studentawardid, studentid, levelid, gradeid, curid, earnedat, earnedat_approximate) VALUES ('keep-me', 's-b', 'lv-two-a', 'g-two', 'c1', '2026-01-02 03:04:05', 0)");
      await progress("s-b", "lv-two-a", "g-two", 1);
      expect(await scoped(["s-b"])).toBe(0);
      expect((await awardsOf())[0]).toMatchObject({ studentawardid: "keep-me", earnedat_approximate: 0 });
    });
  });

  it("down does nothing and says so", async () => {
    await progress("s-b", "lv-two-a", "g-two", 1);
    await up();
    await migration.down();
    expect(await awardsOf()).toHaveLength(1);
    expect(logged.join("\n")).toContain("down does nothing");
  });
});
