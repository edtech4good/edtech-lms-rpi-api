import { Sequelize } from "sequelize";
import { SchoolUserBusiness } from "src/business/schooluser.business";
import { StudentBusiness } from "src/business/student.business";
import { dbinstance } from "src/services/dbservice";
import { curriculums, documents, initModels, organisations, questions, schoolusers, setuprelationshipforreport, students } from "./init-models";
import { schools } from "./school";
import { subjects } from "./subjects";

/**
 * Organisations package, step 5a: the new ownership columns (`organisationid`
 * on schools, curriculums, questions, documents and subjects; `schoolid` on
 * students and schoolusers) exist and are typed, but nothing that leaves this
 * API may gain them yet. Every route, export and report that returns these
 * models' rows must be byte for byte what it was; if a route needs the columns
 * later, that is a later step's decision, made on purpose.
 *
 * The guarantee is each model's `defaultScope`, plus one raw query that selects
 * `students.*`. This proves the SQL Sequelize actually generates (no database:
 * `sequelize.query` is intercepted before it would touch a socket, as in
 * studentprogressquestions.scope.spec.ts), including through includes and the
 * real business classes the exports use, and the raw query's output.
 */

type Owned = { name: string; column: "organisationid" | "schoolid" };
const OWNED: Owned[] = [
  { name: "schools", column: "organisationid" },
  { name: "curriculums", column: "organisationid" },
  { name: "questions", column: "organisationid" },
  { name: "documents", column: "organisationid" },
  { name: "subjects", column: "organisationid" },
  { name: "students", column: "schoolid" },
  { name: "schoolusers", column: "schoolid" },
];

