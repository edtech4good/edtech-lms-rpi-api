import { INestApplication } from "@nestjs/common";
import AdmZip from "adm-zip";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import { Model, Op, Sequelize } from "sequelize";
import request from "supertest";
import { Config } from "src/config";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { countries } from "src/models/data-models/countries";
import { curriculumbaseline } from "src/models/data-models/curriculumbaseline";
import { curriculums } from "src/models/data-models/curriculums";
import { documents } from "src/models/data-models/documents";
import { grades } from "src/models/data-models/grades";
import * as reportScope from "src/business/report-scope";
import { pinStudent, ReportBusiness } from "src/business/report.business";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonplans } from "src/models/data-models/lessonplan";
import { lessonpracticequestions } from "src/models/data-models/lessonpracticequestions";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { lessons } from "src/models/data-models/lessons";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { levels } from "src/models/data-models/levels";
import { organisations } from "src/models/data-models/organisations";
import { questions } from "src/models/data-models/questions";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { standards } from "src/models/data-models/standards";
import { studentactives } from "src/models/data-models/studentactives";
import { studentappusages } from "src/models/data-models/studentappusage";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentpoints } from "src/models/data-models/studentpoints";
import { studentprogress } from "src/models/data-models/studentprogress";
import { studentprogressquestions } from "src/models/data-models/studentprogressquestions";
import { students } from "src/models/data-models/students";
import { studenttrash } from "src/models/data-models/studenttrash";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { AccessController } from "src/modules/access/access.controller";
import { ImportController } from "src/modules/import/import.controller";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { GradeController } from "src/modules/grade/grade.controller";
import { LessonController } from "src/modules/lesson/lesson.controller";
import { LessonLearningController } from "src/modules/lesson/lesson.learning.controller";
import { LevelController } from "src/modules/level/level.controller";
import { QuestionController } from "src/modules/question/question.controller";
import { ReportController } from "src/modules/report/report.controller";
import { ResultController } from "src/modules/result/result.controller";
import { SchoolController } from "src/modules/school/school.controller";
import { StudentController } from "src/modules/student/student.controller";
import { TeacherController } from "src/modules/teachers/teacher.controller";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { dbinstance } from "src/services/dbservice";
import { stubCalls, stubLog } from "src/test-support/stub-business";

/**
 * The organisation boundary of the student API, over real HTTP through the real JWT strategy and the real guards
 * (organisations package 8, step 1).
 *
 * Two organisations, X and Y, each with a school, a teacher, learners, a curriculum tree with a baseline, and
 * progress rows; a third curriculum of X that X's school does not list; and an unowned legacy school, learner
 * and curriculum. Callers: a learner and a teacher of X, a learner and a teacher of Y, a learner whose token
 * lies about its curricula, the server sync key with and without X's header, an old token with no claims, a token
 * with null claims, and a token of a suspended organisation.
 *
 * What is real: the strategy (claims, organisation, school), the guards, `content-access`, the report scope, and
 * every query a people, list or report route makes. What is faked: the database (an in-memory table per model,
 * with a `where` evaluator: equality, lists, `LIKE`, `AND`/`OR`; joins are not evaluated, a model's includes are
 * ignored, and a list of any table but learners, levels, lessons and grades answers with no rows for `findAndCountAll`), and, for the
 * routes that name a piece of content, the business class behind the route (a marker row carries the ids the route
 * asked for; the queries behind those routes filter by parent id and are proved live). The marker is
 * `src/test-support/stub-business.ts`.
 *
 * Every enforced route has a test whose title starts with its `METHOD /path`, as the route inventory
 * (src/route-policy/route-inventory.spec.ts) looks them up; `expect(failures).toEqual([])` lists every scenario
 * that went wrong.
 */
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists: jest.fn().mockResolvedValue(true) })),
}));
// (a function declaration, so that the mock factories below can call it while the imports are still loading; the
// stub class is made on first use, because these business modules import one another and the real one may still be loading)
function stubbed(module: string, name: string, keep: string[]) {
  let stub: unknown;
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        const actual = jest.requireActual(module);
        if (prop !== name) return actual[prop];
        if (!stub) stub = jest.requireActual("src/test-support/stub-business").stubAllBut(actual[name], keep);
        return stub;
      },
    },
  );
}
jest.mock("src/business/lesson.business", () => stubbed("src/business/lesson.business", "LessonBusiness", ["getLessonsWithFilter", "isexistsLessonID"]));
jest.mock("src/business/activityprogress.business", () => stubbed("src/business/activityprogress.business", "ActivityProgressBusiness", []));
jest.mock("src/business/question.business", () => stubbed("src/business/question.business", "QuestionBusiness", []));
jest.mock("src/business/level.business", () => stubbed("src/business/level.business", "LevelBusiness", ["getLevelsWithFilter", "isexistsLevelID"]));
jest.mock("src/business/grade.business", () => stubbed("src/business/grade.business", "GradeBusiness", ["getGradesWithFilter", "isexistsGradeID"]));
jest.mock("src/business/result.business", () => stubbed("src/business/result.business", "ResultBusiness", []));
jest.mock("src/business/curriculum.business", () =>
  stubbed("src/business/curriculum.business", "CurriculumBusiness", [
    "getCurriculumsWithFilter",
    "findallcurriculum",
    "getEnrolledCurriculums",
    "getCurriculumsWithSubject",
    "isexistsCurriculumID",
    "isOwnSchoolLive",
  ]),
);

