/**
 * ReportBusiness.getLearnerProgress backs `POST /report/learner-progress` (the admin learner-progress report): one row per
 * learner of the scope with the SAME numbers the learner's own app shows. This spec runs the real business code, the real
 * counting (`summariseLearnerProgress`) and the real enrolment rule against an in-memory copy of the tables, so that what the
 * rows say can be compared with what `StudentBusiness.getprogresssummary` answers for the same learner.
 *
 * The in-memory `findAndCountAll` for learners evaluates the `where` the business builds (AND / OR / IN / LIKE with
 * the backslash escape, as MySQL reads it, case-insensitively as the columns' collation does), joins the three tables the
 * query includes, orders and pages the rows. Nothing here touches a database. Names are invented.
 */
import { Op, Sequelize } from "sequelize";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { lessons } from "src/models/data-models/lessons";
import { levels } from "src/models/data-models/levels";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { standards } from "src/models/data-models/standards";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { students } from "src/models/data-models/students";
import { ReportBusiness, toProgressPercent } from "./report.business";
import { StudentBusiness } from "./student.business";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

{
  const sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  initModels(sequelize);
  setuprelationshipforreport(sequelize);
}

const ORG = "org-one";
const OTHER_ORG = "org-two";
const SCHOOL_A = "school-a";
const SCHOOL_B = "school-b";
const CLASS_1 = "class-1";
const CLASS_2 = "class-2";
const CLASS_B = "class-b";
const CUR = "cur-1";
const OTHER_CUR = "cur-other-org";

let tables: { students: Row[]; schoolusers: Row[]; schools: Row[]; standards: Row[]; curriculums: Row[]; grades: Row[]; levels: Row[]; lessons: Row[]; progress: Row[]; logins: Row[] };
let studentQueries: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any

const learner = (n: string, over: Row = {}): [Row, Row] => [
  { studentid: `st-${n}`, studentfirstname: `First ${n}`, studentlastname: `Last ${n}`, schoolid: SCHOOL_A, standard: CLASS_1, schooluserid: `su-${n}`, is_teacher_acc: false, curriculumids: [CUR], ...over },
  { schooluserid: `su-${n}`, schoolusername: `user.${n}`, isdisabled: false, isdeleted: false, schooluserstatus: 1 },
];

const reset = () => {
  // content: one curriculum of four lessons in level 1 and two in level 2 (and a curriculum of another organisation)
  const lessonRows = (level: string, count: number) => Array.from({ length: count }, (_, i) => ({ lessonid: `${level}-lesson-${i + 1}`, levelid: level, lessonstatus: true, isdeleted: false }));
  tables = {
    students: [],
    schoolusers: [],
    schools: [
      { schoolid: SCHOOL_A, schoolname: "Alpha School", organisationid: ORG },
      { schoolid: SCHOOL_B, schoolname: "Beta School", organisationid: ORG },
    ],
    standards: [
      { standardid: CLASS_1, standardname: "Class 1", schoolid: SCHOOL_A },
      { standardid: CLASS_2, standardname: "Class 2", schoolid: SCHOOL_A },
      { standardid: CLASS_B, standardname: "Class B", schoolid: SCHOOL_B },
    ],
    curriculums: [
      { curriculumid: CUR, curriculumname: "Programme One", curriculumstatus: true, isdeleted: false, organisationid: ORG },
      { curriculumid: OTHER_CUR, curriculumname: "Foreign Programme", curriculumstatus: true, isdeleted: false, organisationid: OTHER_ORG },
    ],
    grades: [{ gradeid: "grade-1", curriculumid: CUR, gradename: "Grade 1", gradeorder: 1, gradestatus: true, isdeleted: false }],
    levels: [
      { levelid: "level-1", gradeid: "grade-1", levelname: "Level One", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "level-2", gradeid: "grade-1", levelname: "Level Two", levelorder: 2, levelstatus: true, isdeleted: false },
    ],
    lessons: [...lessonRows("level-1", 4), ...lessonRows("level-2", 2)],
    progress: [],
    logins: [],
  };
  studentQueries = [];
};

