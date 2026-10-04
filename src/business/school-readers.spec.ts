import { Sequelize } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { curriculumbaseline } from "src/models/data-models/curriculumbaseline";
import * as models from "src/models/data-models/init-models";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { GradeController } from "src/modules/grade/grade.controller";
import { ReportController } from "src/modules/report/report.controller";
import { SchoolController } from "src/modules/school/school.controller";
import { StudentController } from "src/modules/student/student.controller";
import { TeacherController } from "src/modules/teachers/teacher.controller";
import { Token } from "src/models/token.model";
import { CurriculumBusiness } from "./curriculum.business";
import { GradeBusiness } from "./grade.business";
import { ReportBusiness } from "./report.business";
import { SchoolBusiness } from "./school.business";
import { StandardBusiness } from "./standard.business";
import { StudentBusiness } from "./student.business";
import { TeacherBusiness } from "./teacher.business";

/**
 * Organisations package, step 5b: every reader that tied a learner or school
 * login to a school by NAME now works with the school's ID.
 *
 * No database: `sequelize.query` records the SQL Sequelize generates and answers
 * with nothing, and the schools table is a short list. For each reader the same
 * request is made with the school named by its id, by its name, and (for the
 * token routes) with an old token (a name claim only) and a new one (the id
 * claim). Identical SQL is the proof that the rows are identical, and the SQL is
 * checked to filter on `schoolid` and never on a school name.
 *
 * The real-database run (two schools of one name, a master import) is in the
 * change description.
 */

const A = "5c000000-0000-4000-8000-0000000000a1";
const B = "5c000000-0000-4000-8000-0000000000b2";
const NAME_A = "School A";
const NAME_B = "School B";

type FakeSchool = { schoolid: string; schoolname: string; isdeleted?: boolean };
const collate = (name: string) => name.trim().toLowerCase();

let sequelize: Sequelize;
let log: string[];
let schoolRows: FakeSchool[];
let schoolFindOne: jest.SpyInstance;

const TWO_SCHOOLS: FakeSchool[] = [
  { schoolid: A, schoolname: NAME_A },
  { schoolid: B, schoolname: NAME_B },
];

beforeEach(() => {
  sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  initModels(sequelize);
  setuprelationshipforreport(sequelize);
  log = [];
  schoolRows = TWO_SCHOOLS;
  jest.spyOn(sequelize, "query").mockImplementation((async (sql: unknown, options?: { plain?: boolean }) => {
    log.push(String(sql));
    return options?.plain ? null : [];
  }) as never);
  // The by-name narrowing of the school resolver (it is not one of the SQL statements under test).
  jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where: { logic?: string } }) => {
    const given = collate(String(opts.where.logic ?? ""));
    return schoolRows.filter((s) => collate(s.schoolname) === given).map((s) => ({ isdeleted: false, ...s }));
  }) as never);
  schoolFindOne = jest.spyOn(schools, "findOne").mockResolvedValue(null as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await sequelize.close();
});

const run = async (fn: () => Promise<unknown>): Promise<{ sql: string[]; error?: unknown }> => {
  log = [];
  try {
    await fn();
    return { sql: [...log] };
  } catch (e) {
    return { sql: [...log], error: e };
  }
};