// ---------------------------------------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------------------------------------
const uid = (ns: string, n: number): string => `${ns}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG_X = uid("a1", 1);
const ORG_Y = uid("b2", 1);
const ORG_Z = uid("c3", 1); // suspended
const SCH_X = uid("a1", 2);
const SCH_Y = uid("b2", 2);
const SCH_Z = uid("c3", 2);
const SCH_L = uid("d4", 2); // an unowned legacy school
const SCH_L2 = uid("d5", 2); // a second unowned school (on the same Pi)
const CLS_X = uid("a1", 3);
const CLS_Y = uid("b2", 3);
const CLS_L = uid("d4", 3);
const CLS_L2 = uid("d5", 3);
const NOWHERE = uid("ee", 9); // an id that names nothing

interface Tree {
  curriculum: string;
  grade: string;
  level: string;
  lesson: string;
  learning: string;
  plan: string;
  practice: string;
  quiz: string;
  baseline: string;
  practiceQuestion: string;
  quizQuestion: string;
  levelQuestion: string;
  baselineQuestion: string;
  document: string;
}
const treeOf = (ns: string, org: string | null): Tree & { org: string | null } => ({
  org,
  curriculum: uid(ns, 10),
  grade: uid(ns, 11),
  level: uid(ns, 12),
  lesson: uid(ns, 13),
  learning: uid(ns, 14),
  plan: uid(ns, 15),
  practice: uid(ns, 16),
  quiz: uid(ns, 17),
  baseline: uid(ns, 18),
  practiceQuestion: uid(ns, 19),
  quizQuestion: uid(ns, 20),
  levelQuestion: uid(ns, 21),
  baselineQuestion: uid(ns, 22),
  document: uid(ns, 23),
});
const T_X1 = treeOf("a1", ORG_X); // in X's school's list, and in X's learners' lists
const T_X2 = treeOf("a2", ORG_X); // X's, but NOT in X's school's list; only learner X2 is enrolled
const T_Y1 = treeOf("b2", ORG_Y);
const T_L = treeOf("d4", null); // unowned
const T_L2 = treeOf("d5", null); // unowned, a second unowned school's

const ST_X1 = uid("a1", 31);
const ST_X2 = uid("a1", 32);
const ST_Y1 = uid("b2", 31);
const ST_Y2 = uid("b2", 32);
const ST_Y3 = uid("b2", 33);
const ST_R = uid("b2", 34); // a learner of Y whose class is a class of X (a roster that went wrong)
const ST_L1 = uid("d4", 31);
const ST_L2 = uid("d5", 31);
const SU_X1 = uid("a1", 41);
const SU_X2 = uid("a1", 42);
const SU_TX = uid("a1", 43); // X's teacher
const SU_AX = uid("a1", 44); // X's admin
const SU_Y1 = uid("b2", 41);
const SU_Y2 = uid("b2", 42);
const SU_Y3 = uid("b2", 44);
const SU_R = uid("b2", 45);
const SU_TY = uid("b2", 43);
const SU_L1 = uid("d4", 41);
const SU_L2 = uid("d5", 41);
const SU_TL = uid("d4", 43); // a teacher of the unowned school
const SU_TL2 = uid("d5", 43);
const SU_Z = uid("c3", 41);

// ---------------------------------------------------------------------------------------------------------
// the fake database
// ---------------------------------------------------------------------------------------------------------
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tables = new Map<unknown, Row[]>();
const MODELS = [
  organisations, schools, students, schoolusers, standards, curriculums, grades, levels, lessons, lessonlearnings, lessonplans,
  lessonpractices, lessonquizzes, curriculumbaseline, lessonpracticequestions, lessonquizquestions, levelquizquestions,
  baselinequestion, documents, studentappusages, studentprogress, studentprogressquestions, studentlessonsprogress,
  studentlevelsprogress, studentgradesprogress, studentlearningprogress, studentpoints, studentactives, studenttrash,
  rpiuseraccess, questions, countries,
] as unknown as Array<typeof Model & { name: string }>;
const rowsOf = (model: unknown): Row[] => tables.get(model) ?? [];

/** What the students tables handed out during one request: the learners a query actually returned. */
let seen: Set<string>;
/** The options each read was made with, by model name and method. */
let reads: Array<{ model: string; method: string; options: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The raw SQL a business method sent (the stats and login-time reads), by its replacements. */
let rawQueries: Array<{ sql: string; replacements: unknown[] }>;

const isLiteral = (x: unknown): boolean => Boolean(x) && typeof x === "object" && (x as object).constructor?.name === "Literal";
const same = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b || (a == null && b == null);
const like = (actual: unknown, pattern: string): boolean => {
  if (typeof actual !== "string") return false;
  const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  return re.test(actual);
};

const valueOfKey = (row: Row, key: string): unknown => {
  if (!key.startsWith("$")) return row[key];
  const path = key.slice(1, -1);
  if (path === "school.schoolid") return row.schoolid;
  if (path === "school.countryid") return rowsOf(schools).find((s) => s.schoolid === row.schoolid)?.countryid;
  if (path === "schooluser.schoolusername") return rowsOf(schoolusers).find((u) => u.schooluserid === row.schooluserid)?.schoolusername;
  return undefined;
};

const matchesValue = (actual: unknown, cond: unknown): boolean => {
  if (cond === undefined) throw new Error("a where value is undefined (Sequelize would throw too)");
  if (isLiteral(cond)) return true;
  if (cond === null) return actual == null;
  if (Array.isArray(cond)) return cond.some((c) => same(actual, c));
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond === "object") {
    for (const sym of Object.getOwnPropertySymbols(cond as object)) {
      const arg = (cond as Record<symbol, any>)[sym]; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (sym === Op.in && !(Array.isArray(arg) && arg.some((c: unknown) => same(actual, c)))) return false;
      if (sym === Op.notIn && Array.isArray(arg) && arg.some((c: unknown) => same(actual, c))) return false;
      if (sym === Op.eq && !isLiteral(arg) && !same(actual, arg)) return false;
      if (sym === Op.ne && same(actual, arg)) return false;
      if (sym === Op.like && !like(actual, arg)) return false;
    }
    return true; // other operators (dates, ranges) are not evaluated
  }
  return same(actual, cond);
};

const matchesWhere = (row: Row, where: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!where) return true;
  // the by-name narrowing of the school resolver: `where(fn("TRIM", col("schoolname")), name)`
  if (where.constructor?.name === "Where") return typeof row.schoolname === "string" && row.schoolname.trim().toLowerCase() === String(where.logic).toLowerCase();
  for (const sym of Object.getOwnPropertySymbols(where)) {
    const cond = where[sym];
    if (sym === Op.and && !(Array.isArray(cond) ? cond : [cond]).every((c: unknown) => matchesWhere(row, c))) return false;
    if (sym === Op.or && !(Array.isArray(cond) ? cond : [cond]).some((c: unknown) => matchesWhere(row, c))) return false;
  }
  for (const [key, cond] of Object.entries(where)) {
    if (key.startsWith("$") && valueOfKey(row, key) === undefined) continue;
    if (!matchesValue(valueOfKey(row, key), cond)) return false;
  }
  return true;
};

const PLAIN = Symbol("plain");
const wrap = (row: Row): Row => {
  const copy: Row = { ...row };
  const hidden: Record<string, unknown> = {
    [PLAIN as unknown as string]: row,
    get: (arg?: unknown) => (typeof arg === "string" ? copy[arg] : { ...row }),
    getDataValue: (k: string) => copy[k],
    setDataValue: (k: string, v: unknown) => {
      copy[k] = v;
    },
    toJSON: () => {
      const out: Row = {};
      for (const k of Object.keys(copy)) out[k] = copy[k];
      return out;
    },
    save: async () => {
      Object.assign(row, copy);
      return copy;
    },
  };
  for (const [k, v] of Object.entries(hidden)) Object.defineProperty(copy, k, { value: v, enumerable: false, writable: true });
  return copy;
};
const idsOf = (rows: Row[]): string[] => rows.map((r) => r.studentid).filter((x): x is string => typeof x === "string");

const install = () => {
  for (const model of MODELS) {
    const name = model.name;
    const read = (method: string, options: any, rows: Row[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      reads.push({ model: name, method, options });
      // the learners a request touched: those the students table handed out, and those whose progress any student*progress table did
      // (not the scope check's own look at the learner a body names: it reads who that is, and hands nothing out)
      const scopeCheck = JSON.stringify(options?.attributes) === JSON.stringify(["studentid", "schoolid", "schooluserid"]);
      if ((model === (students as unknown) || name.startsWith("student")) && !scopeCheck) for (const id of idsOf(rows)) seen.add(id);
      return rows;
    };
    const filtered = (options: any) => rowsOf(model).filter((r) => matchesWhere(r, options?.where)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const out = (rows: Row[], options: any) => rows.map((r) => (options?.raw ? { ...r } : wrap(r))); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(model, "findAll").mockImplementation((async (options: any) => out(read("findAll", options, filtered(options)), options)) as never);
    jest.spyOn(model, "findOne").mockImplementation((async (options: any) => out(read("findOne", options, filtered(options).slice(0, 1)), options)[0] ?? null) as never);
    jest.spyOn(model, "count").mockImplementation((async (options: any) => read("count", options, filtered(options)).length) as never);
    jest.spyOn(model, "findAndCountAll").mockImplementation((async (options: any) => {
      // Learners, levels, lessons and grades are listed for real (so that the per-row loops of the reports run); a joined list of any other table has no rows here.
      const rows = [students, levels, lessons, grades].includes(model as never) ? filtered(options) : [];
      const page = options?.limit ? rows.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit) : rows;
      read("findAndCountAll", options, page);
      return { rows: out(page, options), count: rows.length };
    }) as never);
    jest.spyOn(model, "create").mockImplementation((async (values: Row) => {
      tables.set(model, [...rowsOf(model), { ...values }]);
      return wrap(values);
    }) as never);
    jest.spyOn(model, "bulkCreate").mockImplementation((async (values: Row[]) => {
      tables.set(model, [...rowsOf(model), ...values.map((v) => ({ ...v }))]);
      return values.map(wrap);
    }) as never);
    jest.spyOn(model, "update").mockImplementation((async (values: Row, options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const hit = filtered(options);
      for (const row of hit) Object.assign(row, values);
      return [hit.length];
    }) as never);
    jest.spyOn(model, "destroy").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const hit = new Set(filtered(options));
      tables.set(model, rowsOf(model).filter((r) => !hit.has(r)));
      return hit.size;
    }) as never);
    jest.spyOn(model, "findOrCreate").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const found = filtered(options)[0];
      if (found) return [wrap(found), false];
      tables.set(model, [...rowsOf(model), { ...options.defaults }]);
      return [wrap(options.defaults), true];
    }) as never);
    jest.spyOn(model, "upsert").mockImplementation((async (values: Row) => {
      tables.set(model, [...rowsOf(model), { ...values }]);
      return [wrap(values), true];
    }) as never);
  }
  jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (sql: string, options: { replacements?: unknown[] }) => {
    rawQueries.push({ sql, replacements: options?.replacements ?? [] });
    return [{ ran: "raw query", studentid: options?.replacements?.[0], schooluserid: options?.replacements?.[0] }];
  }) as never);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockImplementation((async () => ({ commit: async () => undefined, rollback: async () => undefined })) as never);
};

// ---------------------------------------------------------------------------------------------------------
// the data
// ---------------------------------------------------------------------------------------------------------
const treeRows = (t: Tree & { org: string | null }) => {
  const status = { isdeleted: false };
  return [
    [
      curriculums,
      {
        curriculumid: t.curriculum,
        curriculumname: `Curriculum ${t.curriculum.slice(0, 2)}`,
        curriculumstatus: true,
        organisationid: t.org,
        ...status,
        // what a joined read carries (the fake ignores includes)
        grades: [{ gradeid: t.grade, gradeorder: 1, levels: [{ levelid: t.level, levelorder: 1, lessons: [{ lessonid: t.lesson, lessonorder: 1 }] }] }],
      },
    ],
    [grades, { gradeid: t.grade, curriculumid: t.curriculum, gradename: "Grade", gradeorder: 1, gradestatus: true, points: 100, ...status }],
    [levels, { levelid: t.level, gradeid: t.grade, levelname: "Level", levelorder: 1, levelstatus: true, points: 100, studentlevelsprogresses: [], ...status }],
    [lessons, { lessonid: t.lesson, levelid: t.level, lessonname: "Lesson", lessonorder: 1, lessonstatus: true, total_points: 10, studentlessonsprogresses: [], ...status }],
    [lessonlearnings, { lessonlearningid: t.learning, lessonid: t.lesson, documentid: t.document, lessonlearningstatus: true }],
    [lessonplans, { lessonplanid: t.plan, lessonid: t.lesson, documentid: t.document, lessonplanstatus: true }],
    [lessonpractices, { lessonpracticeid: t.practice, lessonid: t.lesson, lessonpracticestatus: true }],
    [lessonquizzes, { lessonquizid: t.quiz, lessonid: t.lesson, lessonquizstatus: true }],
    [curriculumbaseline, { curriculumbaselineid: t.baseline, curriculumid: t.curriculum, baselinename: `Baseline ${t.baseline.slice(0, 2)}`, baselinestatus: true, schoolid: [], startdate: "2020-01-01", enddate: "2099-12-31", ...status }],
    [lessonpracticequestions, { lessonpracticequestionid: t.practiceQuestion, lessonpracticeid: t.practice }],
    [lessonquizquestions, { lessonquizquestionid: t.quizQuestion, lessonquizid: t.quiz }],
    [levelquizquestions, { levelquizquestionid: t.levelQuestion, levelid: t.level }],
    [baselinequestion, { baselinequestionid: t.baselineQuestion, curriculumbaselineid: t.baseline }],
    [documents, { documentid: t.document, documentname: "doc.pdf", organisationid: t.org, ...status }],
  ] as Array<[unknown, Row]>;
};

const learner = (studentid: string, schooluserid: string, school: string, schoolname: string, standard: string, curriculumids: string[]): Row => ({
  studentid,
  schooluserid,
  schoolid: school,
  schoolname,
  standard,
  curriculumid: curriculumids[0],
  curriculumids,
  is_teacher_acc: false,
  isactive: 1,
  studentfirstname: `Learner ${studentid.slice(0, 2)}`,
  genderid: 1,
  country: "KH",
  dateofjoin: new Date("2025-01-01"),
  profileimage: null,
  // what a joined read would carry; the fake ignores includes
  schooluser: { schooluserid, schoolusername: `user-${schooluserid.slice(0, 4)}` },
  curriculum: { curriculumid: curriculumids[0] },
  studentlessonsprogresses: [],
  studentlevelsprogresses: [],
  studentgradesprogresses: [],
  studentprogresses: [],
});
const login = (schooluserid: string, name: string, role: SchoolRole, school: string | null, schoolname: string): Row => ({
  schooluserid,
  schoolusername: name,
  schooluserrole: role,
  schoolid: school,
  schoolname,
  isdisabled: false,
  isdeleted: false,
  schooluserstatus: true,
});

const seedData = () => {
  tables.clear();
  const put = (model: unknown, rows: Row[]) => tables.set(model, [...rowsOf(model), ...rows]);
  put(organisations, [
    { organisationid: ORG_X, organisationname: "Org X", organisationcode: "x", organisationstatus: true, isdeleted: false, uitheme: "corporate", brandingconfig: { org: "x" } },
    { organisationid: ORG_Y, organisationname: "Org Y", organisationcode: "y", organisationstatus: true, isdeleted: false, uitheme: "kids", brandingconfig: { org: "y" } },
    { organisationid: ORG_Z, organisationname: "Org Z", organisationcode: "z", organisationstatus: false, isdeleted: false, uitheme: "kids", brandingconfig: null },
  ]);
  put(schools, [
    { schoolid: SCH_X, schoolname: "School X", organisationid: ORG_X, countryid: "c1", curriculums: [T_X1.curriculum], isdeleted: false, uitheme: "corporate", brandingconfig: { logo: "x" } },
    { schoolid: SCH_Y, schoolname: "School Y", organisationid: ORG_Y, countryid: "c1", curriculums: [T_Y1.curriculum], isdeleted: false, uitheme: "kids", brandingconfig: { logo: "y" } },
    { schoolid: SCH_Z, schoolname: "School Z", organisationid: ORG_Z, countryid: "c1", curriculums: [], isdeleted: false, uitheme: "kids", brandingconfig: null },
    { schoolid: SCH_L, schoolname: "Legacy School", organisationid: null, countryid: "c1", curriculums: [T_L.curriculum], isdeleted: false, uitheme: "kids", brandingconfig: null },
    { schoolid: SCH_L2, schoolname: "Second Legacy School", organisationid: null, countryid: "c1", curriculums: [T_L2.curriculum], isdeleted: false, uitheme: "kids", brandingconfig: null },
  ]);
  for (const t of [T_X1, T_X2, T_Y1, T_L, T_L2]) for (const [model, row] of treeRows(t)) put(model, [row]);
  put(standards, [
    { standardid: CLS_X, standardname: "Class X", schoolid: SCH_X, schoolname: "School X", isdeleted: false },
    { standardid: CLS_Y, standardname: "Class Y", schoolid: SCH_Y, schoolname: "School Y", isdeleted: false },
    { standardid: CLS_L, standardname: "Class L", schoolid: SCH_L, schoolname: "Legacy School", isdeleted: false },
    { standardid: CLS_L2, standardname: "Class L2", schoolid: SCH_L2, schoolname: "Second Legacy School", isdeleted: false },
  ]);
  put(students, [
    learner(ST_X1, SU_X1, SCH_X, "School X", CLS_X, [T_X1.curriculum]),
    // enrolled in X's two curricula, and (by mistake) in one of Y's and the legacy one: those must not count
    learner(ST_X2, SU_X2, SCH_X, "School X", CLS_X, [T_X1.curriculum, T_X2.curriculum, T_Y1.curriculum, T_L.curriculum]),
    learner(ST_Y1, SU_Y1, SCH_Y, "School Y", CLS_Y, [T_Y1.curriculum]),
    learner(ST_Y2, SU_Y2, SCH_Y, "School Y", CLS_Y, [T_Y1.curriculum]),
    learner(ST_Y3, SU_Y3, SCH_Y, "School Y", CLS_Y, [T_Y1.curriculum]),
    learner(ST_R, SU_R, SCH_Y, "School Y", CLS_X, [T_Y1.curriculum]),
    learner(ST_L1, SU_L1, SCH_L, "Legacy School", CLS_L, [T_L.curriculum]),
    learner(ST_L2, SU_L2, SCH_L2, "Second Legacy School", CLS_L2, [T_L2.curriculum]),
  ]);
  put(schoolusers, [
    login(SU_X1, "x.learner1", SchoolRole.STUDENT, SCH_X, "School X"),
    login(SU_X2, "x.learner2", SchoolRole.STUDENT, SCH_X, "School X"),
    login(SU_TX, "x.teacher", SchoolRole.TEACHER, SCH_X, "School X"),
    login(SU_AX, "x.admin", SchoolRole.ADMIN, SCH_X, "School X"),
    login(SU_Y1, "y.learner1", SchoolRole.STUDENT, SCH_Y, "School Y"),
    login(SU_Y2, "y.learner2", SchoolRole.STUDENT, SCH_Y, "School Y"),
    login(SU_Y3, "y.learner3", SchoolRole.STUDENT, SCH_Y, "School Y"),
    login(SU_R, "y.rogue", SchoolRole.STUDENT, SCH_Y, "School Y"),
    login(SU_TY, "y.teacher", SchoolRole.TEACHER, SCH_Y, "School Y"),
    login(SU_L1, "legacy.learner", SchoolRole.STUDENT, SCH_L, "Legacy School"),
    login(SU_L2, "legacy2.learner", SchoolRole.STUDENT, SCH_L2, "Second Legacy School"),
    login(SU_TL, "legacy.teacher", SchoolRole.TEACHER, SCH_L, "Legacy School"),
    login(SU_TL2, "legacy2.teacher", SchoolRole.TEACHER, SCH_L2, "Second Legacy School"),
  ]);
  put(studentappusages, [SU_X1, SU_X2, SU_Y1, SU_L1].map((id, i) => ({ studentappusageid: uid("ff", i), schooluserid: id, time_spent: 60, created_at: new Date() })));
  put(studentprogress, [
    { studentprogressid: uid("f1", 1), studentid: ST_X2, studentprogressreferenceid: T_X1.baseline, progresstype: 5, ispass: 1 },
    { studentprogressid: uid("f1", 2), studentid: ST_Y1, studentprogressreferenceid: T_Y1.baseline, progresstype: 5, ispass: 1 },
  ]);
  // Progress per level and lesson. X's learner 1 has none on X's level and lesson; Y's learner 1 has some on X's own.
  put(studentlevelsprogress, [
    { studentlevelprogressid: uid("f2", 1), studentid: ST_X2, levelid: T_X1.level, points: 10 },
    { studentlevelprogressid: uid("f2", 2), studentid: ST_Y1, levelid: T_Y1.level, points: 20 },
    { studentlevelprogressid: uid("f2", 3), studentid: ST_Y1, levelid: T_X1.level, points: 30 },
  ]);
  put(studentlessonsprogress, [
    { studentlessonprogressid: uid("f3", 1), studentid: ST_X2, lessonid: T_X1.lesson, points: 10 },
    { studentlessonprogressid: uid("f3", 2), studentid: ST_Y1, lessonid: T_Y1.lesson, points: 20 },
    { studentlessonprogressid: uid("f3", 3), studentid: ST_Y1, lessonid: T_X1.lesson, points: 30 },
  ]);
  // each baseline is for its own organisation's school
  for (const [tree, school] of [[T_X1, SCH_X], [T_Y1, SCH_Y], [T_L, SCH_L], [T_L2, SCH_L2]] as Array<[Tree, string]>) {
    rowsOf(curriculumbaseline).find((b) => b.curriculumbaselineid === tree.baseline)!.schoolid = [school];
  }
};

// ---------------------------------------------------------------------------------------------------------
// callers
// ---------------------------------------------------------------------------------------------------------
const bearer = (claims: Record<string, unknown>): string =>
  `Bearer ${sign({ jti: "jti", ...claims }, Config.fortyk.api.rpi.applicationsecret, { expiresIn: "5m" })}`;
const staff = (id: string, role: SchoolRole, school: string, org: string) => ({
  sub: id, schooluserid: id, schooluserrole: role, schoolid: school, organisationid: org, schoolname: "x",
});
const pupil = (id: string, studentid: string, school: string, org: string, curriculumids: string[]) => ({
  sub: id, schooluserid: id, studentid, schooluserrole: SchoolRole.STUDENT, schoolid: school, organisationid: org, curriculumids, schoolname: "x",
});

type Auth = { bearer: string } | { key: true; org?: string };
const X_LEARNER: Auth = { bearer: bearer(pupil(SU_X1, ST_X1, SCH_X, ORG_X, [T_Y1.curriculum])) }; // the token LIES about its curricula
const X_LEARNER2: Auth = { bearer: bearer(pupil(SU_X2, ST_X2, SCH_X, ORG_X, [T_X1.curriculum])) }; // stale: lacks the curriculum added since
const X_TEACHER: Auth = { bearer: bearer(staff(SU_TX, SchoolRole.TEACHER, SCH_X, ORG_X)) };
const X_ADMIN: Auth = { bearer: bearer(staff(SU_AX, SchoolRole.ADMIN, SCH_X, ORG_X)) };
const Y_LEARNER: Auth = { bearer: bearer(pupil(SU_Y1, ST_Y1, SCH_Y, ORG_Y, [T_Y1.curriculum])) };
const Y_TEACHER: Auth = { bearer: bearer(staff(SU_TY, SchoolRole.TEACHER, SCH_Y, ORG_Y)) };
const CLAIMLESS_LEARNER: Auth = { bearer: bearer({ sub: SU_X1, schooluserid: SU_X1, studentid: ST_X1, schooluserrole: SchoolRole.STUDENT, schoolname: "School X" }) };
const CLAIMLESS_TEACHER: Auth = { bearer: bearer({ sub: SU_TX, schooluserid: SU_TX, schooluserrole: SchoolRole.TEACHER, schoolname: "School X" }) };
const NULL_CLAIMS: Auth = { bearer: bearer({ ...pupil(SU_X1, ST_X1, SCH_X, ORG_X, []), schoolid: null, organisationid: null }) };
const SUSPENDED: Auth = { bearer: bearer({ ...pupil(SU_Z, ST_X1, SCH_Z, ORG_Z, []) }) };
const SERVER_X: Auth = { key: true, org: ORG_X };
const SERVER_PLATFORM: Auth = { key: true, org: "platform" }; // central acting for a platform user who is not acting as an organisation
const SERVER_NOHEADER: Auth = { key: true }; // no X-Organisation-Id at all
const REFUSED_TOKENS: Array<[string, Auth]> = [
  ["a token with no claims (learner)", CLAIMLESS_LEARNER],
  ["a token with no claims (teacher)", CLAIMLESS_TEACHER],
  ["a token with null claims", NULL_CLAIMS],
  ["a token of a suspended organisation", SUSPENDED],
];

let app: INestApplication;
type Method = "get" | "post" | "put";
const send = (method: Method, path: string, auth: Auth, body?: unknown, headers: Record<string, string> = {}) => {
  let req = request(app.getHttpServer())[method](path);
  if ("bearer" in auth) {
    req = req.set("Authorization", auth.bearer);
  } else {
    req = req.set("Authorization", Config.fortyk.api.serversynckey);
    if (auth.org !== undefined) req = req.set("X-Organisation-Id", auth.org);
  }
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return body === undefined ? req : req.send(body as object);
};

const snapshot = (): string => JSON.stringify([...tables.entries()].map(([m, rows]) => [(m as { name: string }).name, rows]));
const reset = () => {
  stubCalls.length = 0;
  stubLog.length = 0;
  seen = new Set();
  reads = [];
  rawQueries = [];
};

beforeAll(async () => {
  const sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  initModels(sequelize);
  setuprelationshipforreport(sequelize);
  const moduleRef = await Test.createTestingModule({
    controllers: [
      AccessController, CurriculumController, GradeController, ImportController, LessonController, LessonLearningController, LevelController,
      QuestionController, ReportController, ResultController, SchoolController, StudentController, TeacherController,
    ],
    providers: [JwtAccessStrategy],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  install();
  seedData();
  reset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Collects what went wrong in a scenario, so a failing test names every broken case at once. */
const scenario = () => {
  const failures: string[] = [];
  return {
    failures,
    check: (what: string, ok: unknown) => {
      if (!ok) failures.push(what);
    },
  };
};
const idsIn = (body: any, key: string): string[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.data) ? body.data.data : [];
  return data.map((r: Row) => r?.[key]).filter((x: unknown): x is string => typeof x === "string");
};
const text = (body: unknown): string => JSON.stringify(body);
const refusedEverywhere = async (check: (what: string, ok: unknown) => void, method: Method, path: string, body?: unknown) => {
  for (const [name, auth] of REFUSED_TOKENS) {
    const r = await send(method, path, auth, body);
    check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
  }
};

// ---------------------------------------------------------------------------------------------------------
// routes that name a piece of content in their path
// ---------------------------------------------------------------------------------------------------------
interface ContentCase {
  method: Method;
  path: (id: string) => string;
  pick: (t: Tree) => string;
  /** The business marker the route reaches when it is allowed (none for routes that run real code). */
  ran?: string;
  body?: unknown;
  /** A write route: what its allowed call must do. */
  writes?: string;
  /** For a route with no marker of its own: the stub that is handed the container id, or the model whose read must name it. */
  idArg?: string;
  idRead?: string;
}
const NOW = new Date().toISOString();
const RESULT_BODY = { result: [], starttime: NOW, endtime: NOW };
const content = (method: Method, path: (id: string) => string, pick: (t: Tree) => string, ran?: string, extra: Partial<ContentCase> = {}): ContentCase => ({ method, path, pick, ran, ...extra });

const runContent = async (c: ContentCase) => {
  const { failures, check } = scenario();
  const own = c.pick(T_X1);
  const foreign = c.pick(T_Y1);
  const legacy = c.pick(T_L);
  const notEnrolled = c.pick(T_X2);
  const call = (auth: Auth, id: string) => send(c.method, c.path(id), auth, c.body);
  const asked = (id: string) =>
    c.ran
      ? stubLog.some((m) => m.ran === c.ran && m.args.includes(id))
      : c.idArg
      ? stubLog.some((m) => m.ran === c.idArg && m.args.includes(id))
      : c.idRead
      ? reads.some((r) => r.model === c.idRead && JSON.stringify(r.options?.where ?? {}).toLowerCase().includes(id.toLowerCase()))
      : false;

  // own content answers, and is what was asked for
  reset();
  let r = await call(X_LEARNER, own);
  check(`X learner, own content -> ${r.status} (wanted 200)`, r.status === 200);
  check("X learner, own content: the route asked for the learner's own id", asked(own));
  if (c.writes) check(`X learner, own submission: the writes ran (${stubCalls.join()})`, stubCalls.some((s) => s.startsWith(c.writes!)));
  r = await call(X_TEACHER, own);
  check(`X teacher, content of the school's list -> ${r.status} (wanted 200)`, r.status === 200);
  r = await call(Y_LEARNER, foreign);
  check(`Y learner, own content -> ${r.status} (wanted 200)`, r.status === 200);
  r = await call(X_LEARNER2, notEnrolled);
  check(`X learner 2 (enrolled since sign-in, token stale), content of the new curriculum -> ${r.status} (wanted 200: the database decides)`, r.status === 200);

  // another organisation's content, a legacy unowned curriculum's, and content that does not exist all answer the same
  reset();
  const before = snapshot();
  const transactionsBefore = (dbinstance.getdbinstance().transaction as unknown as jest.Mock).mock.calls.length;
  const absent = await call(X_LEARNER, NOWHERE);
  check(`X learner, content that does not exist -> ${absent.status} (wanted 404)`, absent.status === 404);
  const absentBody = text(absent.body);
  for (const [name, auth, id] of [
    ["X learner, Y's content (its token claims Y's curriculum)", X_LEARNER, foreign],
    ["X learner, a legacy unowned curriculum's content", X_LEARNER, legacy],
    ["X learner, X's own curriculum it is not enrolled in", X_LEARNER, notEnrolled],
    ["X learner 2 (enrolled in Y's curriculum by mistake), Y's content", X_LEARNER2, foreign],
    ["X learner 2 (enrolled in the legacy curriculum by mistake), the legacy content", X_LEARNER2, legacy],
    ["X teacher, Y's content", X_TEACHER, foreign],
    ["X teacher, X's curriculum that the school does not list", X_TEACHER, notEnrolled],
    ["X teacher, a legacy unowned curriculum's content", X_TEACHER, legacy],
    ["X admin, Y's content", X_ADMIN, foreign],
    ["Y learner, X's content", Y_LEARNER, own],
    ["Y teacher, X's content", Y_TEACHER, own],
  ] as Array<[string, Auth, string]>) {
    r = await call(auth, id);
    check(`${name} -> ${r.status} (wanted 404)`, r.status === 404);
    check(`${name}: the answer is the one for absent content`, text(r.body) === absentBody);
  }
  check(`foreign content: nothing ran behind the route (${stubCalls.join()})`, stubCalls.length === 0);
  check("foreign content: no table changed", snapshot() === before);
  check("foreign content: no transaction was opened", (dbinstance.getdbinstance().transaction as unknown as jest.Mock).mock.calls.length === transactionsBefore);

  // a token that does not prove its organisation never reaches the content
  for (const [name, auth] of REFUSED_TOKENS) {
    r = await call(auth, own);
    check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
  }
  return failures;
};