const add = (n: string, over: Row = {}, login: Row = {}) => {
  const [student, user] = learner(n, over);
  tables.students.push(student);
  tables.schoolusers.push({ ...user, ...login });
  return student;
};
const done = (studentid: string, lessonids: string[], lastupdated = new Date("2026-03-01T10:00:00Z")) => {
  for (const lessonid of lessonids) tables.progress.push({ studentid, lessonid, completed: true, progress: 100, lastupdated });
};

// ---- a small evaluator for the `where` shapes this code builds -------------------------------------------------------
const likeToRegExp = (pattern: string): RegExp => {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") out += "[\\s\\S]*";
    else if (c === "_") out += "[\\s\\S]";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
};
const evalCond = (row: Row, key: string, cond: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const actual = key.startsWith("$") ? ({ "schooluser.isdeleted": row.schooluser?.isdeleted, "schooluser.schoolusername": row.schooluser?.schoolusername } as Row)[key.slice(1, -1)] : row[key];
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    for (const sym of Object.getOwnPropertySymbols(cond)) {
      if (sym === Op.in && !cond[sym].includes(actual)) return false;
      if (sym === Op.like && !(typeof actual === "string" && likeToRegExp(cond[sym]).test(actual))) return false;
    }
    return true;
  }
  return actual === cond;
};
const matches = (row: Row, where: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const sym of Object.getOwnPropertySymbols(where)) {
    const list: any[] = where[sym]; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (sym === Op.and && !list.every((w) => matches(row, w))) return false;
    if (sym === Op.or && !list.some((w) => matches(row, w))) return false;
  }
  return Object.entries(where).every(([key, cond]) => evalCond(row, key, cond));
};
const inList = (value: unknown, cond: any): boolean => (cond && typeof cond === "object" && !Array.isArray(cond) ? cond[Op.in].includes(value) : Array.isArray(cond) ? cond.includes(value) : value === cond); // eslint-disable-line @typescript-eslint/no-explicit-any
const simple = (rows: Row[], where: Row = {}) => rows.filter((r) => Object.entries(where).every(([k, c]) => inList(r[k], c)));

beforeEach(() => {
  reset();
  jest.spyOn(students, "findAndCountAll").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    studentQueries.push(options);
    const joined: Row[] = tables.students
      .map((s): Row => ({ ...s, schooluser: tables.schoolusers.find((u) => u.schooluserid === s.schooluserid), school: tables.schools.find((c) => c.schoolid === s.schoolid), class: tables.standards.find((c) => c.standardid === s.standard) }))
      .filter((s) => s.schooluser && s.school && matches(s, options.where));
    joined.sort((a, b) => [a.school.schoolname, a.class?.standardname ?? "", a.schooluser.schoolusername, a.studentid].join("\u0000").localeCompare([b.school.schoolname, b.class?.standardname ?? "", b.schooluser.schoolusername, b.studentid].join("\u0000")));
    const page = options.limit ? joined.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit) : joined;
    return { rows: page, count: joined.length };
  }) as never);
  jest.spyOn(students, "findOne").mockImplementation((async (options: any) => simple(tables.students, options.where)[0] ?? null) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(standards, "findAll").mockImplementation((async (options: any) => simple(tables.standards, options.where)) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(schools, "findAll").mockImplementation((async (options: any) => simple(tables.schools, options.where)) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(curriculums, "findAll").mockImplementation((async (options: any) => simple(tables.curriculums, options.where).sort((a, b) => a.curriculumname.localeCompare(b.curriculumname))) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(grades, "findAll").mockImplementation((async (options: any) => simple(tables.grades, options.where)) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(levels, "findAll").mockImplementation((async (options: any) => simple(tables.levels, options.where)) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(lessons, "findAll").mockImplementation((async (options: any) => simple(tables.lessons, options.where)) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(studentlessonsprogress, "findAll").mockImplementation((async (options: any) => simple(tables.progress, options.where)) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  jest.spyOn(studentlessonsprogress, "findOne").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const dates = simple(tables.progress, options.where).map((r) => r.lastupdated as Date);
    return { lastprogressat: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null };
  }) as never);
  jest.spyOn(rpiuseraccess, "findOne").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const rows = tables.logins.filter((l) => l.userid === options.where.userid).sort((a, b) => b.logintime.getTime() - a.logintime.getTime());
    return rows[0] ?? null;
  }) as never);
  jest.spyOn(schoolusers, "findAll").mockResolvedValue([] as never);
});
afterEach(() => jest.restoreAllMocks());