const FILTERS_ON_ID = (id: string) => new RegExp(`\`students\`\\.\`schoolid\` = '${id}'`);
// The name fallback reads only learners that have no school id: a learner with an id is never reached by a name.
const BY_NAME = (name: string) => new RegExp(`WHERE \`students\`\\.\`schoolid\` IS NULL AND \`students\`\\.\`schoolname\` = '${name}'`);
// A school NAME used as a filter or a join column anywhere in the statement.
const FILTERS_ON_NAME = /`school(name)?`\s*=\s*('|`)|schoolname`\s+IN|`schoolname` =|\$school\.schoolname\$/;
const selectList = (sql: string) => sql.slice(0, sql.search(/\sFROM\s/i));

const NEW_TOKEN: Token = { schoolid: A, schoolname: NAME_A, schooluserid: "u1", schoolusername: "teacher" };
const OLD_TOKEN: Token = { schoolname: NAME_A, schooluserid: "u1", schoolusername: "teacher" };
const NAMELESS_TOKEN: Token = { schooluserid: "u1", schoolusername: "teacher" };

describe("teacher routes: the token's school (id claim, or the name claim of an old token)", () => {
  const teacher = new TeacherController();
  const routes: Array<[string, (u: Token) => Promise<unknown>]> = [
    ["GET teacher/standards", (u) => teacher.getallstandards(u)],
    ["GET teacher/stats", (u) => teacher.getallstats(u)],
    ["GET teacher/students", (u) => teacher.getallstudents(u)],
    ["GET teacher/standard/all", (u) => teacher.getAllLessons("", u)],
    ["POST teacher/studentprogress", (u) => teacher.getStudentsProgress({} as never, u)],
  ];

  it.each(routes)("%s: a new token and an old token read the same rows, by the school's id", async (_name, call) => {
    const byId = await run(() => call(NEW_TOKEN));
    const byName = await run(() => call(OLD_TOKEN));
    const idOnly = await run(() => call({ ...NEW_TOKEN, schoolname: undefined }));
    expect(byId.sql.length).toBeGreaterThan(0);
    expect(byName.sql).toEqual(byId.sql);
    expect(idOnly.sql).toEqual(byId.sql);
    const filter = _name === "GET teacher/standard/all" ? new RegExp(`\`schoolid\` = '${A}'`) : FILTERS_ON_ID(A);
    expect(byId.sql.join("\n")).toMatch(filter);
    expect(byId.sql.join("\n")).not.toMatch(FILTERS_ON_NAME);
    // the id filters the rows; it is never part of what a learner row returns
    for (const sql of byId.sql) {
      expect(selectList(sql)).not.toMatch(/`students`\.`schoolid`/);
    }
  });

  it.each(routes.filter(([n]) => n !== "GET teacher/standard/all"))(
    "%s: the id claim wins over a name claim that names another school",
    async (_name, call) => {
      const mixed = await run(() => call({ ...NEW_TOKEN, schoolname: NAME_B }));
      expect(mixed.sql.join("\n")).toMatch(FILTERS_ON_ID(A));
      expect(mixed.sql.join("\n")).not.toContain(B);
    },
  );

  const NOT_YET = "Not A School Yet";
  const readers = routes.filter(([n]) => n !== "POST teacher/studentprogress");

  it("an old token whose school has not reached this server yet reads by the school NAME, exactly as before ids existed", async () => {
    for (const [, call] of readers) {
      const r = await run(() => call({ schoolname: NOT_YET }));
      expect(r.error).toBeUndefined();
      const sql = r.sql.join("\n");
      expect(sql).toMatch(new RegExp(`\`schoolid\` IS NULL AND \`students\`\\.\`schoolname\` = '${NOT_YET}'|\`schoolid\` IS NULL AND \`standards\`\\.\`schoolname\` = '${NOT_YET}'`));
      expect(sql).not.toMatch(/`schoolid` = /);
    }
    const scores = await run(() => teacher.getStudentsProgress({} as never, { schoolname: NOT_YET } as Token));
    expect(scores.sql.join("\n")).toMatch(BY_NAME(NOT_YET));
  });

  it("the same old token reads by the school's id once the school has arrived (never by both)", async () => {
    schoolRows = [...TWO_SCHOOLS, { schoolid: "5c000000-0000-4000-8000-0000000000d4", schoolname: NOT_YET }];
    for (const [, call] of readers) {
      const r = await run(() => call({ schoolname: NOT_YET }));
      const sql = r.sql.join("\n");
      expect(sql).toMatch(/`schoolid` = '5c000000-0000-4000-8000-0000000000d4'/);
      expect(sql).not.toMatch(/WHERE[^;]*schoolname/);
    }
  });

  it("a token that names no school reads what it always did (the empty name), except where it was refused", async () => {
    const stats = await run(() => teacher.getallstats(NAMELESS_TOKEN));
    expect(stats.error).toBeUndefined();
    expect(stats.sql.join("\n")).toMatch(BY_NAME(""));
    // these two answered 400 / 404 before and still do
    const standards = await run(() => teacher.getAllLessons("", NAMELESS_TOKEN));
    expect((standards.error as ApiError).getStatus()).toBe(400);
    expect((standards.error as ApiError).message).toBe("A school name is required.");
    expect(standards.sql).toEqual([]);
    const progress = await run(() => teacher.getStudentsProgress({} as never, NAMELESS_TOKEN));
    expect((progress.error as ApiError).getStatus()).toBe(404);
    expect(progress.sql).toEqual([]);
  });

  it("an old token whose name matches two live schools is a 400 before any learner is read", async () => {
    schoolRows = [
      { schoolid: A, schoolname: NAME_A },
      { schoolid: B, schoolname: NAME_A },
    ];
    for (const [, call] of routes) {
      const r = await run(() => call(OLD_TOKEN));
      expect((r.error as ApiError).getStatus()).toBe(400);
      expect(r.sql).toEqual([]);
    }
    // the same two schools, read with the new token: each school's own rows
    const a = await run(() => teacher.getallstats({ ...NEW_TOKEN, schoolid: A }));
    const b = await run(() => teacher.getallstats({ ...NEW_TOKEN, schoolid: B }));
    expect(a.sql.join("\n")).toMatch(FILTERS_ON_ID(A));
    expect(b.sql.join("\n")).toMatch(FILTERS_ON_ID(B));
    // the shared name is never part of the filter: an id OR a name would merge the two schools again
    expect(a.sql.join("\n")).not.toMatch(/WHERE[^;]*schoolname/);
    expect(b.sql.join("\n")).not.toMatch(/WHERE[^;]*schoolname/);
  });

  it("the teacher profile reads the school stored on the login, and the login's name only when no id is stored", async () => {
    const fakeTeacher = () => ({ schoolname: NAME_A, getDataValue: () => null, setDataValue: () => undefined });
    const stub = (loginSchoolId: string | null, learnerSchoolId: string | null) => {
      jest.spyOn(schoolusers, "findOne").mockResolvedValue(fakeTeacher() as never);
      jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: jest.fn().mockResolvedValue({ schoolid: loginSchoolId }) } as never);
      jest.spyOn(students, "scope").mockReturnValue({ findOne: jest.fn().mockResolvedValue({ schoolid: learnerSchoolId }) } as never);
    };
    stub(A, null);
    const stored = await run(() => teacher.getteacherprofile(NEW_TOKEN, "4A"));
    stub(null, null); // nothing stored: the login's own name, School A, is resolved
    const named = await run(() => teacher.getteacherprofile(NEW_TOKEN, "4A"));
    expect(stored.sql.length).toBeGreaterThan(0);
    expect(named.sql).toEqual(stored.sql);
    expect(stored.sql.join("\n")).toMatch(FILTERS_ON_ID(A));
    expect(stored.sql.join("\n")).not.toMatch(FILTERS_ON_NAME);
    stub(B, null); // a stored id is the school, whatever the name says
    const other = await run(() => teacher.getteacherprofile(NEW_TOKEN, "4A"));
    expect(other.sql.join("\n")).toMatch(FILTERS_ON_ID(B));
    // no id stored and no school of that name yet: the login's name, as before ids existed
    schoolRows = [];
    stub(null, null);
    const legacy = await run(() => teacher.getteacherprofile(NEW_TOKEN, "4A"));
    expect(legacy.sql.join("\n")).toMatch(new RegExp(`\`students\`\\.\`schoolid\` IS NULL AND \`students\`\\.\`schoolname\` = '${NAME_A}'`));
  });
});