describe("ownership columns stay out of everything that leaves the API (step 5a)", () => {
  let sequelize: Sequelize;
  let querySpy: jest.SpyInstance;
  // The classes are module-level singletons that initModels(sequelize) re-binds on each call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = (): Record<string, any> => ({ schools, curriculums, questions, documents, subjects, students, schoolusers, organisations });

  beforeEach(() => {
    sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
    initModels(sequelize);
    setuprelationshipforreport(sequelize);
    querySpy = jest.spyOn(sequelize, "query").mockImplementation((sql: unknown) => {
      throw new Error(`__captured_sql__${String(sql)}`);
    });
  });

  afterEach(async () => {
    querySpy.mockRestore();
    await sequelize.close();
  });

  const sqlThrown = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const match = message.match(/^__captured_sql__([\s\S]*)$/);
      if (match) return match[1];
      throw e;
    }
    throw new Error("the call under test did not reach sequelize.query");
  };

  /** The column list of a SELECT: everything before the first FROM. */
  const selectList = (sql: string) => sql.slice(0, sql.search(/\sFROM\s/i));
  const mentions = (text: string, column: string) => new RegExp(`\\b${column}\\b`).test(text);

  it.each(OWNED)("$name: findAll({}) never selects $column", async ({ name, column }) => {
    const sql = await sqlThrown(() => models()[name].findAll({}));
    expect(mentions(selectList(sql), column)).toBe(false);
    expect(mentions(sql, column)).toBe(false);
  });

  it.each(OWNED)("$name: findOne never selects $column", async ({ name, column }) => {
    const sql = await sqlThrown(() => models()[name].findOne({ where: { [`${name}`.slice(0, -1) + "id"]: "x" } }));
    expect(mentions(selectList(sql), column)).toBe(false);
  });

  it.each(OWNED)("$name: scope('withOwnership').findAll DOES select $column", async ({ name, column }) => {
    const sql = await sqlThrown(() => models()[name].scope("withOwnership").findAll({}));
    expect(mentions(selectList(sql), column)).toBe(true);
  });

  it.each(OWNED)("$name: can still be filtered BY $column without selecting it", async ({ name, column }) => {
    const sql = await sqlThrown(() => models()[name].findAll({ where: { [column]: "some-id" } }));
    expect(mentions(selectList(sql), column)).toBe(false);
    expect(sql).toMatch(new RegExp(`WHERE .*\`${column}\` = 'some-id'`));
  });

  it("a school included under a learner does not select organisationid, and the default join is on the school's id (step 5b)", async () => {
    const { students, schools } = models();
    const sql = await sqlThrown(() => students.findAll({ include: [{ model: schools }] }));
    expect(mentions(selectList(sql), "organisationid")).toBe(false);
    expect(mentions(selectList(sql), "schoolid")).toBe(true); // schools' own primary key, as before
    expect(sql).toMatch(/ON `students`\.`schoolid` = `school`\.`schoolid`/);
    expect(sql).not.toMatch(/`schoolname` = `school`\.`schoolname`/);
    // the learner's own schoolid is used by the join but not selected
    expect(selectList(sql)).not.toMatch(/`students`\.`schoolid`/);
  });

  it("the new by-id associations exist alongside it, join on schoolid, and select neither ownership column", async () => {
    const { students, schoolusers, schools } = models();
    const learnerSql = await sqlThrown(() => students.findAll({ include: [{ model: schools, as: "schoolbyid" }] }));
    expect(learnerSql).toMatch(/ON `students`\.`schoolid` = `schoolbyid`\.`schoolid`/);
    expect(mentions(selectList(learnerSql), "organisationid")).toBe(false);
    const loginSql = await sqlThrown(() => schoolusers.findAll({ include: [{ model: schools, as: "schoolbyid" }] }));
    expect(loginSql).toMatch(/ON `schoolusers`\.`schoolid` = `schoolbyid`\.`schoolid`/);
    // and a school reaches its organisation
    const { organisations } = models();
    const schoolSql = await sqlThrown(() => schools.findAll({ include: [{ model: organisations, as: "organisation" }] }));
    expect(schoolSql).toMatch(/ON `schools`\.`organisationid` = `organisation`\.`organisationid`/);
    // the school's OWN organisationid is not selected (the joined organisation's id, a different column, is)
    expect(selectList(schoolSql)).not.toMatch(/`schools`\.`organisationid`/);
  });

  it("the school-login export (what GET export/report-data sends central) selects neither schoolid column", async () => {
    // SyncReport.getreportdata maps SchoolUserBusiness.getschoolusers() rows with get({ plain: true }).
    const sql = await sqlThrown(() => new SchoolUserBusiness().getschoolusers());
    expect(mentions(sql, "schoolid")).toBe(false);
    expect(mentions(sql, "organisationid")).toBe(false);
  });

  it("a learner's included school login selects no schoolid", async () => {
    const { students, schoolusers } = models();
    const sql = await sqlThrown(() =>
      students.findAll({ include: [{ model: schoolusers, as: "schooluser", attributes: ["schoolusername"] }] }),
    );
    expect(mentions(sql, "schoolid")).toBe(false);
  });

  it("the roster list a teacher sees selects no schoolid (it filters by it)", async () => {
    const sql = await sqlThrown(() => new StudentBusiness().getStudentsWithFilter("demo", undefined, "5c000000-0000-4000-8000-0000000000a1"));
    expect(mentions(selectList(sql), "schoolid")).toBe(false);
    expect(sql).toMatch(/`students`\.`schoolid` = '5c000000-0000-4000-8000-0000000000a1'/);
  });

  describe("the one raw query that selects students.* (teacher student stats)", () => {
    afterEach(() => jest.restoreAllMocks());

    it("drops schoolid from the row and keeps everything else exactly as it was", async () => {
      const row = {
        studentid: "s1",
        studentfirstname: "A",
        schoolname: "Demo",
        schoolid: "5c000000-0000-4000-8000-0000000000a1",
        lastlogin: "2026-01-01",
        currentlessonname: "L1",
        currentgradeid: "g1",
      };
      jest.spyOn(dbinstance.getdbinstance(), "query").mockResolvedValue([row] as never);
      const rows = (await new StudentBusiness().getstudentstats("s1")) as Array<Record<string, unknown>>;
      expect(rows).toEqual([
        {
          studentid: "s1",
          studentfirstname: "A",
          schoolname: "Demo",
          lastlogin: "2026-01-01",
          currentlessonname: "L1",
          currentgradeid: "g1",
        },
      ]);
      expect(rows[0]).not.toHaveProperty("schoolid");
      expect(JSON.stringify(rows)).not.toContain("5c000000");
    });

    it("returns an empty list unchanged", async () => {
      jest.spyOn(dbinstance.getdbinstance(), "query").mockResolvedValue([] as never);
      await expect(new StudentBusiness().getstudentstats("s1")).resolves.toEqual([]);
    });
  });

  it("writes are unaffected: an insert still names the new column (it is a column, just never selected)", async () => {
    const { students } = models();
    const sql = await sqlThrown(() =>
      students.bulkCreate([{ studentid: "s1", schoolid: "5c000000-0000-4000-8000-0000000000a1" }], { validate: false }),
    );
    expect(sql).toMatch(/INSERT INTO `students`/);
    expect(mentions(sql, "schoolid")).toBe(true);
  });
});