const scopeOf = (...schoolids: string[]) => ({ organisationid: ORG, schoolids });
const run = (filter: Array<{ key: string; value: any }> = [], over: Row = {}, scope: any = scopeOf(SCHOOL_A)) => // eslint-disable-line @typescript-eslint/no-explicit-any
  new ReportBusiness().getLearnerProgress({ pageindex: 1, pagesize: 20, filter, ...over }, scope);

describe("toProgressPercent (the app's own rule)", () => {
  it.each([
    [3, 4, 75],
    [199, 200, 99],
    [1, 300, 1],
    [0, 0, 0],
    [4, 4, 100],
    [0, 5, 0],
    [5, 4, 100], // more done than there are lessons (a lesson switched off after it was done) never exceeds 100
  ])("%i of %i is %i", (doneCount, total, percent) => {
    expect(toProgressPercent(doneCount, total)).toBe(percent);
  });
});

describe("ReportBusiness.getLearnerProgress", () => {
  it("answers exactly the learners of the scope: two in school A, none of school B's", async () => {
    const amy = add("amy");
    add("ben");
    add("cat", { schoolid: SCHOOL_B, standard: CLASS_B });
    done(amy.studentid, ["level-1-lesson-1", "level-1-lesson-2", "level-1-lesson-3"]);
    const result = await run();
    expect(result.rows.map((r) => r.studentid)).toEqual(["st-amy", "st-ben"]);
    expect(result.count).toBe(2);
    // the platform's view (no scope) sees all three
    const all = await run([], {}, null);
    expect(all.count).toBe(3);
  });

  it("a learner the scope does not cover is not found by naming the school or class either", async () => {
    add("amy");
    add("cat", { schoolid: SCHOOL_B, standard: CLASS_B });
    expect((await run([{ key: "schoolid", value: SCHOOL_B }])).rows).toEqual([]);
    expect((await run([{ key: "schoolid", value: [SCHOOL_A, SCHOOL_B] }])).rows.map((r) => r.studentid)).toEqual(["st-amy"]);
    expect((await run([{ key: "standard", value: CLASS_B }])).rows).toEqual([]);
  });

  it("each row's lessons, levels and current level equal the app's progress summary for that learner", async () => {
    const amy = add("amy");
    done(amy.studentid, ["level-1-lesson-1", "level-1-lesson-2", "level-1-lesson-3"]);
    const row = (await run()).rows[0];
    const summary = await new StudentBusiness().getprogresssummary({ studentid: amy.studentid, organisationid: ORG, schoolid: SCHOOL_A, schooluserrole: 4, curriculumids: [CUR] } as never);
    expect(row.curricula).toHaveLength(summary.curricula.length);
    const mine = row.curricula[0];
    const theirs = summary.curricula[0];
    expect(mine.lessonsCompleted).toBe(3);
    expect(mine.lessonsTotal).toBe(6);
    expect(mine).toMatchObject({
      curriculumid: theirs.curriculumid,
      curriculumname: theirs.curriculumname,
      lessonsCompleted: theirs.lessonsCompleted,
      lessonsTotal: theirs.lessonsTotal,
      levelsCompleted: theirs.levelsCompleted,
      levelsTotal: theirs.levelsTotal,
      percent: 50,
    });
    expect(mine.levelsCompleted).toBe(0);
    expect(mine.levelsTotal).toBe(2);
    expect(mine.currentLevel).toEqual({ levelid: theirs.currentLevel?.levelid, levelname: theirs.currentLevel?.levelname });
    expect(mine.currentLevel).toEqual({ levelid: "level-1", levelname: "Level One" });
  });

  it("a learner who has finished a level has it counted, and the next level is current", async () => {
    const amy = add("amy");
    done(amy.studentid, ["level-1-lesson-1", "level-1-lesson-2", "level-1-lesson-3", "level-1-lesson-4"]);
    const mine = (await run()).rows[0].curricula[0];
    expect(mine).toMatchObject({ lessonsCompleted: 4, lessonsTotal: 6, levelsCompleted: 1, levelsTotal: 2, percent: 67, currentLevel: { levelid: "level-2", levelname: "Level Two" } });
  });

  it("a learner with no progress shows zero done, 0 percent, and the first level as current", async () => {
    add("ben");
    const mine = (await run()).rows[0].curricula[0];
    expect(mine).toMatchObject({ lessonsCompleted: 0, lessonsTotal: 6, percent: 0, levelsCompleted: 0, levelsTotal: 2, currentLevel: { levelid: "level-1", levelname: "Level One" } });
  });

  it("only the curricula the learner's organisation owns count, as the learner's own token reads them", async () => {
    add("amy", { curriculumids: [CUR, OTHER_CUR] });
    const names = (await run()).rows[0].curricula.map((c: Row) => c.curriculumname);
    expect(names).toEqual(["Programme One"]);
  });

  it("a learner enrolled in no curriculum is still a row, with curricula []", async () => {
    add("eve", { curriculumids: [] });
    const result = await run();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].curricula).toEqual([]);
  });

  it("a disabled learner appears with status disabled; a learner whose account is switched off the way login reads it is disabled too; a deleted one does not appear", async () => {
    add("amy");
    add("ben", {}, { isdisabled: true });
    add("cat", {}, { schooluserstatus: 0 });
    add("dan", {}, { isdeleted: true });
    const result = await run();
    expect(result.rows.map((r) => [r.studentid, r.status])).toEqual([
      ["st-amy", "enabled"],
      ["st-ben", "disabled"],
      ["st-cat", "disabled"],
    ]);
    expect(result.count).toBe(3);
  });

  it("the row carries names as text, the school and class names, and the username", async () => {
    add("amy", { studentlastname: null });
    const row = (await run()).rows[0];
    expect(row).toMatchObject({ studentid: "st-amy", username: "user.amy", firstname: "First amy", lastname: "", schoolid: SCHOOL_A, schoolname: "Alpha School", standard: CLASS_1, classname: "Class 1" });
  });

  it("a learner in no class has classname ''", async () => {
    add("amy", { standard: null });
    expect((await run()).rows[0]).toMatchObject({ standard: "", classname: "" });
  });

  it("the standard filter narrows to one class", async () => {
    add("amy");
    add("ben", { standard: CLASS_2 });
    const result = await run([{ key: "standard", value: CLASS_2 }]);
    expect(result.rows.map((r) => r.studentid)).toEqual(["st-ben"]);
    expect(result.count).toBe(1);
  });

  describe("search", () => {
    beforeEach(() => {
      add("amy", { studentfirstname: "Amelia", studentlastname: "Stone" });
      add("ben", { studentfirstname: "Benedict", studentlastname: "Fields" });
      add("cat", { studentfirstname: "Cathy", studentlastname: "100% Real" });
      add("dee", { studentfirstname: "Dee", studentlastname: "Under_score" });
      add("eve", { studentfirstname: "Eve", studentlastname: "Plain" });
    });
    const found = async (text: string) => (await run([{ key: "search", value: text }])).rows.map((r) => r.studentid);

    it("matches the first name, the last name and the username, in any case", async () => {
      expect(await found("amel")).toEqual(["st-amy"]);
      expect(await found("FIELDS")).toEqual(["st-ben"]);
      expect(await found("USER.EVE")).toEqual(["st-eve"]);
      expect(await found("  stone  ")).toEqual(["st-amy"]);
    });

    it("a percent sign in the text matches only a literal percent sign", async () => {
      expect(await found("%")).toEqual(["st-cat"]);
      expect(await found("100%")).toEqual(["st-cat"]);
    });

    it("an underscore in the text matches only a literal underscore", async () => {
      expect(await found("_")).toEqual(["st-dee"]);
      expect(await found("r_s")).toEqual(["st-dee"]);
      expect(await found("pl_in")).toEqual([]);
    });

    it("is applied in the query and counted there, not after paging", async () => {
      const result = await run([{ key: "search", value: "e" }], { pagesize: 1, pageindex: 1 });
      const options = studentQueries[studentQueries.length - 1];
      expect(options.limit).toBe(1);
      expect(Object.getOwnPropertySymbols(options.where[Op.and][options.where[Op.and].length - 1])).toEqual([Op.or]);
      expect(result.rows).toHaveLength(1);
      expect(result.count).toBe(5); // every one has an e somewhere in a name or username (user.*)
    });

    it("a blank search is no search", async () => {
      expect(await found("   ")).toHaveLength(5);
    });
  });

  describe("paging and order", () => {
    beforeEach(() => {
      add("bob", { standard: CLASS_2 });
      add("amy");
      add("zed");
      add("cat", { schoolid: SCHOOL_B, standard: CLASS_B });
    });
    const ids = async (over: Row) => (await run([], over, scopeOf(SCHOOL_A, SCHOOL_B))).rows.map((r) => r.studentid);

    it("orders by school name, class name, username", async () => {
      expect(await ids({ pagesize: 0 })).toEqual(["st-amy", "st-zed", "st-bob", "st-cat"]);
    });

    it("pageindex counts from 1 as the other reports do: a page of one, second page is the second learner, total unchanged", async () => {
      const second = await run([], { pagesize: 1, pageindex: 2 }, scopeOf(SCHOOL_A, SCHOOL_B));
      expect(second.rows.map((r) => r.studentid)).toEqual(["st-zed"]);
      expect(second.count).toBe(4);
      const first = await run([], { pagesize: 1, pageindex: 1 }, scopeOf(SCHOOL_A, SCHOOL_B));
      expect(first.rows.map((r) => r.studentid)).toEqual(["st-amy"]);
      expect((await run([], { pagesize: 1, pageindex: 0 }, scopeOf(SCHOOL_A, SCHOOL_B))).rows.map((r) => r.studentid)).toEqual(["st-amy"]);
      expect(first.count).toBe(4);
    });

    it("pagesize 0 means all", async () => {
      expect(await ids({ pagesize: 0 })).toHaveLength(4);
      expect(studentQueries[studentQueries.length - 1].limit).toBeUndefined();
    });
  });

  it("lastprogressat is the latest lastupdated of the learner's lesson progress rows, null when there are none", async () => {
    const amy = add("amy");
    add("ben");
    done(amy.studentid, ["level-1-lesson-1"], new Date("2026-02-01T08:00:00Z"));
    done(amy.studentid, ["level-1-lesson-2"], new Date("2026-04-09T09:30:00Z"));
    done(amy.studentid, ["level-1-lesson-3"], new Date("2026-03-15T12:00:00Z"));
    const rows = (await run()).rows;
    expect(rows.find((r) => r.studentid === "st-amy")?.lastprogressat).toBe("2026-04-09T09:30:00.000Z");
    expect(rows.find((r) => r.studentid === "st-ben")?.lastprogressat).toBeNull();
  });

  it("lastlogin is the learner's latest login, null when they never signed in", async () => {
    add("amy");
    add("ben");
    tables.logins.push({ userid: "su-amy", logintime: new Date("2026-05-01T07:00:00Z") }, { userid: "su-amy", logintime: new Date("2026-06-02T07:00:00Z") });
    const rows = (await run()).rows;
    expect(rows.find((r) => r.studentid === "st-amy")?.lastlogin).toBe("2026-06-02T07:00:00.000Z");
    expect(rows.find((r) => r.studentid === "st-ben")?.lastlogin).toBeNull();
  });

  it("teachers' own learner records are not learners of the report", async () => {
    add("amy");
    add("tom", { is_teacher_acc: true });
    expect((await run()).rows.map((r) => r.studentid)).toEqual(["st-amy"]);
  });

  it("a school filter that is not text finds nothing", async () => {
    add("amy");
    expect((await run([{ key: "schoolid", value: { x: 1 } }])).rows).toEqual([]);
    expect((await run([{ key: "schoolid", value: [SCHOOL_A, 42] }])).rows).toEqual([]);
  });
});