// ---------------------------------------------------------------------------------------------------------
describe("content routes: another organisation's content is absent, and a refused token reaches nothing", () => {
  const C = {
    "GET /curriculum/:curriculumid": content("get", (id) => `/curriculum/${id}`, (t) => t.curriculum, "CurriculumBusiness.findcurriculum"),
    "GET /curriculum/:curriculumid/map": content("get", (id) => `/curriculum/${id}/map`, (t) => t.curriculum, "CurriculumBusiness.findcurriculumgrades"),
    "GET /grade/curriculum/:curriculumid": content("get", (id) => `/grade/curriculum/${id}`, (t) => t.curriculum, "GradeBusiness.getgradesbycurriculumid"),
    "GET /grade/progress/curriculum/:curriculumid": content("get", (id) => `/grade/progress/curriculum/${id}`, (t) => t.curriculum, "GradeBusiness.getusergradesprogess"),
    "GET /grade/totalgradeprogress/:gradeid": content("get", (id) => `/grade/totalgradeprogress/${id}`, (t) => t.grade, "GradeBusiness.gettotalprogressofgrade"),
    "GET /level/grade/:gradeid": content("get", (id) => `/level/grade/${id}`, (t) => t.grade, "LevelBusiness.getlevelsbygradeid"),
    "GET /level/progress/grade/:gradeid": content("get", (id) => `/level/progress/grade/${id}`, (t) => t.grade, "LevelBusiness.getuserlevelsprogress"),
    "GET /Lesson/level/:levelid": content("get", (id) => `/Lesson/level/${id}`, (t) => t.level, "LessonBusiness.getlessonsbylevelid"),
    "GET /Lesson/progress/level/:levelid": content("get", (id) => `/Lesson/progress/level/${id}`, (t) => t.level, "LessonBusiness.getuserlessonsprogress"),
    "GET /Lesson/level/:levelid/steps": content("get", (id) => `/Lesson/level/${id}/steps`, (t) => t.level, "ActivityProgressBusiness.getlevelactivitiesprogress"),
    "GET /Lesson/:lessonid/progress": content("get", (id) => `/Lesson/${id}/progress`, (t) => t.lesson, "LessonBusiness.getuserlessonprogress"),
    "GET /Lesson/:lessonid/activities/progress": content("get", (id) => `/Lesson/${id}/activities/progress`, (t) => t.lesson, "ActivityProgressBusiness.getlessonactivitiesprogress"),
    "POST /lesson/learning/:lessonlearningid/progress": content("post", (id) => `/lesson/learning/${id}/progress`, (t) => t.learning, "LessonBusiness.updatelearningprogress", {
      body: { ended: true, time: 1, content_length: 1 },
    }),
    "GET /lesson/:lessonid/learning/progress": content("get", (id) => `/lesson/${id}/learning/progress`, (t) => t.lesson, "LessonBusiness.getalllearningprogress"),
    "GET /lesson/learning/:lessonlearningid/progress": content("get", (id) => `/lesson/learning/${id}/progress`, (t) => t.learning, "LessonBusiness.getlearningprogress"),
    "GET /lesson/learning/:lessonlearningid": content("get", (id) => `/lesson/learning/${id}`, (t) => t.learning, "LessonBusiness.getlearninglesson"),
    "GET /lesson/:lessonid/learning": content("get", (id) => `/lesson/${id}/learning`, (t) => t.lesson, "LessonBusiness.getlessonbricks"),
    "GET /lesson/plan/:lessonplanid": content("get", (id) => `/lesson/plan/${id}`, (t) => t.plan, "LessonBusiness.getplanlesson"),
    "GET /question/lesson/:lessonid": content("get", (id) => `/question/lesson/${id}`, (t) => t.lesson, "QuestionBusiness.getlessonquestions"),
    "GET /question/level/:levelid": content("get", (id) => `/question/level/${id}`, (t) => t.level, "QuestionBusiness.getlevelquestions"),
    "GET /question/practice/:lessonpracticeid": content("get", (id) => `/question/practice/${id}`, (t) => t.practice, "QuestionBusiness.getpracticequestions"),
    "GET /question/quiz/:lessonquizid": content("get", (id) => `/question/quiz/${id}`, (t) => t.quiz, "QuestionBusiness.getquizquestions"),
    "GET /question/baseline/:curriculumbaselineid": content("get", (id) => `/question/baseline/${id}`, (t) => t.baseline, "QuestionBusiness.getbaselinequestions"),
    "GET /question/level/:levelid/answers": content("get", (id) => `/question/level/${id}/answers`, (t) => t.level, "QuestionBusiness.getlevelquestionsanswers"),
    "POST /result/lesson/practice/:lessonpracticeid": content("post", (id) => `/result/lesson/practice/${id}`, (t) => t.practice, undefined, {
      body: RESULT_BODY,
      writes: "ResultBusiness.updatePracticePoints",
      idArg: "LessonBusiness.getlessonpractice",
    }),
    "POST /result/lesson/quiz/:lessonquizid": content("post", (id) => `/result/lesson/quiz/${id}`, (t) => t.quiz, undefined, {
      body: RESULT_BODY,
      writes: "ResultBusiness.updateQuizPoints",
      idArg: "LessonBusiness.getlessonquiz",
    }),
    "POST /result/level/quiz/:levelid": content("post", (id) => `/result/level/quiz/${id}`, (t) => t.level, undefined, {
      body: RESULT_BODY,
      writes: "ResultBusiness.updateLevelQuizPoints",
      idArg: "LessonBusiness.getlevelquiz",
    }),
    "POST /result/baseline/question/:curriculumbaselineid": content("post", (id) => `/result/baseline/question/${id}`, (t) => t.baseline, undefined, {
      body: RESULT_BODY,
      writes: "ResultBusiness.createbaselinequestionprogress",
      idRead: "baselinequestion",
    }),
  } as Record<string, ContentCase>;

  it("GET /curriculum/:curriculumid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /curriculum/:curriculumid"])).toEqual([]);
  });
  it("GET /curriculum/:curriculumid/map answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /curriculum/:curriculumid/map"])).toEqual([]);
  });
  it("GET /grade/curriculum/:curriculumid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /grade/curriculum/:curriculumid"])).toEqual([]);
  });
  it("GET /grade/progress/curriculum/:curriculumid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /grade/progress/curriculum/:curriculumid"])).toEqual([]);
  });
  it("GET /grade/totalgradeprogress/:gradeid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /grade/totalgradeprogress/:gradeid"])).toEqual([]);
  });
  it("GET /level/grade/:gradeid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /level/grade/:gradeid"])).toEqual([]);
  });
  it("GET /level/progress/grade/:gradeid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /level/progress/grade/:gradeid"])).toEqual([]);
  });
  it("GET /Lesson/level/:levelid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /Lesson/level/:levelid"])).toEqual([]);
  });
  it("GET /Lesson/progress/level/:levelid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /Lesson/progress/level/:levelid"])).toEqual([]);
  });
  it("GET /Lesson/level/:levelid/steps answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /Lesson/level/:levelid/steps"])).toEqual([]);
  });
  it("GET /Lesson/:lessonid/progress answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /Lesson/:lessonid/progress"])).toEqual([]);
  });
  it("GET /Lesson/:lessonid/activities/progress answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /Lesson/:lessonid/activities/progress"])).toEqual([]);
  });
  it("POST /lesson/learning/:lessonlearningid/progress answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["POST /lesson/learning/:lessonlearningid/progress"])).toEqual([]);
  });
  it("GET /lesson/:lessonid/learning/progress answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /lesson/:lessonid/learning/progress"])).toEqual([]);
  });
  it("GET /lesson/learning/:lessonlearningid/progress answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /lesson/learning/:lessonlearningid/progress"])).toEqual([]);
  });
  it("GET /lesson/learning/:lessonlearningid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /lesson/learning/:lessonlearningid"])).toEqual([]);
  });
  it("GET /lesson/:lessonid/learning answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /lesson/:lessonid/learning"])).toEqual([]);
  });
  it("GET /lesson/plan/:lessonplanid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /lesson/plan/:lessonplanid"])).toEqual([]);
  });
  it("GET /question/lesson/:lessonid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /question/lesson/:lessonid"])).toEqual([]);
  });
  it("GET /question/level/:levelid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /question/level/:levelid"])).toEqual([]);
  });
  it("GET /question/practice/:lessonpracticeid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /question/practice/:lessonpracticeid"])).toEqual([]);
  });
  it("GET /question/quiz/:lessonquizid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /question/quiz/:lessonquizid"])).toEqual([]);
  });
  it("GET /question/baseline/:curriculumbaselineid answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /question/baseline/:curriculumbaselineid"])).toEqual([]);
  });
  it("GET /question/level/:levelid/answers answers X's own, and 404s Y's, a legacy one's and one that is not there alike", async () => {
    expect(await runContent(C["GET /question/level/:levelid/answers"])).toEqual([]);
  });
  it("POST /result/lesson/practice/:lessonpracticeid writes X's own result, and writes nothing for Y's, a legacy one's or one that is not there", async () => {
    expect(await runContent(C["POST /result/lesson/practice/:lessonpracticeid"])).toEqual([]);
  });
  it("POST /result/lesson/quiz/:lessonquizid writes X's own result, and writes nothing for Y's, a legacy one's or one that is not there", async () => {
    expect(await runContent(C["POST /result/lesson/quiz/:lessonquizid"])).toEqual([]);
  });
  it("POST /result/level/quiz/:levelid writes X's own result, and writes nothing for Y's, a legacy one's or one that is not there", async () => {
    expect(await runContent(C["POST /result/level/quiz/:levelid"])).toEqual([]);
  });
  it("POST /result/baseline/question/:curriculumbaselineid writes X's own result, and writes nothing for Y's, a legacy one's or one that is not there", async () => {
    expect(await runContent(C["POST /result/baseline/question/:curriculumbaselineid"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// lists: each caller gets the rows of its own scope and nothing else
// ---------------------------------------------------------------------------------------------------------
type Pick = (body: any) => string[]; // eslint-disable-line @typescript-eslint/no-explicit-any
const dataIds = (key: string): Pick => (body) => idsIn(body, key);
const libraryIds: Pick = (body) => (body?.data?.curricula ?? []).map((c: Row) => c.curriculumid);
const summaryIds: Pick = (body) => (body?.data?.curricula ?? []).map((c: Row) => c.curriculumid);
const sameSet = (a: string[], b: string[]): boolean => new Set(a).size === new Set(b).size && [...new Set(a)].every((x) => b.includes(x));

interface ListCase {
  path: string;
  pick: Pick;
  /** What each caller must get, by caller name. */
  gets: Array<[string, Auth, string[]]>;
  /** Requests with a query that tries to reach beyond the caller's scope. */
  queries?: Array<[string, Auth, string, string[]]>;
}
const runList = async (c: ListCase) => {
  const { failures, check } = scenario();
  for (const [name, auth, wanted] of c.gets) {
    const r = await send("get", c.path, auth);
    check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
    const got = c.pick(r.body);
    check(`${name} got ${JSON.stringify(got)} (wanted exactly ${JSON.stringify(wanted)})`, sameSet(got, wanted));
  }
  for (const [name, auth, query, wanted] of c.queries ?? []) {
    const r = await send("get", `${c.path}${query}`, auth);
    check(`${name} (${query}) -> ${r.status} (wanted 200)`, r.status === 200);
    const got = c.pick(r.body);
    check(`${name} (${query}) got ${JSON.stringify(got)} (wanted exactly ${JSON.stringify(wanted)})`, sameSet(got, wanted));
  }
  await refusedEverywhere(check, "get", c.path);
  return failures;
};

describe("list routes: the scope is the token's, and what the query names can only narrow it", () => {
  const X1 = T_X1.curriculum;
  const X2 = T_X2.curriculum;
  const Y1 = T_Y1.curriculum;
  const curriculumGets: Array<[string, Auth, string[]]> = [
    ["X learner (token claims Y's curriculum)", X_LEARNER, [X1]],
    ["X learner 2 (enrolled in a second one since sign-in)", X_LEARNER2, [X1, X2]],
    ["X teacher (the school's list)", X_TEACHER, [X1]],
    ["Y learner", Y_LEARNER, [Y1]],
    ["Y teacher", Y_TEACHER, [Y1]],
  ];

  it("GET /curriculum lists only the curricula in the caller's scope", async () => {
    expect(await runList({ path: "/curriculum", pick: dataIds("curriculumid"), gets: curriculumGets })).toEqual([]);
  });

  it("GET /curriculum/all lists only the curricula in the caller's scope; a learner, class or school the query names can only narrow it", async () => {
    expect(await runList({
      path: "/curriculum/all",
      pick: dataIds("curriculumid"),
      gets: curriculumGets,
      queries: [
        ["X learner asking for Y's school and learner", X_LEARNER, `?studentid=${ST_Y1}&schoolid=${SCH_Y}`, []],
        ["X learner asking for Y's learner (dropped: a learner is only about itself)", X_LEARNER, `?studentid=${ST_Y1}`, [X1]],
        ["X teacher naming the school's own id", X_TEACHER, `?schoolid=${SCH_X}`, [X1]],
        ["X teacher naming Y's school by name", X_TEACHER, "?schoolname=School%20Y", []],
        ["X teacher naming a class of Y's school", X_TEACHER, `?standardid=${CLS_Y}`, [X1]],
        ["X teacher naming a learner of its school who has two curricula (the school lists one)", X_TEACHER, `?studentid=${ST_X2}`, [X1]],
        ["X teacher naming a learner of Y's school", X_TEACHER, `?studentid=${ST_Y1}`, [X1]],
      ],
    })).toEqual([]);
  });

  it("GET /curriculum/subjects lists only the curricula the caller is enrolled in, read from the database, of the token's organisation", async () => {
    expect(await runList({
      path: "/curriculum/subjects",
      pick: dataIds("curriculumid"),
      gets: [
        ["X learner", X_LEARNER, [X1]],
        ["X learner 2", X_LEARNER2, [X1, X2]],
        ["Y learner", Y_LEARNER, [Y1]],
        ["X teacher (no learner record of its own)", X_TEACHER, []],
      ],
    })).toEqual([]);
  });

  it("GET /grade/all lists only the grades of curricula in the caller's scope; the curriculum, class or school named can only narrow it", async () => {
    expect(await runList({
      path: "/grade/all",
      pick: dataIds("gradeid"),
      gets: [
        ["X learner", X_LEARNER, [T_X1.grade]],
        ["X learner 2", X_LEARNER2, [T_X1.grade, T_X2.grade]],
        ["X teacher", X_TEACHER, [T_X1.grade]],
        ["Y teacher", Y_TEACHER, [T_Y1.grade]],
      ],
      queries: [
        ["X teacher asking for Y's curriculum", X_TEACHER, `?curid=${Y1}`, []],
        ["X teacher asking for a curriculum of X that the school does not list", X_TEACHER, `?curid=${X2}`, []],
        ["X teacher asking for its own curriculum", X_TEACHER, `?curid=${X1}`, [T_X1.grade]],
        ["X teacher asking for Y's school and a class", X_TEACHER, `?standardid=${CLS_Y}&schoolid=${SCH_Y}`, []],
      ],
    })).toEqual([]);
  });

  it("GET /level/all lists only the levels of grades of curricula in the caller's scope; the grade named can only narrow it", async () => {
    expect(await runList({
      path: "/level/all",
      pick: dataIds("levelid"),
      gets: [
        ["X learner", X_LEARNER, [T_X1.level]],
        ["X learner 2", X_LEARNER2, [T_X1.level, T_X2.level]],
        ["X teacher", X_TEACHER, [T_X1.level]],
        ["Y learner", Y_LEARNER, [T_Y1.level]],
      ],
      queries: [
        ["X teacher asking for Y's grade", X_TEACHER, `?gradeid=${T_Y1.grade}`, []],
        ["X teacher asking for its own grade", X_TEACHER, `?gradeid=${T_X1.grade}`, [T_X1.level]],
      ],
    })).toEqual([]);
  });

  it("GET /Lesson/all lists only the lessons of levels of curricula in the caller's scope; the level named can only narrow it", async () => {
    expect(await runList({
      path: "/Lesson/all",
      pick: dataIds("lessonid"),
      gets: [
        ["X learner", X_LEARNER, [T_X1.lesson]],
        ["X learner 2", X_LEARNER2, [T_X1.lesson, T_X2.lesson]],
        ["X teacher", X_TEACHER, [T_X1.lesson]],
        ["Y teacher", Y_TEACHER, [T_Y1.lesson]],
      ],
      queries: [
        ["X teacher asking for Y's level", X_TEACHER, `?levelid=${T_Y1.level}`, []],
        ["X teacher asking for a level of a curriculum the school does not list", X_TEACHER, `?levelid=${T_X2.level}`, []],
      ],
    })).toEqual([]);
  });

  it("GET /level/library lists only the curricula the learner is enrolled in (from the database), of the token's organisation", async () => {
    expect(await runList({
      path: "/level/library",
      pick: libraryIds,
      gets: [
        ["X learner (token claims Y's curriculum)", X_LEARNER, [X1]],
        ["X learner 2", X_LEARNER2, [X1, X2]],
        ["Y learner", Y_LEARNER, [Y1]],
        ["X teacher (no learner record of its own)", X_TEACHER, []],
      ],
    })).toEqual([]);
  });

  it("GET /student/progress/summary covers only the curricula the learner is enrolled in, of the token's organisation", async () => {
    expect(await runList({
      path: "/student/progress/summary",
      pick: summaryIds,
      gets: [
        ["X learner", X_LEARNER, [X1]],
        ["X learner 2", X_LEARNER2, [X1, X2]],
        ["Y learner", Y_LEARNER, [Y1]],
        ["X teacher", X_TEACHER, []],
      ],
    })).toEqual([]);
  });

  it("GET /student/progress answers for the token's own learner record, and a token with no proof of its organisation gets nothing", async () => {
    const { failures, check } = scenario();
    for (const [name, auth] of [["X learner", X_LEARNER], ["Y learner", Y_LEARNER], ["X teacher", X_TEACHER]] as Array<[string, Auth]>) {
      const r = await send("get", "/student/progress", auth);
      check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
    }
    reset();
    await send("get", "/student/progress", X_LEARNER);
    const learnerReads = reads.filter((x) => x.model === "students" && x.method === "findOne").map((x) => x.options?.where?.studentid);
    check(`X learner: only its own learner record was read (${learnerReads.join()})`, learnerReads.every((id) => id === ST_X1));
    await refusedEverywhere(check, "get", "/student/progress");
    expect(failures).toEqual([]);
  });

  it("GET /student/all lists only the learners of the token's school (admin only); a school the query names can only narrow that", async () => {
    const { failures, check } = scenario();
    const x = [ST_X1, ST_X2];
    for (const [name, query, wanted] of [
      ["no query", "", x],
      ["its own school by id", `?schoolid=${SCH_X}`, x],
      ["its own school by name", "?schoolname=School%20X", x],
      ["Y's school by id", `?schoolid=${SCH_Y}`, []],
      ["Y's school by name", "?schoolname=School%20Y", []],
      ["the legacy school by id", `?schoolid=${SCH_L}`, []],
      ["a school that is not there", `?schoolid=${NOWHERE}`, []],
    ] as Array<[string, string, string[]]>) {
      const r = await send("get", `/student/all${query}`, X_ADMIN);
      check(`X admin, ${name} -> ${r.status} (wanted 200)`, r.status === 200);
      check(`X admin, ${name}: got ${JSON.stringify(idsIn(r.body, "studentid"))}`, sameSet(idsIn(r.body, "studentid"), wanted));
    }
    for (const [name, auth] of [["X teacher", X_TEACHER], ["X learner", X_LEARNER]] as Array<[string, Auth]>) {
      const r = await send("get", "/student/all", auth);
      check(`${name} -> ${r.status} (wanted 403: admin and super admin only)`, r.status === 403);
    }
    await refusedEverywhere(check, "get", "/student/all");
    expect(failures).toEqual([]);
  });

  it("POST /student/profile changes only the token's own learner record", async () => {
    const { failures, check } = scenario();
    const before = snapshot();
    let r = await send("post", "/student/profile", X_LEARNER, { filename: "me.png" });
    check(`X learner -> ${r.status} (wanted 200)`, r.status === 200);
    const row = (id: string) => rowsOf(students).find((s) => s.studentid === id)!;
    check("X learner's own record has the new image", row(ST_X1).profileimage === "me.png");
    check("no other learner's record changed", [ST_X2, ST_Y1, ST_Y2, ST_Y3, ST_L1].every((id) => row(id).profileimage === null));
    r = await send("post", "/student/profile", X_TEACHER, { filename: "t.png" });
    check(`X teacher (no learner record) -> ${r.status} (wanted 400, nothing written)`, r.status === 400);
    check("no learner record changed for the teacher", [ST_X2, ST_Y1].every((id) => row(id).profileimage === null) && row(ST_X1).profileimage === "me.png");
    for (const [name, auth] of REFUSED_TOKENS) {
      const before2 = snapshot();
      r = await send("post", "/student/profile", auth, { filename: "z.png" });
      check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
      check(`${name}: nothing was written`, snapshot() === before2);
    }
    check("the before snapshot differs only by the one image", before !== snapshot());
    expect(failures).toEqual([]);
  });

  it("POST /access records usage for the token's own login only", async () => {
    const { failures, check } = scenario();
    const usage = (id: string) => rowsOf(studentappusages).find((u) => u.schooluserid === id)!.time_spent;
    const body = { starttime: "2026-01-01T10:00:00Z", endtime: "2026-01-01T10:05:00Z" };
    const r = await send("post", "/access", X_LEARNER, body);
    check(`X learner -> ${r.status} (wanted 200)`, r.status === 200);
    check("X learner's own usage grew", usage(SU_X1) > 60);
    check("nobody else's usage changed", [SU_X2, SU_Y1, SU_L1].every((id) => usage(id) === 60));
    for (const [name, auth] of REFUSED_TOKENS) {
      const before = snapshot();
      const refused = await send("post", "/access", auth, body);
      check(`${name} -> ${refused.status} (wanted 401)`, refused.status === 401);
      check(`${name}: nothing was written`, snapshot() === before);
    }
    expect(failures).toEqual([]);
  });

  it("GET /access lists the usage of the caller's own login (a learner) or of the learners of its school (staff), never another school's", async () => {
    expect(await runList({
      path: "/access",
      pick: dataIds("schooluserid"),
      gets: [
        ["X learner", X_LEARNER, [SU_X1]],
        ["X teacher", X_TEACHER, [SU_X1, SU_X2]],
        ["Y teacher", Y_TEACHER, [SU_Y1]],
        ["Y learner", Y_LEARNER, [SU_Y1]],
      ],
    })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// people routes (teacher/*)
// ---------------------------------------------------------------------------------------------------------
describe("teacher routes: only the learners of the token's school", () => {
  const bothStaffRefused = async (check: (what: string, ok: unknown) => void, method: Method, path: string, body?: unknown) => {
    const r = await send(method, path, X_LEARNER, body);
    check(`X learner -> ${r.status} (wanted 403: staff only)`, r.status === 403);
    await refusedEverywhere(check, method, path, body);
  };

  it("GET /teacher/standards lists the classes of the token's school's learners only", () =>
    (async () => {
      const { failures, check } = scenario();
      // (the classes the school's own learners hold: the rogue learner of Y holds a class of X, so that value is listed for Y, and no learner of X is read)
      for (const [name, auth, wanted] of [["X teacher", X_TEACHER, [CLS_X]], ["X admin", X_ADMIN, [CLS_X]], ["Y teacher", Y_TEACHER, [CLS_Y, CLS_X]]] as Array<[string, Auth, string[]]>) {
        const r = await send("get", "/teacher/standards", auth);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name} got ${JSON.stringify(idsIn(r.body, "standard"))}`, sameSet(idsIn(r.body, "standard"), wanted));
      }
      await bothStaffRefused(check, "get", "/teacher/standards");
      expect(failures).toEqual([]);
    })());

  it("GET /teacher/stats counts only the token's school's learners", () =>
    (async () => {
      const { failures, check } = scenario();
      for (const [name, auth, total] of [["X teacher", X_TEACHER, 2], ["Y teacher", Y_TEACHER, 4]] as Array<[string, Auth, number]>) {
        const r = await send("get", "/teacher/stats", auth);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name} counted ${r.body?.data?.total} (wanted ${total})`, r.body?.data?.total === total);
      }
      await bothStaffRefused(check, "get", "/teacher/stats");
      expect(failures).toEqual([]);
    })());

  it("GET /teacher/students lists only the learners of the token's school", () =>
    (async () => {
      const { failures, check } = scenario();
      for (const [name, auth, wanted] of [
        ["X teacher", X_TEACHER, [ST_X1, ST_X2]],
        ["X admin", X_ADMIN, [ST_X1, ST_X2]],
        ["Y teacher", Y_TEACHER, [ST_Y1, ST_Y2, ST_Y3, ST_R]],
      ] as Array<[string, Auth, string[]]>) {
        const r = await send("get", "/teacher/students", auth);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name} got ${JSON.stringify(idsIn(r.body, "studentid"))}`, sameSet(idsIn(r.body, "studentid"), wanted));
      }
      await bothStaffRefused(check, "get", "/teacher/students");
      expect(failures).toEqual([]);
    })());

  it("GET /teacher/profile counts the learners of a class of the token's school; a class of another school is an unknown class", () =>
    (async () => {
      const { failures, check } = scenario();
      for (const [name, auth, cls, wanted] of [
        ["X teacher, own class", X_TEACHER, CLS_X, 2],
        ["X teacher, Y's class", X_TEACHER, CLS_Y, 0],
        ["X teacher, a class that is not there", X_TEACHER, NOWHERE, 0],
        ["Y teacher, own class", Y_TEACHER, CLS_Y, 3],
        ["Y teacher, X's class (a learner of Y's holds it, but it is not Y's class)", Y_TEACHER, CLS_X, 0],
      ] as Array<[string, Auth, string, number]>) {
        const r = await send("get", `/teacher/profile?standard=${cls}`, auth);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name}: ${r.body?.data?.numberofstudents} learners (wanted ${wanted})`, r.body?.data?.numberofstudents === wanted);
      }
      await bothStaffRefused(check, "get", `/teacher/profile?standard=${CLS_X}`);
      expect(failures).toEqual([]);
    })());

  const statsRoute = (suffix: string) => async () => {
    const { failures, check } = scenario();
    const path = (id: string) => `/teacher/stats/student/${id}${suffix}`;
    reset();
    let r = await send("get", path(ST_X1), X_TEACHER);
    check(`X teacher, own learner -> ${r.status} (wanted 200)`, r.status === 200);
    check(`X teacher, own learner: the statistics were read for that learner (${JSON.stringify(rawQueries.map((q) => q.replacements))})`, rawQueries.length === 1 && rawQueries[0].replacements[0] === ST_X1);
    const absent = await send("get", path(NOWHERE), X_TEACHER);
    check(`X teacher, a learner that is not there -> ${absent.status} (wanted 400)`, absent.status === 400);
    reset();
    for (const [name, auth, id] of [
      ["X teacher, Y's learner", X_TEACHER, ST_Y1],
      ["X teacher, the legacy school's learner", X_TEACHER, ST_L1],
      ["Y teacher, X's learner", Y_TEACHER, ST_X1],
    ] as Array<[string, Auth, string]>) {
      r = await send("get", path(id), auth);
      check(`${name} -> ${r.status} (wanted 400)`, r.status === 400);
      check(`${name}: the answer is the one for a learner that is not there`, text(r.body) === text(absent.body));
    }
    check(`no statistics were read for a learner of another school (${JSON.stringify(rawQueries.map((q) => q.replacements))})`, rawQueries.length === 0);
    await bothStaffRefused(check, "get", path(ST_X1));
    return failures;
  };
  it("GET /teacher/stats/student/:studentid answers for a learner of the token's school only, and a learner of another school is an unknown learner", async () => {
    expect(await statsRoute("")()).toEqual([]);
  });
  it("GET /teacher/stats/student/:studentid/practice answers for a learner of the token's school only, and a learner of another school is an unknown learner", async () => {
    expect(await statsRoute("/practice")()).toEqual([]);
  });
  it("GET /teacher/stats/student/:studentid/quiz answers for a learner of the token's school only, and a learner of another school is an unknown learner", async () => {
    expect(await statsRoute("/quiz")()).toEqual([]);
  });
  it("GET /teacher/stats/student/:studentid/level answers for a learner of the token's school only, and a learner of another school is an unknown learner", async () => {
    expect(await statsRoute("/level")()).toEqual([]);
  });

  it("GET /teacher/standard/all lists only the classes of the token's school", () =>
    (async () => {
      const { failures, check } = scenario();
      for (const [name, auth, wanted] of [["X teacher", X_TEACHER, [CLS_X]], ["Y teacher", Y_TEACHER, [CLS_Y]]] as Array<[string, Auth, string[]]>) {
        const r = await send("get", "/teacher/standard/all", auth);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name} got ${JSON.stringify(idsIn(r.body, "standardid"))}`, sameSet(idsIn(r.body, "standardid"), wanted));
      }
      await bothStaffRefused(check, "get", "/teacher/standard/all");
      expect(failures).toEqual([]);
    })());

  it("POST /teacher/studentprogress lists only the token's school's learners, whatever class is asked for, and a foreign class is an unknown class", () =>
    (async () => {
      const { failures, check } = scenario();
      const cls = (id: string) => ({ filter: [{ key: "standard", value: id }] });
      const rows = async (auth: Auth, body: unknown) => {
        const r = await send("post", "/teacher/studentprogress", auth, body);
        return { status: r.status, ids: idsIn(r.body, "studentid"), total: r.body?.data?.total, body: r.body };
      };
      for (const [name, auth, body, wanted] of [
        ["X teacher, no class", X_TEACHER, {}, [ST_X1, ST_X2]],
        ["X teacher, its own class", X_TEACHER, cls(CLS_X), [ST_X1, ST_X2]],
        ["Y teacher, no class", Y_TEACHER, {}, [ST_Y1, ST_Y2, ST_Y3]],
        ["Y teacher, its own class", Y_TEACHER, cls(CLS_Y), [ST_Y1, ST_Y2, ST_Y3]],
        ["X teacher, its own class (a learner of Y holds the same class id, and is not listed)", X_TEACHER, cls(CLS_X), [ST_X1, ST_X2]],
      ] as Array<[string, Auth, unknown, string[]]>) {
        const r = await rows(auth, body);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name} got ${JSON.stringify(r.ids)}`, sameSet(r.ids, wanted));
      }
      const unknown = await rows(X_TEACHER, cls(NOWHERE));
      check(`X teacher, a class that is not there -> ${unknown.status} with ${unknown.ids.length} learners, total ${unknown.total}`, unknown.status === 200 && unknown.ids.length === 0 && unknown.total === 0);
      for (const [name, auth, body] of [
        ["X teacher, Y's class", X_TEACHER, cls(CLS_Y)],
        ["X teacher, the legacy school's class", X_TEACHER, cls(CLS_L)],
        ["Y teacher, X's class (a learner of Y's holds it, but it is not Y's class)", Y_TEACHER, cls(CLS_X)],
      ] as Array<[string, Auth, unknown]>) {
        const r = await rows(auth, body);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name}: the answer is the one for an unknown class`, text(r.body) === text(unknown.body));
      }
      await bothStaffRefused(check, "post", "/teacher/studentprogress", {});
      expect(failures).toEqual([]);
    })());

  it("GET /teacher/studentinfo answers for a learner of the token's school only; any other is no learner", () =>
    (async () => {
      const { failures, check } = scenario();
      const info = (id: string, auth: Auth) => send("get", `/teacher/studentinfo?studentid=${id}`, auth);
      const own = await info(ST_X1, X_TEACHER);
      check(`X teacher, own learner -> ${own.status} (wanted 200)`, own.status === 200);
      check(`X teacher, own learner: got ${own.body?.data?.studentid}`, own.body?.data?.studentid === ST_X1);
      const absent = await info(NOWHERE, X_TEACHER);
      check(`X teacher, a learner that is not there -> ${absent.status} with ${JSON.stringify(absent.body?.data)}`, absent.status === 200 && absent.body?.data === null);
      for (const [name, auth, id] of [
        ["X teacher, Y's learner", X_TEACHER, ST_Y1],
        ["X teacher, the legacy school's learner", X_TEACHER, ST_L1],
        ["Y teacher, X's learner", Y_TEACHER, ST_X1],
      ] as Array<[string, Auth, string]>) {
        const r = await info(id, auth);
        check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
        check(`${name}: the answer is the one for a learner that is not there`, text(r.body) === text(absent.body));
      }
      await bothStaffRefused(check, "get", `/teacher/studentinfo?studentid=${ST_X1}`);
      expect(failures).toEqual([]);
    })());
});

// ---------------------------------------------------------------------------------------------------------
// the baseline: the learner and school are the token's
// ---------------------------------------------------------------------------------------------------------
describe("the baseline routes", () => {
  const baseline = (curriculumid: string, school: string, studentid: string, auth: Auth) =>
    send("post", `/curriculum/baseline/${curriculumid}/${encodeURIComponent(school)}/${studentid}`, auth, { date: String(Date.now()) });

  it("POST /curriculum/baseline/:curriculumid/:schoolname/:studentid takes the learner and school from the token; the path can neither widen it nor change whose progress is read", async () => {
    const { failures, check } = scenario();
    const own = await baseline(T_X1.curriculum, "School X", ST_X1, X_LEARNER);
    check(`X learner, own curriculum -> ${own.status} (wanted 200)`, own.status === 200);
    check(`X learner: the baseline of the school (${JSON.stringify(own.body?.data)})`, own.body?.data?.curriculumbaselineid === T_X1.baseline && own.body?.data?.baselinepass === true);
    // the school named in the path is not read
    for (const name of ["School Y", "Legacy School", "Nowhere School"]) {
      const r = await baseline(T_X1.curriculum, name, ST_X1, X_LEARNER);
      check(`X learner, path school "${name}": the same answer as for its own school`, r.status === 200 && text(r.body) === text(own.body));
    }
    // the learner named in the path is not read
    reset();
    await baseline(T_X1.curriculum, "School X", ST_Y1, X_LEARNER);
    const asked = reads.filter((x) => x.model === "studentprogress" && x.method === "findOne").map((x) => x.options?.where?.studentid);
    check(`X learner naming Y's learner in the path: progress was read for ${JSON.stringify(asked)} (wanted only its own)`, asked.length > 0 && asked.every((id) => id === ST_X1));
    // another organisation's curriculum is absent
    const absent = await baseline(NOWHERE, "School X", ST_X1, X_LEARNER);
    check(`X learner, a curriculum that is not there -> ${absent.status} (wanted 404)`, absent.status === 404);
    for (const [name, auth, id] of [
      ["X learner, Y's curriculum", X_LEARNER, T_Y1.curriculum],
      ["X learner, a legacy curriculum", X_LEARNER, T_L.curriculum],
      ["X learner, X's curriculum it is not enrolled in", X_LEARNER, T_X2.curriculum],
      ["X teacher, Y's curriculum", X_TEACHER, T_Y1.curriculum],
      ["Y learner, X's curriculum", Y_LEARNER, T_X1.curriculum],
    ] as Array<[string, Auth, string]>) {
      const r = await baseline(id, "School X", ST_X1, auth);
      check(`${name} -> ${r.status} (wanted 404)`, r.status === 404);
      check(`${name}: the answer is the one for a curriculum that is not there`, text(r.body) === text(absent.body));
    }
    // a teacher may ask about a learner, but only one of its school
    reset();
    const teacherOwn = await baseline(T_X1.curriculum, "School X", ST_X1, X_TEACHER);
    check(`X teacher, a learner of its school -> ${teacherOwn.status}, pass ${teacherOwn.body?.data?.baselinepass} (wanted 200, true)`, teacherOwn.status === 200 && teacherOwn.body?.data?.baselinepass === true);
    reset();
    const teacherOther = await baseline(T_X1.curriculum, "School X", ST_Y1, X_TEACHER);
    check(`X teacher, Y's learner -> ${teacherOther.status}, pass ${teacherOther.body?.data?.baselinepass} (wanted 200, false)`, teacherOther.status === 200 && teacherOther.body?.data?.baselinepass === false);
    check("X teacher, Y's learner: no progress of Y's learner was read", reads.every((x) => !(x.model === "studentprogress" && x.options?.where?.studentid === ST_Y1)));
    // the symmetric case
    const y = await baseline(T_Y1.curriculum, "School X", ST_Y1, Y_LEARNER);
    check(`Y learner, own curriculum -> ${y.status}, baseline ${y.body?.data?.curriculumbaselineid} (wanted Y's)`, y.status === 200 && y.body?.data?.curriculumbaselineid === T_Y1.baseline);
    for (const [name, auth] of REFUSED_TOKENS) {
      const r = await baseline(T_X1.curriculum, "School X", ST_X1, auth);
      check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
    }
    expect(failures).toEqual([]);
  });

  it("GET /curriculum/:curriculumbaselineid/getstudentresult answers for a baseline of a curriculum in scope, and only learners of the scope's schools", async () => {
    const { failures, check } = scenario();
    const path = (id: string) => `/curriculum/${id}/getstudentresult`;
    const rowsFor = (r: { body: any }) => (Array.isArray(r.body) ? r.body : []).map((x: Row) => x.studentid); // eslint-disable-line @typescript-eslint/no-explicit-any
    const progressRead = () => reads.filter((x) => x.model === "studentprogress" && x.method === "findAll");

    reset();
    let r = await send("get", path(T_X1.baseline), SERVER_X);
    check(`server key + X's header, X's baseline -> ${r.status} with ${JSON.stringify(rowsFor(r))} (wanted 200, X's learner)`, r.status === 200 && sameSet(rowsFor(r), [ST_X2]));
    const include = progressRead()[0]?.options?.include?.[0]?.where;
    check("server key + X's header: the learners joined to the results are limited to X's schools", include?.schoolid?.[Op.in]?.join() === SCH_X);

    reset();
    r = await send("get", path(T_Y1.baseline), SERVER_X);
    check(`server key + X's header, Y's baseline -> ${r.status} with ${JSON.stringify(rowsFor(r))} (wanted 200, nothing)`, r.status === 200 && rowsFor(r).length === 0);
    check("server key + X's header, Y's baseline: no result was read", progressRead().length === 0);
    const absent = await send("get", path(NOWHERE), SERVER_X);
    check("server key + X's header: Y's baseline answers as one that is not there", text(r.body) === text(absent.body));

    reset();
    r = await send("get", path(T_Y1.baseline), SERVER_PLATFORM);
    check(`server key + header platform, Y's baseline -> ${rowsFor(r).join()} (wanted Y's learner: platform is unscoped)`, r.status === 200 && sameSet(rowsFor(r), [ST_Y1]));
    reset();
    r = await send("get", path(T_Y1.baseline), SERVER_NOHEADER);
    check(`server key, no header, Y's baseline -> ${r.status} (wanted 400: silence is not the platform)`, r.status === 400);
    check("server key, no header: no result was read", progressRead().length === 0);

    for (const [name, auth, id, wanted] of [
      ["X teacher, X's baseline", X_TEACHER, T_X1.baseline, [ST_X2]],
      ["X teacher, Y's baseline", X_TEACHER, T_Y1.baseline, []],
      ["X teacher, a baseline of X's curriculum that the school does not list", X_TEACHER, T_X2.baseline, []],
      ["Y teacher, X's baseline", Y_TEACHER, T_X1.baseline, []],
      ["X admin, Y's baseline", X_ADMIN, T_Y1.baseline, []],
    ] as Array<[string, Auth, string, string[]]>) {
      r = await send("get", path(id), auth);
      check(`${name} -> ${r.status} with ${JSON.stringify(rowsFor(r))}`, r.status === 200 && sameSet(rowsFor(r), wanted));
    }
    r = await send("get", path(T_X1.baseline), X_LEARNER);
    check(`X learner -> ${r.status} (wanted 403: staff only)`, r.status === 403);
    for (const bad of ["", "not an id!", "a".repeat(40), "PLATFORM", "Platform", "platforms", "platform;"]) {
      r = await send("get", path(T_X1.baseline), { key: true, org: bad });
      check(`server key + header "${bad}" -> ${r.status} (wanted 400)`, r.status === 400);
    }
    for (const [name, auth] of REFUSED_TOKENS.filter(([n]) => n !== "a token with no claims (learner)")) {
      r = await send("get", path(T_X1.baseline), auth);
      check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// what central proxies: the organisation header, and a token's own school
// ---------------------------------------------------------------------------------------------------------
describe("report-style routes: the scope is X's header (central), or the token's school", () => {
  // (the marker is exact: another case of it, or something after it, is not the marker)
  const BAD_HEADERS = ["", "   ", "not an id!", "a".repeat(40), "1; DROP TABLE students", "PLATFORM", "Platform", "platforms", "platform;"];

  it("POST /student/logintime answers only for logins in the scope; a learner token is only about itself", async () => {
    const { failures, check } = scenario();
    const ask = async (auth: Auth, ids: string[]) => {
      reset();
      const r = await send("post", "/student/logintime", auth, ids);
      return { status: r.status, asked: rawQueries.flatMap((q) => q.replacements as string[]), queries: rawQueries.length };
    };
    for (const [name, auth, body, wanted] of [
      ["server key + X's header, a mixed list", SERVER_X, [SU_X1, SU_Y1, SU_L1, SU_TY], [SU_X1]],
      ["server key + X's header, only Y's logins", SERVER_X, [SU_Y1, SU_Y2], []],
      ["server key + X's header, X's own two", SERVER_X, [SU_X1, SU_X2], [SU_X1, SU_X2]],
      ["server key + header platform (unscoped)", SERVER_PLATFORM, [SU_X1, SU_Y1], [SU_X1, SU_Y1]],
      ["server key + a header for an organisation that is not here", { key: true, org: uid("99", 1) } as Auth, [SU_X1, SU_Y1], []],
      ["X teacher, a mixed list", X_TEACHER, [SU_X1, SU_Y1, SU_TY, SU_TX], [SU_X1, SU_TX]],
      ["X teacher with a header naming Y (ignored: the token decides)", X_TEACHER, [SU_X1, SU_Y1], [SU_X1]],
      ["Y teacher, a mixed list", Y_TEACHER, [SU_X1, SU_Y1], [SU_Y1]],
      ["X learner, a list of other people's logins and its own", X_LEARNER, [SU_X2, SU_Y1, SU_X1], [SU_X1]],
      ["X learner, only other people's logins", X_LEARNER, [SU_X2, SU_Y1], []],
    ] as Array<[string, Auth, string[], string[]]>) {
      const headers: Record<string, string> = name.includes("header naming Y") ? { "X-Organisation-Id": ORG_Y } : {};
      reset();
      const r = await send("post", "/student/logintime", auth, body, headers);
      const asked = rawQueries.flatMap((q) => q.replacements as string[]);
      check(`${name} -> ${r.status} (wanted 200)`, r.status === 200);
      check(`${name}: logins asked of the database ${JSON.stringify(asked)} (wanted ${JSON.stringify(wanted)})`, sameSet(asked, wanted));
      if (wanted.length === 0) check(`${name}: no query was made at all`, rawQueries.length === 0);
    }
    const silent = await ask(SERVER_NOHEADER, [SU_X1, SU_Y1]);
    check(`server key, no header -> ${silent.status} (wanted 400: silence is not the platform)`, silent.status === 400);
    check("server key, no header: nothing was asked of the database", silent.queries === 0);
    for (const bad of BAD_HEADERS) {
      const r = await ask({ key: true, org: bad }, [SU_X1]);
      check(`server key + header "${bad}" -> ${r.status} (wanted 400)`, r.status === 400);
      check(`server key + header "${bad}": nothing was asked of the database`, r.queries === 0);
    }
    await refusedEverywhere(check, "post", "/student/logintime", [SU_X1]);
    expect(failures).toEqual([]);
  });

  it("GET /report/offlineonline counts only learners of the scope's schools; a school named in the query can only narrow it", async () => {
    const { failures, check } = scenario();
    const count = async (auth: Auth, query: string, headers: Record<string, string> = {}) => {
      const r = await send("get", `/report/offlineonline${query}`, auth, undefined, headers);
      return { status: r.status, value: r.body?.data?.value };
    };
    for (const [name, auth, query, wanted] of [
      ["X teacher", X_TEACHER, "", 2],
      ["X teacher, its own school", X_TEACHER, `?schoolid=${SCH_X}`, 2],
      ["X teacher, Y's school", X_TEACHER, `?schoolid=${SCH_Y}`, 0],
      ["X teacher, Y's school by name", X_TEACHER, "?schoolname=School%20Y", 0],
      ["Y teacher", Y_TEACHER, "", 4],
      ["Y teacher, X's school", Y_TEACHER, `?schoolid=${SCH_X}`, 0],
      ["X admin", X_ADMIN, "", 2],
    ] as Array<[string, Auth, string, number]>) {
      const r = await count(auth, query);
      check(`${name} -> ${r.status}, ${r.value} (wanted 200, ${wanted})`, r.status === 200 && r.value === wanted);
    }
    let r = await count(X_TEACHER, "", { "X-Organisation-Id": ORG_Y });
    check(`X teacher with a header naming Y (ignored) -> ${r.value} (wanted 2)`, r.value === 2);
    r = await send("get", "/report/offlineonline", X_LEARNER).then((x) => ({ status: x.status, value: x.body?.data?.value }));
    check(`X learner -> ${r.status} (wanted 403: staff only)`, r.status === 403);
    await refusedEverywhere(check, "get", "/report/offlineonline");
    expect(failures).toEqual([]);
  });

  // The reports central proxies. Each reads the learners, class or school its body names; whatever the body
  // names, the rows must be inside the scope.
  interface ReportCase {
    path: string;
    /** The filter keys the route reads to find learners. */
    reads: Array<"studentid" | "standard" | "schoolid">;
    /** Does the list answer carry learners (so the rows can be read from the answer)? */
    listsLearners?: boolean;
  }
  const bodyOf = (key: string, value: string | string[]) => ({ pageindex: 1, pagesize: 50, filter: [{ key, value }] });
  const OWN: Record<string, { value: string; learners: string[] }> = {
    studentid: { value: ST_X1, learners: [ST_X1] },
    standard: { value: CLS_X, learners: [ST_X1, ST_X2] },
    schoolid: { value: SCH_X, learners: [ST_X1, ST_X2] },
  };
  const OTHER: Record<string, { value: string | string[]; learners: string[] }> = {
    studentid: { value: ST_Y1, learners: [ST_Y1] },
    standard: { value: CLS_Y, learners: [ST_Y1, ST_Y2, ST_Y3] },
    schoolid: { value: SCH_Y, learners: [ST_Y1, ST_Y2, ST_Y3, ST_R] },
  };
  const subset = (got: Set<string>, allowed: string[]): boolean => [...got].every((id) => allowed.includes(id));

  const runReport = async (c: ReportCase) => {
    const { failures, check } = scenario();
    const run = async (auth: Auth, body: unknown, headers: Record<string, string> = {}) => {
      reset();
      const r = await send("post", c.path, auth, body, headers);
      return { status: r.status, seen: new Set(seen), body: r.body };
    };
    const X_LEARNERS = [ST_X1, ST_X2];
    for (const key of c.reads) {
      const own = bodyOf(key, OWN[key].value);
      const other = bodyOf(key, OTHER[key].value);
      let r = await run(SERVER_X, own);
      check(`[${key}] server key + X's header, X's ${key} -> ${r.status} (wanted 200)`, r.status === 200);
      check(`[${key}] server key + X's header, X's ${key}: read ${JSON.stringify([...r.seen])} (wanted X's learners, some)`, r.seen.size > 0 && subset(r.seen, X_LEARNERS));
      r = await run(SERVER_X, other);
      check(`[${key}] server key + X's header, Y's ${key} -> ${r.status} (wanted 200)`, r.status === 200);
      check(`[${key}] server key + X's header, Y's ${key}: read ${JSON.stringify([...r.seen])} (wanted no learner of Y)`, r.seen.size === 0);
      r = await run(SERVER_X, bodyOf(key, key === "studentid" ? [ST_X1, ST_Y1] : [OWN[key].value, OTHER[key].value as string]));
      check(`[${key}] server key + X's header, both X's and Y's ${key}: read ${JSON.stringify([...r.seen])} (wanted X's learners only)`, r.status === 200 && subset(r.seen, X_LEARNERS));
      if (key === "studentid" || key === "standard") {
        // a report is about one learner or one class: a filter that names one of Y's is outside the scope, whole (the empty answer)
        check(`[${key}] server key + X's header, X's and Y's ${key} together: read ${JSON.stringify([...r.seen])} (wanted nothing)`, r.seen.size === 0);
      }
      if (key === "studentid") {
        for (const odd of [42, { x: 1 }, [ST_X1], [ST_X1, ST_X1]]) {
          r = await run(SERVER_X, bodyOf(key, odd as never));
          check(`[${key}] server key + X's header, studentid ${JSON.stringify(odd)} (not one text): read ${JSON.stringify([...r.seen])} (wanted nothing)`, r.status === 200 && r.seen.size === 0);
          r = await run(X_TEACHER, bodyOf(key, odd as never));
          check(`[${key}] X teacher, studentid ${JSON.stringify(odd)} (not one text): read ${JSON.stringify([...r.seen])} (wanted nothing)`, r.status === 200 && r.seen.size === 0);
        }
        // another school's learner is outside a teacher's scope
        r = await run(X_TEACHER, bodyOf(key, ST_Y1));
        check(`[${key}] X teacher, Y's learner: read ${JSON.stringify([...r.seen])} (wanted nothing)`, r.status === 200 && r.seen.size === 0);
      }
      r = await run(SERVER_PLATFORM, other);
      check(`[${key}] server key + header platform, Y's ${key}: read ${JSON.stringify([...r.seen])} (pinned: unscoped, so Y's learners)`, r.status === 200 && r.seen.size > 0 && subset(r.seen, OTHER[key].learners));
      r = await run(SERVER_NOHEADER, other);
      check(`[${key}] server key, no header, Y's ${key} -> ${r.status}, read ${JSON.stringify([...r.seen])} (wanted 400 and nothing read: silence is not the platform)`, r.status === 400 && r.seen.size === 0);
      r = await run(SERVER_NOHEADER, own);
      check(`[${key}] server key, no header, X's ${key} -> ${r.status} (wanted 400)`, r.status === 400);
      r = await run(X_TEACHER, own);
      check(`[${key}] X teacher, X's ${key}: read ${JSON.stringify([...r.seen])} (wanted X's learners, some)`, r.status === 200 && r.seen.size > 0 && subset(r.seen, X_LEARNERS));
      r = await run(X_TEACHER, other);
      check(`[${key}] X teacher, Y's ${key}: read ${JSON.stringify([...r.seen])} (wanted none)`, r.status === 200 && r.seen.size === 0);
      r = await run(X_TEACHER, other, { "X-Organisation-Id": ORG_Y });
      check(`[${key}] X teacher, Y's ${key}, with a header naming Y (ignored): read ${JSON.stringify([...r.seen])} (wanted none)`, r.status === 200 && r.seen.size === 0);
      r = await run(Y_TEACHER, bodyOf(key, OWN[key].value));
      check(`[${key}] Y teacher, X's ${key}: read ${JSON.stringify([...r.seen])} (wanted none)`, r.status === 200 && r.seen.size === 0);
      r = await run({ key: true, org: uid("99", 1) }, own);
      check(`[${key}] server key + a header for an organisation that is not here, X's ${key}: read ${JSON.stringify([...r.seen])} (wanted none)`, r.status === 200 && r.seen.size === 0);
    }
    // a body that names nothing is answered inside the scope too (never the fixed test learner of another school)
    // (a report that cannot answer without a learner or class, and is given none, answers "not found" when the fixed test learner is not in scope)
    let r = await run(SERVER_X, { pageindex: 1, pagesize: 50, filter: [] });
    check(`server key + X's header, no filter: -> ${r.status}, read ${JSON.stringify([...r.seen])} (wanted X's learners only)`, [200, 404].includes(r.status) && subset(r.seen, X_LEARNERS));
    r = await run(X_TEACHER, {});
    check(`X teacher, an empty body: -> ${r.status}, read ${JSON.stringify([...r.seen])} (wanted X's learners only)`, [200, 404].includes(r.status) && subset(r.seen, X_LEARNERS));
    // content a body names must be the scope's too: another organisation's curriculum, grade, level or lesson is not asked about
    for (const [what, key, value, own] of [
      ["Y's curriculum", "curriculumid", T_Y1.curriculum, T_X1.curriculum],
      ["Y's grade", "gradeid", T_Y1.grade, T_X1.grade],
      ["Y's level", "levelid", T_Y1.level, T_X1.level],
      ["Y's lesson", "lessonid", T_Y1.lesson, T_X1.lesson],
    ] as Array<[string, string, string, string]>) {
      const base = { pageindex: 1, pagesize: 50, filter: [{ key: c.reads[0], value: OWN[c.reads[0]].value }] };
      r = await run(SERVER_X, { ...base, filter: [...base.filter, { key, value }] });
      check(`server key + X's header, X's ${c.reads[0]} with ${what}: read ${JSON.stringify([...r.seen])} (wanted nothing: the content is not X's)`, r.status === 200 && r.seen.size === 0);
      r = await run(SERVER_X, { ...base, filter: [...base.filter, { key, value: own }] });
      check(`server key + X's header, X's ${c.reads[0]} with X's own ${key}: read ${JSON.stringify([...r.seen])} (wanted X's learners)`, r.status === 200 && r.seen.size > 0);
      r = await run(X_TEACHER, { ...base, filter: [...base.filter, { key, value }] });
      check(`X teacher, X's ${c.reads[0]} with ${what}: read ${JSON.stringify([...r.seen])} (wanted nothing)`, r.status === 200 && r.seen.size === 0);
    }
    // a malformed header is refused, not read as the platform (the marker is exact)
    for (const bad of BAD_HEADERS) {
      r = await run({ key: true, org: bad }, bodyOf(c.reads[0], OTHER[c.reads[0]].value));
      check(`server key + header "${bad}" -> ${r.status} (wanted 400)`, r.status === 400);
      check(`server key + header "${bad}": nothing was read`, r.seen.size === 0);
    }
    r = await run(X_LEARNER, bodyOf(c.reads[0], OWN[c.reads[0]].value));
    check(`X learner -> ${r.status} (wanted 403: staff only)`, r.status === 403);
    for (const [name, auth] of REFUSED_TOKENS) {
      r = await run(auth, bodyOf(c.reads[0], OWN[c.reads[0]].value));
      check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
    }
    return failures;
  };

  const REPORTS: Record<string, ReportCase> = {
    "POST /report/studentprogress": { path: "/report/studentprogress", reads: ["studentid", "standard"] },
    "POST /report/studentprogress/download": { path: "/report/studentprogress/download", reads: ["studentid", "standard"] },
    "POST /report/studentprogress/class": { path: "/report/studentprogress/class", reads: ["standard"] },
    "POST /report/studentprogress/class/download": { path: "/report/studentprogress/class/download", reads: ["standard"] },
    "POST /report/studentlastcompletedquiz": { path: "/report/studentlastcompletedquiz", reads: ["studentid", "standard"] },
    "POST /report/studentlastcompletedquiz/download": { path: "/report/studentlastcompletedquiz/download", reads: ["studentid", "standard"] },
    "POST /report/studentlevelquiz": { path: "/report/studentlevelquiz", reads: ["studentid"] },
    "POST /report/studentlevelquiz/download": { path: "/report/studentlevelquiz/download", reads: ["studentid"] },
    "POST /report/studentlevelquiz/class": { path: "/report/studentlevelquiz/class", reads: ["standard"] },
    "POST /report/studentlevelquiz/class/download": { path: "/report/studentlevelquiz/class/download", reads: ["standard"] },
    "POST /report/studentstatus": { path: "/report/studentstatus", reads: ["schoolid"] },
    "POST /report/studentstatus/download": { path: "/report/studentstatus/download", reads: ["schoolid"] },
    "POST /report/student-grade-progress": { path: "/report/student-grade-progress", reads: ["standard"] },
    "POST /report/student-level-progress": { path: "/report/student-level-progress", reads: ["studentid"] },
    "POST /report/student-lesson-progress": { path: "/report/student-lesson-progress", reads: ["studentid"] },
  };

  it("POST /report/studentprogress reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentprogress"])).toEqual([]);
  });
  it("POST /report/studentprogress/download reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentprogress/download"])).toEqual([]);
  });
  it("POST /report/studentprogress/class reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentprogress/class"])).toEqual([]);
  });
  it("POST /report/studentprogress/class/download reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentprogress/class/download"])).toEqual([]);
  });
  it("POST /report/studentlastcompletedquiz reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentlastcompletedquiz"])).toEqual([]);
  });
  it("POST /report/studentlastcompletedquiz/download reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentlastcompletedquiz/download"])).toEqual([]);
  });
  it("POST /report/studentlevelquiz reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentlevelquiz"])).toEqual([]);
  });
  it("POST /report/studentlevelquiz/download reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentlevelquiz/download"])).toEqual([]);
  });
  it("POST /report/studentlevelquiz/class reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentlevelquiz/class"])).toEqual([]);
  });
  it("POST /report/studentlevelquiz/class/download reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentlevelquiz/class/download"])).toEqual([]);
  });
  it("POST /report/studentstatus reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentstatus"])).toEqual([]);
  });
  it("POST /report/studentstatus/download reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/studentstatus/download"])).toEqual([]);
  });
  it("POST /report/student-grade-progress reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/student-grade-progress"])).toEqual([]);
  });
  it("POST /report/student-level-progress reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/student-level-progress"])).toEqual([]);
  });
  it("POST /report/student-lesson-progress reads only learners in the scope: X's header or X's school, whatever the body names", async () => {
    expect(await runReport(REPORTS["POST /report/student-lesson-progress"])).toEqual([]);
  });

  it("the rows a list report answers are the scope's learners (the class and status lists carry them)", async () => {
    const { failures, check } = scenario();
    const rows = async (path: string, auth: Auth, body: unknown, headers: Record<string, string> = {}) => {
      const r = await send("post", path, auth, body, headers);
      return { status: r.status, ids: idsIn(r.body, "studentid") };
    };
    // the status list, naming Y's school, both schools, and none
    const both = bodyOf("schoolid", [SCH_X, SCH_Y]);
    for (const [name, auth, body, wanted] of [
      ["server key + X's header, Y's school", SERVER_X, bodyOf("schoolid", SCH_Y), []],
      ["server key + X's header, both schools", SERVER_X, both, [ST_X1, ST_X2]],
      ["server key + X's header, no filter", SERVER_X, { pageindex: 1, pagesize: 50 }, [ST_X1, ST_X2]],
      ["server key + header platform: both schools (unscoped)", SERVER_PLATFORM, both, [ST_X1, ST_X2, ST_Y1, ST_Y2, ST_Y3, ST_R]],
      ["X teacher, both schools", X_TEACHER, both, [ST_X1, ST_X2]],
      ["Y teacher, both schools", Y_TEACHER, both, [ST_Y1, ST_Y2, ST_Y3, ST_R]],
      ["Y teacher, no filter", Y_TEACHER, { pageindex: 1, pagesize: 50 }, [ST_Y1, ST_Y2, ST_Y3, ST_R]],
    ] as Array<[string, Auth, unknown, string[]]>) {
      for (const path of ["/report/studentstatus", "/report/studentstatus/download"]) {
        const r = await rows(path, auth, body);
        check(`${path}: ${name} -> ${r.status}, ${JSON.stringify(r.ids)} (wanted exactly ${JSON.stringify(wanted)})`, r.status === 200 && sameSet(r.ids, wanted));
      }
    }
    // the class list, naming a class of each school
    for (const [name, auth, cls, wanted] of [
      ["server key + X's header, Y's class", SERVER_X, CLS_Y, []],
      ["server key + X's header, X's class", SERVER_X, CLS_X, [ST_X1, ST_X2]],
      ["server key + header platform: Y's class (unscoped)", SERVER_PLATFORM, CLS_Y, [ST_Y1, ST_Y2, ST_Y3]],
      ["X teacher, Y's class", X_TEACHER, CLS_Y, []],
    ] as Array<[string, Auth, string, string[]]>) {
      for (const path of ["/report/studentprogress/class", "/report/studentlevelquiz/class", "/report/studentprogress/class/download"]) {
        const r = await rows(path, auth, bodyOf("standard", cls));
        check(`${path}: ${name} -> ${r.status}, ${JSON.stringify(r.ids)} (wanted exactly ${JSON.stringify(wanted)})`, r.status === 200 && sameSet(r.ids, wanted));
      }
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// branding: the school's own setting, else its organisation's, else the default
// ---------------------------------------------------------------------------------------------------------
describe("GET /school/branding (public)", () => {
  const branding = async (query: string) => (await request(app.getHttpServer()).get(`/school/branding${query}`)).body?.data;
  const SCH_ORG_ONLY = uid("a1", 90); // a school of X with no theme and no branding of its own
  const SCH_OWN_CONFIG = uid("a1", 91); // a theme of its own, no branding config
  const SCH_NO_ORG = uid("d4", 90); // no organisation and nothing of its own

  beforeEach(() => {
    tables.set(schools, [
      ...rowsOf(schools),
      { schoolid: SCH_ORG_ONLY, schoolname: "Org Only", organisationid: ORG_X, countryid: "c1", curriculums: [], isdeleted: false, uitheme: null, brandingconfig: null },
      { schoolid: SCH_OWN_CONFIG, schoolname: "Own Config", organisationid: ORG_X, countryid: "c1", curriculums: [], isdeleted: false, uitheme: "kids", brandingconfig: null },
      { schoolid: SCH_NO_ORG, schoolname: "No Org", organisationid: null, countryid: "c1", curriculums: [], isdeleted: false, uitheme: null, brandingconfig: null },
    ]);
  });

  it("answers the school's own theme and branding when it has them", async () => {
    expect(await branding(`?schoolid=${SCH_Y}`)).toEqual({ uitheme: "kids", brandingconfig: { logo: "y" } });
  });

  it("falls to the school's organisation for what the school does not set", async () => {
    expect(await branding(`?schoolid=${SCH_ORG_ONLY}`)).toEqual({ uitheme: "corporate", brandingconfig: { org: "x" } });
    // each setting is resolved on its own: the school's theme, and the organisation's branding
    expect(await branding(`?schoolid=${SCH_OWN_CONFIG}`)).toEqual({ uitheme: "kids", brandingconfig: { org: "x" } });
  });

  it("falls to the default theme for a school with no organisation, a suspended organisation, an unknown school and no school", async () => {
    const fallback = { uitheme: "kids", brandingconfig: null };
    expect(await branding(`?schoolid=${SCH_NO_ORG}`)).toEqual(fallback);
    expect(await branding(`?schoolid=${SCH_Z}`)).toEqual(fallback);
    expect(await branding(`?schoolid=${NOWHERE}`)).toEqual(fallback);
    expect(await branding("")).toEqual(fallback);
  });

  it("resolves a school named by its name to its id first, and an id wins over a name", async () => {
    expect(await branding("?schoolname=Org%20Only")).toBeDefined();
    expect(await branding(`?schoolname=School%20Y&schoolid=${SCH_ORG_ONLY}`)).toEqual({ uitheme: "corporate", brandingconfig: { org: "x" } });
  });
});

// ---------------------------------------------------------------------------------------------------------
// the content import: who may send an organisation's content (the payload's rows are 5c's, proved in src/modules/import)
// ---------------------------------------------------------------------------------------------------------
describe("PUT /import/master: who may send content, online and on a classroom Pi", () => {
  const originalOffline = Config.fortyk.api.rpi.offline;
  afterEach(() => {
    Config.fortyk.api.rpi.offline = originalOffline;
  });
  // A header and nothing else: it is refused for its tables (400) before anything is written, so 400 means "the sender was
  // let in and the payload was read", 403 "the sender was stopped" and 401 "the token proves nothing".
  const zipOf = (organisationid: string) => {
    const zip = new AdmZip();
    zip.addFile("master.json", Buffer.from(JSON.stringify({ format: 3, organisationid, organisationcode: "o", scope: "organisation" }), "utf8"));
    return zip.toBuffer();
  };
  const put = (auth: Auth, organisationid = ORG_X) => {
    let req = request(app.getHttpServer()).put("/import/master");
    req = "bearer" in auth ? req.set("Authorization", auth.bearer) : req.set("Authorization", Config.fortyk.api.serversynckey);
    return req.attach("importfile", zipOf(organisationid), "master.zip");
  };
  const UNOWNED_STAFF: Auth = { bearer: bearer({ sub: SU_TX, schooluserid: SU_TX, schooluserrole: SchoolRole.TEACHER, schoolid: SCH_L, organisationid: null }) };

  it("PUT /import/master online: central's key is read; a staff token with proof is stopped (403); a token with no proof, or a suspended organisation's, is refused (401)", async () => {
    const { failures, check } = scenario();
    Config.fortyk.api.rpi.offline = false;
    let r = await put(SERVER_X);
    check(`server key -> ${r.status} (wanted 400: the payload was read)`, r.status === 400);
    r = await put(X_TEACHER);
    check(`X teacher -> ${r.status} (wanted 403)`, r.status === 403);
    r = await put(X_LEARNER);
    check(`X learner -> ${r.status} (wanted 403)`, r.status === 403);
    for (const [name, auth] of [...REFUSED_TOKENS, ["an unowned school's token", UNOWNED_STAFF]] as Array<[string, Auth]>) {
      r = await put(auth);
      check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
    }
    expect(failures).toEqual([]);
  });

  it("PUT /import/master on a classroom Pi: a teacher of the payload's organisation is read, another's is stopped, and a token with no organisation is read only while its own school has none", async () => {
    const { failures, check } = scenario();
    Config.fortyk.api.rpi.offline = true;
    let r = await put(X_TEACHER, ORG_X);
    check(`X teacher, X's payload -> ${r.status} (wanted 400: read)`, r.status === 400);
    r = await put(X_TEACHER, ORG_Y);
    check(`X teacher, Y's payload -> ${r.status} (wanted 403)`, r.status === 403);
    r = await put(Y_TEACHER, ORG_X);
    check(`Y teacher, X's payload -> ${r.status} (wanted 403)`, r.status === 403);
    r = await put(X_LEARNER, ORG_X);
    check(`X learner -> ${r.status} (wanted 403)`, r.status === 403);
    r = await put(UNOWNED_STAFF, ORG_X);
    check(`a token whose school is here and has no organisation yet -> ${r.status} (wanted 400: read, the payload is judged next)`, r.status === 400);
    for (const [name, auth] of REFUSED_TOKENS) {
      r = await put(auth, ORG_X);
      check(`${name} -> ${r.status} (wanted 401)`, r.status === 401);
    }
    // the window is not for the import alone: the same token works elsewhere, scoped to its one school (see the next describe)
    const other = await send("get", "/teacher/students", UNOWNED_STAFF);
    check(`the unowned school's token on GET /teacher/students -> ${other.status} (wanted 200)`, other.status === 200);
    expect(failures).toEqual([]);
  });
});

const bodyOfSchools = (values: string[], key = "schoolid") => ({ pageindex: 1, pagesize: 50, filter: [{ key, value: values }] });

// ---------------------------------------------------------------------------------------------------------
// the classroom Pi's window: a school with no organisation yet
// ---------------------------------------------------------------------------------------------------------
describe("a classroom Pi whose school has no organisation yet keeps working, one school at a time", () => {
  const originalOffline = Config.fortyk.api.rpi.offline;
  beforeEach(() => {
    Config.fortyk.api.rpi.offline = true;
  });
  afterEach(() => {
    Config.fortyk.api.rpi.offline = originalOffline;
  });

  const nullOrg = { organisationid: null };
  const L_LEARNER: Auth = { bearer: bearer({ ...pupil(SU_L1, ST_L1, SCH_L, ORG_X, []), ...nullOrg }) };
  const L2_LEARNER: Auth = { bearer: bearer({ ...pupil(SU_L2, ST_L2, SCH_L2, ORG_X, []), ...nullOrg }) };
  const L_TEACHER: Auth = { bearer: bearer({ ...staff(SU_TL, SchoolRole.TEACHER, SCH_L, ORG_X), ...nullOrg }) };
  const L2_TEACHER: Auth = { bearer: bearer({ ...staff(SU_TL2, SchoolRole.TEACHER, SCH_L2, ORG_X), ...nullOrg }) };
  // a token from before the claims existed: the school's name only
  const L_OLD: Auth = { bearer: bearer({ sub: SU_L1, schooluserid: SU_L1, studentid: ST_L1, schooluserrole: SchoolRole.STUDENT, schoolname: "Legacy School" }) };
  const OWNED_NULL: Auth = { bearer: bearer({ ...pupil(SU_X1, ST_X1, SCH_X, ORG_X, []), organisationid: null }) };
  const OWNED_OLD: Auth = { bearer: bearer({ sub: SU_X1, schooluserid: SU_X1, studentid: ST_X1, schooluserrole: SchoolRole.STUDENT, schoolname: "School X" }) };
  const ODD_CLAIM: Auth[] = [
    { bearer: bearer({ ...pupil(SU_L1, ST_L1, SCH_L, ORG_X, []), organisationid: "" }) },
    { bearer: bearer({ ...pupil(SU_L1, ST_L1, SCH_L, ORG_X, []), organisationid: 42 }) },
  ];

  const contentPaths = (t: Tree): string[] => [
    `/curriculum/${t.curriculum}`,
    `/grade/curriculum/${t.curriculum}`,
    `/level/grade/${t.grade}`,
    `/Lesson/level/${t.level}`,
    `/lesson/plan/${t.plan}`,
    `/lesson/learning/${t.learning}`,
    `/question/lesson/${t.lesson}`,
  ];

  it("a learner of the unowned school gets its own content and lists, and nothing of any other school's (a second unowned school on the Pi, or an organisation's)", async () => {
    const { failures, check } = scenario();
    for (const [name, auth] of [["learner", L_LEARNER], ["learner with a token from before the claims existed", L_OLD]] as Array<[string, Auth]>) {
      for (const path of contentPaths(T_L)) {
        const r = await send("get", path, auth);
        check(`${name}, own ${path.split("/")[1]} -> ${r.status} (wanted 200)`, r.status === 200);
      }
      const absent = await send("get", `/Lesson/level/${NOWHERE}`, auth);
      check(`${name}, a level that is not there -> ${absent.status} (wanted 404)`, absent.status === 404);
      for (const [what, tree] of [["the second unowned school's", T_L2], ["X's", T_X1], ["Y's", T_Y1]] as Array<[string, Tree]>) {
        for (const path of contentPaths(tree)) {
          const r = await send("get", path, auth);
          check(`${name}, ${what} ${path.split("/")[1]} -> ${r.status} (wanted 404)`, r.status === 404);
        }
        const r = await send("get", `/Lesson/level/${tree.level}`, auth);
        check(`${name}, ${what} level: the answer is the one for absent content`, text(r.body) === text(absent.body));
      }
      for (const [path, key, wanted] of [
        ["/curriculum", "curriculumid", [T_L.curriculum]],
        ["/curriculum/subjects", "curriculumid", [T_L.curriculum]],
        ["/curriculum/all", "curriculumid", [T_L.curriculum]],
        ["/grade/all", "gradeid", [T_L.grade]],
        ["/level/all", "levelid", [T_L.level]],
        ["/Lesson/all", "lessonid", [T_L.lesson]],
      ] as Array<[string, string, string[]]>) {
        const r = await send("get", path, auth);
        check(`${name}, ${path} -> ${r.status}, ${JSON.stringify(idsIn(r.body, key))} (wanted only the school's)`, r.status === 200 && sameSet(idsIn(r.body, key), wanted));
      }
      const library = await send("get", "/level/library", auth);
      check(`${name}, /level/library -> ${JSON.stringify(libraryIds(library.body))}`, library.status === 200 && sameSet(libraryIds(library.body), [T_L.curriculum]));
    }
    // the second unowned school's learner is the mirror image
    for (const path of contentPaths(T_L2)) check(`second school's learner, own ${path.split("/")[1]}`, (await send("get", path, L2_LEARNER)).status === 200);
    for (const path of contentPaths(T_L)) check(`second school's learner, the first school's ${path.split("/")[1]} -> 404`, (await send("get", path, L2_LEARNER)).status === 404);
    expect(failures).toEqual([]);
  });

  it("a result submission of the unowned school's learner writes for its own content, and writes nothing for another school's", async () => {
    const { failures, check } = scenario();
    reset();
    let r = await send("post", `/result/lesson/practice/${T_L.practice}`, L_LEARNER, RESULT_BODY);
    check(`own practice -> ${r.status} (wanted 200)`, r.status === 200);
    check(`own practice: the writes ran (${stubCalls.join()})`, stubCalls.includes("ResultBusiness.updatePracticePoints"));
    reset();
    const before = snapshot();
    const transactionsBefore = (dbinstance.getdbinstance().transaction as unknown as jest.Mock).mock.calls.length;
    for (const tree of [T_L2, T_X1, T_Y1]) {
      r = await send("post", `/result/lesson/practice/${tree.practice}`, L_LEARNER, RESULT_BODY);
      check(`another school's practice -> ${r.status} (wanted 404)`, r.status === 404);
    }
    check(`another school's practice: nothing ran (${stubCalls.join()})`, stubCalls.length === 0);
    check("another school's practice: no table changed, no transaction", snapshot() === before && (dbinstance.getdbinstance().transaction as unknown as jest.Mock).mock.calls.length === transactionsBefore);
    expect(failures).toEqual([]);
  });

  it("a teacher of the unowned school sees its own school's learners, classes, reports and content, and no other school's", async () => {
    const { failures, check } = scenario();
    for (const path of contentPaths(T_L)) check(`teacher, own ${path.split("/")[1]}`, (await send("get", path, L_TEACHER)).status === 200);
    for (const [what, tree] of [["the second unowned school's", T_L2], ["X's", T_X1]] as Array<[string, Tree]>) {
      for (const path of contentPaths(tree)) {
        const r = await send("get", path, L_TEACHER);
        check(`teacher, ${what} ${path.split("/")[1]} -> ${r.status} (wanted 404)`, r.status === 404);
      }
    }
    const students = await send("get", "/teacher/students", L_TEACHER);
    check(`teacher/students -> ${JSON.stringify(idsIn(students.body, "studentid"))} (wanted only the school's learner)`, students.status === 200 && sameSet(idsIn(students.body, "studentid"), [ST_L1]));
    const progress = await send("post", "/teacher/studentprogress", L_TEACHER, {});
    check(`teacher/studentprogress, no class -> ${JSON.stringify(idsIn(progress.body, "studentid"))} (wanted only the school's learner)`, sameSet(idsIn(progress.body, "studentid"), [ST_L1]));
    const foreignClass = await send("post", "/teacher/studentprogress", L_TEACHER, { filter: [{ key: "standard", value: CLS_L2 }] });
    check(`teacher/studentprogress, the second school's class -> total ${foreignClass.body?.data?.total} (wanted an unknown class: 0)`, foreignClass.status === 200 && foreignClass.body?.data?.total === 0);
    const classes = await send("get", "/teacher/standards", L_TEACHER);
    check(`teacher/standards -> ${JSON.stringify(idsIn(classes.body, "standard"))}`, sameSet(idsIn(classes.body, "standard"), [CLS_L]));
    const info = await send("get", `/teacher/studentinfo?studentid=${ST_L2}`, L_TEACHER);
    check(`teacher/studentinfo for the second school's learner -> ${JSON.stringify(info.body?.data)} (wanted null)`, info.status === 200 && info.body?.data === null);
    for (const [path, key, wanted] of [
      ["/curriculum", "curriculumid", [T_L.curriculum]],
      ["/curriculum/all", "curriculumid", [T_L.curriculum]],
      ["/grade/all", "gradeid", [T_L.grade]],
    ] as Array<[string, string, string[]]>) {
      const r = await send("get", path, L_TEACHER);
      check(`teacher ${path} -> ${JSON.stringify(idsIn(r.body, key))}`, r.status === 200 && sameSet(idsIn(r.body, key), wanted));
    }
    reset();
    const report = await send("post", "/report/studentstatus", L_TEACHER, bodyOfSchools([SCH_L, SCH_L2]));
    check(`report/studentstatus naming both unowned schools -> ${report.status}, read ${JSON.stringify([...seen])} (wanted only the school's learner)`, report.status === 200 && seen.size > 0 && [...seen].every((id) => id === ST_L1));
    reset();
    await send("post", "/report/studentprogress/class", L_TEACHER, bodyOfSchools([CLS_L2], "standard"));
    check(`report/studentprogress/class, the second school's class: read ${JSON.stringify([...seen])} (wanted none)`, seen.size === 0);
    reset();
    await send("post", "/student/logintime", L_TEACHER, [SU_L1, SU_L2, SU_X1]);
    check(`student/logintime asked ${JSON.stringify(rawQueries.flatMap((q) => q.replacements))} (wanted only the school's login)`, sameSet(rawQueries.flatMap((q) => q.replacements as string[]), [SU_L1]));
    const other = await send("get", "/teacher/students", L2_TEACHER);
    check(`the second school's teacher sees ${JSON.stringify(idsIn(other.body, "studentid"))} (wanted only its own)`, sameSet(idsIn(other.body, "studentid"), [ST_L2]));
    expect(failures).toEqual([]);
  });

  it("online, a token with no organisation is refused everywhere, an unowned school or not", async () => {
    const { failures, check } = scenario();
    Config.fortyk.api.rpi.offline = false;
    for (const [name, auth] of [["learner", L_LEARNER], ["teacher", L_TEACHER], ["old token", L_OLD]] as Array<[string, Auth]>) {
      for (const path of ["/curriculum", "/teacher/students", "/level/library", `/curriculum/${T_L.curriculum}`]) {
        const r = await send("get", path, auth);
        check(`online, ${name}, ${path} -> ${r.status} (wanted 401)`, r.status === 401);
      }
      const w = await send("post", `/result/lesson/practice/${T_L.practice}`, auth, RESULT_BODY);
      check(`online, ${name}, a result -> ${w.status} (wanted 401)`, w.status === 401);
    }
    expect(failures).toEqual([]);
  });

  it("on a Pi, a token with no organisation is refused once its school has an owner, and an empty or odd claim is never 'none'", async () => {
    const { failures, check } = scenario();
    for (const [name, auth] of [["null claim, owned school", OWNED_NULL], ["old token, owned school", OWNED_OLD], ["empty claim", ODD_CLAIM[0]], ["number claim", ODD_CLAIM[1]]] as Array<[string, Auth]>) {
      for (const path of ["/curriculum", "/level/library", `/curriculum/${T_X1.curriculum}`, `/curriculum/${T_L.curriculum}`]) {
        const r = await send("get", path, auth);
        check(`Pi, ${name}, ${path} -> ${r.status} (wanted 401)`, r.status === 401);
      }
    }
    // an owned school's ordinary token works as it does online
    const own = await send("get", `/Lesson/level/${T_X1.level}`, X_LEARNER);
    const foreign = await send("get", `/Lesson/level/${T_L.level}`, X_LEARNER);
    check(`Pi, X learner: own -> ${own.status}, an unowned school's level -> ${foreign.status} (wanted 200, 404)`, own.status === 200 && foreign.status === 404);
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// progress reads are for the learner the report resolved
// ---------------------------------------------------------------------------------------------------------
describe("progress reads carry the resolved learner's id", () => {
  const scopeX = { organisationid: ORG_X, schoolids: [SCH_X] };
  const listOf = (key: string, value: unknown) => ({ pageindex: 1, pagesize: 50, filter: [{ key, value: value as string }] });
  const progressReads = (table: string) => reads.filter((r) => r.model === table && r.method === "findOne").map((r) => r.options?.where?.studentid);

  // The scope check is set aside here so that the reads after the lookup are seen on their own.
  const cases: Array<[string, "getStudentLevelProgress" | "getStudentLessonProgress", string]> = [
    ["POST /report/student-level-progress", "getStudentLevelProgress", "studentlevelsprogress"],
    ["POST /report/student-lesson-progress", "getStudentLessonProgress", "studentlessonsprogress"],
  ];
  it.each(cases)("%s (business, scope check set aside): progress is read for the resolved learner only, and no other learner's row comes back", async (_route, method, table) => {
    jest.spyOn(reportScope, "contentFiltersInScope").mockResolvedValue(true);
    reset();
    const answer = await new ReportBusiness()[method](listOf("studentid", [ST_X1, ST_Y1]), scopeX);
    const asked = progressReads(table);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((id) => id === ST_X1)).toBe(true);
    expect(JSON.stringify(answer.rows)).not.toContain(ST_Y1);
    expect([...seen].every((id) => id === ST_X1)).toBe(true);
  });

  it.each(cases)("%s (business, scope check set aside): another school's learner named alone is nobody's", async (_route, method, table) => {
    jest.spyOn(reportScope, "contentFiltersInScope").mockResolvedValue(true);
    reset();
    const answer = await new ReportBusiness()[method](listOf("studentid", ST_Y1), scopeX);
    expect(answer.rows).toEqual([]);
    expect(progressReads(table)).toEqual([]);
  });

  it("POST /report/studentprogress (business, scope check set aside): the lesson-progress join of the scores report carries the resolved learner's id", async () => {
    jest.spyOn(reportScope, "contentFiltersInScope").mockResolvedValue(true);
    reset();
    await new ReportBusiness().getStudentsScoresData(listOf("studentid", [ST_X1, ST_Y1]), false, scopeX);
    const joins = reads.filter((r) => r.model === "lessons" && r.method === "findAndCountAll").flatMap((r) => (r.options?.include ?? []).map((i: { where?: { studentid?: unknown } }) => i.where?.studentid));
    expect(joins.filter((id: unknown) => id !== undefined)).toEqual([ST_X1]);
  });

  it("the id the lookup asked for in addition is not added to the learner in the answer", () => {
    const row = students.build({ studentid: ST_X1, studentfirstname: "A" } as never);
    const where: Row = { studentid: [ST_X1, ST_Y1] };
    pinStudent(where, row, true);
    expect(where.studentid).toBe(ST_X1);
    expect(JSON.parse(JSON.stringify(row))).not.toHaveProperty("studentid");
    expect(JSON.parse(JSON.stringify(row)).studentfirstname).toBe("A");
    const kept = students.build({ studentid: ST_X1, studentfirstname: "A" } as never);
    pinStudent({}, kept);
    expect(JSON.parse(JSON.stringify(kept)).studentid).toBe(ST_X1);
  });
});