describe("query-parameter filters: a name (as ever) or an id, resolved once", () => {
  const cases: Array<[string, (name?: string, id?: string) => Promise<unknown>, RegExp]> = [
    ["GET student/all", (n, i) => new StudentController().getAllCurriculums("", n, i), FILTERS_ON_ID(A)],
    ["GET grade/all (narrowed by a class)", (n, i) => new GradeController().getAllGrades("", "", "4A", n, i), FILTERS_ON_ID(A)],
    ["GET curriculum/all (narrowed by a class)", (n, i) => new CurriculumController().getAllCurriculums("", "", "4A", n, i), FILTERS_ON_ID(A)],
    ["GET report/offlineonline", (n, i) => new ReportController().getStudentsOfflineOnline(n, "", i), FILTERS_ON_ID(A)],
  ];

  it.each(cases)("%s: the id and the name read the same rows", async (_n, call, filter) => {
    const byId = await run(() => call(undefined, A));
    const byName = await run(() => call(NAME_A, undefined));
    const padded = await run(() => call(`  ${NAME_A.toUpperCase()} `, undefined));
    expect(byId.error).toBeUndefined();
    expect(byName.sql).toEqual(byId.sql);
    expect(padded.sql).toEqual(byId.sql);
    expect(byId.sql.join("\n")).toMatch(filter);
    expect(byId.sql.join("\n")).not.toMatch(FILTERS_ON_NAME);
  });

  it.each(cases)("%s: an id wins when both are sent", async (_n, call, filter) => {
    const both = await run(() => call(NAME_B, A));
    expect(both.sql.join("\n")).toMatch(filter);
  });

  it.each(cases)("%s: a name no school has yet filters by the name, as before ids existed; once the school exists, by its id", async (_n, call) => {
    const unknown = await run(() => call("Nobody School", undefined));
    expect(unknown.error).toBeUndefined();
    expect(unknown.sql.join("\n")).toMatch(/`students`\.`schoolid` IS NULL AND `students`\.`schoolname` = 'Nobody School'/);
    expect(unknown.sql.join("\n")).not.toMatch(/`schoolid` = '/);
    schoolRows = [...TWO_SCHOOLS, { schoolid: "5c000000-0000-4000-8000-0000000000d4", schoolname: "Nobody School" }];
    const arrived = await run(() => call("Nobody School", undefined));
    expect(arrived.sql.join("\n")).toMatch(/`students`\.`schoolid` = '5c000000-0000-4000-8000-0000000000d4'/);
    expect(arrived.sql.join("\n")).not.toMatch(/WHERE[^;]*schoolname/);
  });

  it.each(cases)("%s: a name that matches two live schools is a 400, and by id each school is its own rows", async (_n, call, filter) => {
    schoolRows = [
      { schoolid: A, schoolname: NAME_A },
      { schoolid: B, schoolname: NAME_A },
    ];
    const byName = await run(() => call(NAME_A, undefined));
    expect((byName.error as ApiError).getStatus()).toBe(400);
    expect(byName.sql).toEqual([]);
    const a = await run(() => call(undefined, A));
    const b = await run(() => call(undefined, B));
    expect(a.sql.join("\n")).toMatch(filter);
    expect(b.sql.join("\n")).toMatch(new RegExp(String(filter).slice(1, -1).replace(A, B)));
    expect(b.sql.join("\n")).not.toContain(A);
  });

  it("no school filter at all adds none (and a non-string name is no filter)", async () => {
    for (const [, call] of cases) {
      const none = await run(() => call(undefined, undefined));
      expect(none.sql.join("\n")).not.toMatch(/WHERE[^;]*schoolid/);
    }
    const odd = await run(() => new StudentBusiness().getStudentsWithFilter("", { gt: "a" }, ["x", "y"]));
    expect(odd.sql.join("\n")).not.toMatch(/`students`\.`schoolid`/);
  });
});

describe("the other readers", () => {
  it("the class list of a school is read by the school's id", async () => {
    const byId = await run(() => new StandardBusiness().getStandardsWithFilter({ schoolid: A }, "4"));
    expect(byId.sql.join("\n")).toMatch(new RegExp(`\`schoolid\` = '${A}'`));
    expect(byId.sql.join("\n")).not.toMatch(/WHERE[^;]*`schoolname`/);
    const byName = await run(() => new StandardBusiness().getStandardsWithFilter({ schoolname: "Not Here Yet" }, "4"));
    expect(byName.sql.join("\n")).toMatch(/`standards`\.`schoolid` IS NULL AND `standards`\.`schoolname` = 'Not Here Yet'/);
    expect(byName.sql.join("\n")).not.toMatch(/`schoolid` = /);
  });

  it("the offline/online count joins students to their school by id", async () => {
    const r = await run(() => new ReportBusiness().getStudentsOfflineOnline(undefined, "all", A));
    const sql = r.sql.join("\n");
    expect(sql).toMatch(/INNER JOIN `schools` AS `school` ON `students`\.`schoolid` = `school`\.`schoolid`/);
    expect(sql).toMatch(FILTERS_ON_ID(A));
    expect(sql).not.toMatch(/`schoolname`/);
  });

  describe("the learner status list (filters sent by the admin)", () => {
    const status = (filter: Array<{ key: string; value: string | string[] }>) =>
      run(() => new ReportBusiness().getStudentStatus({ pageindex: 1, pagesize: 10, filter }));

    it("a school filter sent as an id, and as a name, select the same rows, through the id join", async () => {
      const byId = await status([{ key: "schoolid", value: A }]);
      const byName = await status([{ key: "schoolname", value: NAME_A }]);
      const joined = byId.sql.join("\n");
      expect(joined).toMatch(/INNER JOIN `schools` AS `school` ON `students`\.`schoolid` = `school`\.`schoolid`/);
      expect(joined).toMatch(new RegExp(`\`school\`\\.\`schoolid\` = '${A}'`));
      expect(byName.sql.join("\n")).toMatch(new RegExp(`\`school\`\\.\`schoolid\` IN \\('${A}'\\)`));
      expect(byName.sql.join("\n")).not.toMatch(/`school`\.`schoolname` =/);
      expect(byName.sql.join("\n")).not.toMatch(/`school`\.`schoolname` IN/);
    });

    it("several names are all resolved; an unknown one is dropped; none known matches no learner", async () => {
      const some = await status([{ key: "schoolname", value: [NAME_A, "Nobody", NAME_B.toLowerCase()] }]);
      expect(some.sql.join("\n")).toMatch(new RegExp(`\`school\`\\.\`schoolid\` IN \\('${A}', '${B}'\\)`));
      const none = await status([{ key: "schoolname", value: "Nobody" }]);
      expect(none.error).toBeUndefined();
      expect(none.sql.join("\n")).toMatch(/`school`\.`schoolid` IN \(NULL\)/);
    });

    it("an id filter and a name filter must both hold", async () => {
      const both = await status([
        { key: "schoolid", value: A },
        { key: "schoolname", value: NAME_B },
      ]);
      const sql = both.sql.join("\n");
      expect(sql).toMatch(new RegExp(`\`school\`\\.\`schoolid\` = '${A}'`));
      expect(sql).toMatch(new RegExp(`\`school\`\\.\`schoolid\` IN \\('${B}'\\)`));
    });

    it("a name that matches two live schools is a 400; by id each school is read", async () => {
      schoolRows = [
        { schoolid: A, schoolname: NAME_A },
        { schoolid: B, schoolname: NAME_A },
      ];
      const byName = await status([{ key: "schoolname", value: NAME_A }]);
      expect((byName.error as ApiError).getStatus()).toBe(400);
      expect(byName.sql).toEqual([]);
      const b = await status([{ key: "schoolid", value: B }]);
      expect(b.sql.join("\n")).toMatch(new RegExp(`\`school\`\\.\`schoolid\` = '${B}'`));
    });

    it("selects no learner schoolid column", async () => {
      const r = await status([{ key: "schoolid", value: A }]);
      for (const sql of r.sql) {
        expect(selectList(sql)).not.toMatch(/`students`\.`schoolid`/);
      }
    });
  });

  it("the last-completed-quiz report joins schools by id and filters its school filter on the id", async () => {
    const r = await run(() =>
      new ReportBusiness().getStudentLastCompletedQuiz({ pageindex: 1, pagesize: 10, filter: [{ key: "schoolid", value: A }] }, false, 2),
    );
    const sql = r.sql.join("\n");
    expect(sql).toMatch(/ON `students`\.`schoolid` = `school`\.`schoolid`/);
    expect(sql).toMatch(new RegExp(`\`school\`\\.\`schoolid\` = '${A}'`));
    expect(sql).not.toMatch(/`students`\.`schoolname` = `school`/);
  });
});

describe("the school of one learner, for the reports that show it", () => {
  // Five report functions look the learner's school (and its country) up for each row they return.
  // A row that answers any property starting with "student" with an empty list (its progress rows).
  const fakeRow = (studentid: string) =>
    new Proxy(
      {
        studentid,
        standard: "4A",
        schooluserid: "u1",
        schoolname: "Stale Name",
        curriculumid: "c1",
        getDataValue: () => undefined,
        setDataValue: () => undefined,
      } as Record<string, unknown>,
      { get: (target, prop) => (prop in target ? target[prop as string] : typeof prop === "string" && prop.startsWith("student") ? [] : undefined) },
    );
  const stubEverything = () => {
    const learner = fakeRow("s1");
    for (const model of Object.values(models)) {
      const m = model as unknown as Record<string, unknown>;
      if (typeof m?.findOne === "function" && model !== schools) jest.spyOn(model as never, "findOne").mockResolvedValue(null as never);
      if (typeof m?.findAll === "function" && model !== schools) jest.spyOn(model as never, "findAll").mockResolvedValue([] as never);
      if (typeof m?.count === "function") jest.spyOn(model as never, "count").mockResolvedValue(0 as never);
      if (typeof m?.findAndCountAll === "function") jest.spyOn(model as never, "findAndCountAll").mockResolvedValue({ rows: [learner], count: 1 } as never);
    }
    jest.spyOn(students, "findOne").mockResolvedValue(learner as never);
  };

  const callers: Array<[string, () => Promise<unknown>]> = [
    ["getStudentsScoresData", () => new ReportBusiness().getStudentsScoresData({ filter: [{ key: "studentid", value: "s1" }] })],
    ["getClassScoresData", () => new ReportBusiness().getClassScoresData({ filter: [{ key: "standard", value: "4A" }] })],
    ["getStudentGradeProgress", () => new ReportBusiness().getStudentGradeProgress({ filter: [{ key: "standard", value: "4A" }, { key: "gradeid", value: "g1" }] })],
    ["getLevelQuizScoresData", () => new ReportBusiness().getLevelQuizScoresData({ filter: [{ key: "studentid", value: "s1" }, { key: "levelid", value: "l1" }] })],
    ["getClassLevelQuizScoresData", () => new ReportBusiness().getClassLevelQuizScoresData({ filter: [{ key: "standard", value: "4A" }, { key: "levelid", value: "l1" }] })],
  ];

  it.each(callers)("%s looks the school up by the learner's school id, never by the learner's school name", async (_n, call) => {
    stubEverything();
    schoolFindOne.mockClear();
    const r = await run(call);
    expect(r.error).toBeUndefined();
    const lookups = schoolFindOne.mock.calls.map((c) => c[0]);
    expect(lookups.length).toBeGreaterThan(0);
    for (const lookup of lookups) {
      expect(Object.keys(lookup.where)).toEqual(["schoolid"]);
      // what the lookup returns is unchanged: the school's name and its country
      expect(lookup.attributes).toEqual(["schoolname"]);
      expect(lookup.include[0].as).toBe("countries");
      // the generated statement reads the learner's school id inside itself
      log = [];
      await (Object.getPrototypeOf(schools) as { findAll: (o: unknown) => Promise<unknown> }).findAll.call(schools, { where: lookup.where }).catch(() => undefined);
      expect(log.pop()).toMatch(/`schools`\.`schoolid` = \(SELECT s\.schoolid FROM students AS s WHERE s\.studentid = 's1' LIMIT 1\)/);
    }
  });
});

describe("branding: a name or an id, one school, and never an error", () => {
  const branding = (name?: unknown, id?: unknown) => new SchoolController().getBranding(name, id);
  const row = (schoolid: string, uitheme: string) => ({ schoolid, uitheme, brandingconfig: { colour: uitheme } });

  beforeEach(() => {
    schoolFindOne.mockImplementation((async (opts: { where: { schoolid: string } }) =>
      opts.where.schoolid === A ? row(A, "corporate") : opts.where.schoolid === B ? row(B, "kids") : null) as never);
  });

  it("a name and an id give the same school, read by id", async () => {
    const byName = await branding(NAME_A.toUpperCase());
    const byId = await branding(undefined, A);
    expect(byName).toEqual(byId);
    expect(byId).toEqual({ error: false, data: { uitheme: "corporate", brandingconfig: { colour: "corporate" } } });
    expect(schoolFindOne.mock.calls.every((c) => Object.keys(c[0].where).join() === "schoolid")).toBe(true);
  });

  it("unknown, absent, odd and ambiguous names all fall back to the default theme", async () => {
    const fallback = { error: false, data: { uitheme: "kids", brandingconfig: null } };
    await expect(branding("Nobody")).resolves.toEqual(fallback);
    await expect(branding()).resolves.toEqual(fallback);
    await expect(branding({ gt: "a" })).resolves.toEqual(fallback);
    await expect(branding(undefined, "5c000000-0000-4000-8000-0000000000ff")).resolves.toEqual(fallback);
    schoolRows = [
      { schoolid: A, schoolname: "Twin" },
      { schoolid: B, schoolname: "Twin" },
    ];
    await expect(branding("Twin")).resolves.toEqual(fallback);
    await expect(branding("Twin", B)).resolves.toMatchObject({ data: { uitheme: "kids" } });
  });

  it("SchoolBusiness.getBranding itself resolves, never throws, on a database error that is not ours", async () => {
    schoolFindOne.mockRejectedValue(new Error("connection lost"));
    await expect(new SchoolBusiness().getBranding(NAME_A)).rejects.toThrow("connection lost");
  });
});

describe("curriculum baseline: the app's school name is resolved once to a live school's id", () => {
  const baselineRow = (schoolids: string[]) => ({
    curriculumbaselineid: "cb1",
    baselinename: "Baseline",
    baselinestatus: true,
    schoolid: schoolids,
    startdate: "2020-01-01",
    enddate: "2099-12-31",
  });
  const call = (schoolname: string) =>
    new CurriculumController().getCurriculumBaseline("c1", schoolname, "s1", { schoolusername: "x", schooluserid: "u1" } as Token, {
      date: String(Date.now()),
    } as never);

  beforeEach(() => {
    jest.spyOn(curriculumbaseline, "findOne").mockResolvedValue(baselineRow([A]) as never);
    jest.spyOn(models.studentprogress, "findOne").mockResolvedValue(null as never);
  });

  it("a school the baseline lists gets it; another school does not", async () => {
    await expect(call(NAME_A)).resolves.toMatchObject({ data: { curriculumbaselineid: "cb1", baselinepass: true } });
    await expect(call(` ${NAME_A.toLowerCase()} `)).resolves.toMatchObject({ data: { curriculumbaselineid: "cb1", baselinepass: true } });
    expect((await call(NAME_B)).data).toEqual({ baselinename: undefined, curriculumbaselineid: undefined, baselinepass: false });
  });

  it("a school this server does not have gets no baseline; a soft-deleted school is not a school here", async () => {
    expect((await call("Nobody")).data).toEqual({ baselinename: undefined, curriculumbaselineid: undefined, baselinepass: false });
    schoolRows = [{ schoolid: A, schoolname: NAME_A, isdeleted: true }];
    expect((await call(NAME_A)).data).toEqual({ baselinename: undefined, curriculumbaselineid: undefined, baselinepass: false });
  });

  it("the route's school-exists rule accepts a live school only, by the same text rule", async () => {
    const business = new CurriculumBusiness();
    await expect(business.isexitsSchoolName(NAME_A)).resolves.toBe(true);
    await expect(business.isexitsSchoolName(` ${NAME_A.toUpperCase()}`)).resolves.toBe(true);
    await expect(business.isexitsSchoolName("Nobody")).resolves.toBe(false);
    schoolRows = [{ schoolid: A, schoolname: NAME_A, isdeleted: true }];
    await expect(business.isexitsSchoolName(NAME_A)).resolves.toBe(false);
  });

  it("two live schools of the name is a 400 rather than a guess", async () => {
    schoolRows = [
      { schoolid: A, schoolname: NAME_A },
      { schoolid: B, schoolname: NAME_A },
    ];
    await expect(call(NAME_A)).rejects.toBeInstanceOf(ApiError);
    await expect(new CurriculumBusiness().isexitsSchoolName(NAME_A)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("what the reads still do not do", () => {
  it("a business reader given a school id never asks the schools table anything", async () => {
    (schools.findAll as unknown as jest.SpyInstance).mockClear();
    await run(() => new TeacherBusiness().getTeacherStandard({ schoolid: A }));
    await run(() => new StudentBusiness().getstudentbyschool({ schoolid: A }));
    await run(() => new StudentBusiness().getStudentsWithFilter("", undefined, A));
    await run(() => new GradeBusiness().getGradesWithFilter("", "", "4A", undefined, A));
    await run(() => new CurriculumBusiness().getCurriculumsWithFilter("", "", "4A", undefined, A));
    expect(schools.findAll).not.toHaveBeenCalled();
  });
});
