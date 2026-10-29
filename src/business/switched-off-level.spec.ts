import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import * as fs from "fs";
import * as path from "path";
import { Model, Op, Sequelize } from "sequelize";
import request from "supertest";
import { Config, Logger } from "src/config";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { GradeController } from "src/modules/grade/grade.controller";
import { LessonController } from "src/modules/lesson/lesson.controller";
import { LessonLearningController } from "src/modules/lesson/lesson.learning.controller";
import { LevelController } from "src/modules/level/level.controller";
import { QuestionController } from "src/modules/question/question.controller";
import { ResultController } from "src/modules/result/result.controller";
import { StudentController } from "src/modules/student/student.controller";
import { canAccessContent } from "src/business/content-access";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { Token } from "src/models/token.model";

/**
 * A level that is switched off (`levelstatus` 0: built, not shown to learners) must stay away from learners on EVERY learner route.
 *
 * Why this matters now: the readiness import writes each module of a programme as a level of one grade, and `seed:dcrs -- --draft` writes
 * a module's level switched off. Central's publication carries every column, so a switched-off level reaches this API as a row with
 * `levelstatus = 0`, and only the reads that filter on it keep it from the learner.
 *
 * What is proved, over real HTTP through the real JWT strategy, guards, validators, controllers and business classes (only the database is
 * faked: an in-memory table per model, with `where` evaluated and the `include`s of a read evaluated through the models' own associations):
 *
 *  1. The learner routes are the ones docs/route-policy-inventory.md lists with the `learner` policy. Every one of them is either exercised
 *     here or named in EXCLUDED with the reason it holds no module content. A new learner route fails this spec until it is placed.
 *  2. One curriculum, one grade, two levels: A (on) and B (off, with a lesson, a learning item, a practice, a quiz, a plan, a level quiz and
 *     progress rows of the learner). A learner enrolled in the curriculum sees exactly what they would see if B did not exist: every
 *     list answers the same in the world with B and the world without it (so no list leaks it and no total counts it), opening any of B's
 *     content by id answers exactly as an id that names nothing does (same status, same body), and a submission to B writes nothing.
 *  3. The same routes DO show level A, so none of the above is true only because the route returns nothing.
 *
 * Whether each assertion can fail is shown by mutation (see the change description), not assumed.
 */
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists: jest.fn().mockResolvedValue(true) })),
}));
jest.mock("src/business/token-claims", () => ({
  checkTokenClaims: jest.fn().mockResolvedValue(undefined),
  organisationIsActive: jest.fn().mockResolvedValue(true),
  assertCanSignIn: jest.fn().mockResolvedValue(undefined),
}));

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------------------------------------
const uid = (ns: string, n: number): string => `${ns}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = uid("a1", 1);
const SCHOOL = uid("a1", 2);
const STUDENT = uid("a1", 3);
const SCHOOLUSER = uid("a1", 4);
const NOWHERE = uid("ee", 9);

const tree = (tag: "a" | "b", n: number) => {
  const ns = tag === "a" ? "a2" : "b2";
  const id = (k: number) => uid(ns, n * 100 + k);
  return {
    level: id(1), lesson: id(2), learning: id(3), practice: id(4), quiz: id(5), plan: id(6), document: id(7),
    question: id(8), practiceJoin: id(9), quizJoin: id(10), levelQuestion: id(11), levelQuizJoin: id(12), planDocument: id(13),
  };
};
const A = tree("a", 1);
const B = tree("b", 1);
const CURRICULUM = uid("c3", 1);
const GRADE = uid("c3", 2);

// ---------------------------------------------------------------------------------------------------------
// the fake database
// ---------------------------------------------------------------------------------------------------------
let sequelize: Sequelize;
const tables = new Map<string, Row[]>();
let writes: string[] = [];
let rawQueries: string[] = [];
const rowsOf = (model: any): Row[] => tables.get(model.name) ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any

const test = (value: any, cond: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (Array.isArray(cond)) return cond.includes(value);
  if (cond === null) return value === null || value === undefined;
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const sym = (s: symbol) => (cond as any)[s]; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (Op.in in cond) return (sym(Op.in) as unknown[]).includes(value);
    if (Op.notIn in cond) return !(sym(Op.notIn) as unknown[]).includes(value);
    if (Op.ne in cond) return sym(Op.ne) === null ? value !== null && value !== undefined : value !== sym(Op.ne);
    if (Op.not in cond) return value !== sym(Op.not);
    if (Op.like in cond) return String(value ?? "").toLowerCase().includes(String(sym(Op.like)).replace(/%/g, "").toLowerCase());
    if (Op.gt in cond) return value > sym(Op.gt);
    if (Op.gte in cond) return value >= sym(Op.gte);
    if (Op.lt in cond) return value < sym(Op.lt);
    if (Op.lte in cond) return value <= sym(Op.lte);
    if (Op.between in cond) return value >= (sym(Op.between) as any[])[0] && value <= (sym(Op.between) as any[])[1]; // eslint-disable-line @typescript-eslint/no-explicit-any
    throw new Error(`the fake database does not know this operator: ${String(Object.getOwnPropertySymbols(cond).map(String))}`);
  }
  // booleans are TINYINT(1): a stored 1 is true
  if (typeof cond === "boolean" && typeof value === "number") return Boolean(value) === cond;
  return value === cond;
};
const matches = (row: Row, where: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!where) return true;
  for (const key of Reflect.ownKeys(where)) {
    const cond = where[key as string];
    if (key === (Op.and as unknown as symbol)) {
      if (!(cond as any[]).every((w) => matches(row, w))) return false; // eslint-disable-line @typescript-eslint/no-explicit-any
    } else if (key === (Op.or as unknown as symbol)) {
      if (!(cond as any[]).some((w) => matches(row, w))) return false; // eslint-disable-line @typescript-eslint/no-explicit-any
    } else if (typeof key === "symbol") {
      throw new Error(`the fake database does not know this where key: ${String(key)}`);
    } else if (key.startsWith("$")) {
      throw new Error(`the fake database does not evaluate ${key}`);
    } else if (!test(row[key], cond)) return false;
  }
  return true;
};

/** The rows an include brings for one parent row, through the models' own association (hasMany / hasOne / belongsTo), with its where and nested includes. */
const includesOf = (value: any): any[] => (value ? (Array.isArray(value) ? value : [value]) : []).map((inc: any) => (typeof inc === "function" ? { model: inc } : inc)); // eslint-disable-line @typescript-eslint/no-explicit-any
/** The association of a parent model that an include item names (by model, and `as`/`association` when it says). */
const associationOf = (parentModel: any, inc: any): any => // eslint-disable-line @typescript-eslint/no-explicit-any
  Object.values(parentModel.associations ?? {}).find(
    (a: any) => (inc.model ? a.target === inc.model : true) && (!(inc.as ?? inc.association) || a.as === (inc.as ?? inc.association)), // eslint-disable-line @typescript-eslint/no-explicit-any
  );
const includeOf = (parentModel: any, parent: Row, inc: any): { as: string; value: Row | Row[] | null; keep: boolean } => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const assoc: any = associationOf(parentModel, inc); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!assoc) throw new Error(`the fake database found no association from ${parentModel.name} for ${JSON.stringify(Object.keys(inc))}`);
  const target = assoc.target;
  let found: Row[];
  if (assoc.associationType === "BelongsTo") {
    found = rowsOf(target).filter((t) => t[assoc.targetKey] === parent[assoc.foreignKey]);
  } else {
    const sourceKey = assoc.sourceKey ?? assoc.source.primaryKeyAttribute;
    found = rowsOf(target).filter((t) => t[assoc.foreignKey] === parent[sourceKey]);
  }
  found = found.filter((t) => matches(t, inc.where));
  const nested = includesOf(inc.include);
  const shaped = found
    .map((t) => withIncludes(target, t, nested))
    .filter((t): t is Row => t !== null);
  const required = inc.required ?? Boolean(inc.where);
  const multiple = assoc.isMultiAssociation;
  return { as: assoc.as, value: multiple ? shaped : shaped[0] ?? null, keep: !required || shaped.length > 0 };
};
const withIncludes = (model: any, row: Row, includes: any[] | undefined): Row | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!includes || includes.length === 0) return { ...row };
  const out: Row = { ...row };
  for (const inc of includes) {
    const r = includeOf(model, row, inc);
    if (!r.keep) return null;
    out[r.as] = r.value;
  }
  return out;
};

/** A row as the model's instance would hold it: real Sequelize instances (so `get`, `getDataValue`, `setDataValue`, `toJSON` are Sequelize's own), includes attached. */
const instanceOf = (model: any, row: Row, includes: any[] | undefined): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const scalars: Row = {};
  const nested: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  const incs = includesOf(includes);
  const names = new Map<string, { model: any; includes: any[] | undefined }>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const inc of incs) {
    const assoc: any = associationOf(model, inc); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (assoc) names.set(assoc.as, { model: assoc.target, includes: includesOf(inc.include) });
  }
  for (const [k, v] of Object.entries(row)) {
    if (names.has(k)) nested[k] = v;
    else scalars[k] = v;
  }
  const instance = model.build(scalars);
  instance.isNewRecord = false;
  if (names.size > 0) {
    instance._options.include = incs;
    instance._options.includeNames = [...names.keys()];
    for (const [k, v] of Object.entries(nested)) {
      const sub = names.get(k)!;
      // what Sequelize's own include handling does: the included instances are on dataValues and on the instance itself
      instance[k] = instance.dataValues[k] = Array.isArray(v) ? v.map((r: Row) => instanceOf(sub.model, r, sub.includes)) : v ? instanceOf(sub.model, v, sub.includes) : v;
    }
  }
  return instance;
};

const read = (model: any, options: any = {}): Row[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
  let rows = rowsOf(model).filter((r) => matches(r, options.where));
  const includes = includesOf(options.include);
  const shaped = rows.map((r) => withIncludes(model, r, includes)).filter((r): r is Row => r !== null);
  rows = shaped;
  return rows;
};
const shape = (model: any, options: any, rows: Row[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const includes = includesOf(options?.include);
  return rows.map((r) => (options?.raw ? { ...r } : instanceOf(model, r, includes)));
};

const install = () => {
  const models = Object.values(sequelize.models) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const model of models) {
    jest.spyOn(model, "scope").mockReturnValue(model as never);
    jest.spyOn(model, "findAll").mockImplementation((async (options: any) => shape(model, options, read(model, options))) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(model, "findOne").mockImplementation((async (options: any) => shape(model, options, read(model, options).slice(0, 1))[0] ?? null) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(model, "findByPk").mockImplementation((async (pk: unknown) => {
      const row = rowsOf(model).find((r) => r[model.primaryKeyAttribute] === pk);
      return row ? instanceOf(model, row, []) : null;
    }) as never);
    jest.spyOn(model, "count").mockImplementation((async (options: any) => read(model, options).length) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(model, "findAndCountAll").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const rows = read(model, options);
      const page = options?.limit ? rows.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit) : rows;
      return { rows: shape(model, options, page), count: rows.length };
    }) as never);
    for (const method of ["create", "bulkCreate", "update", "destroy", "upsert", "findOrCreate", "increment"]) {
      jest.spyOn(model, method).mockImplementation((async (...args: unknown[]) => {
        writes.push(`${model.name}.${method}`);
        if (method === "findOrCreate") return [instanceOf(model, (args[0] as any)?.defaults ?? {}, []), true]; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (method === "bulkCreate") return args[0];
        if (method === "update" || method === "destroy") return [0];
        return instanceOf(model, (args[0] as Row) ?? {}, []);
      }) as never);
    }
    for (const method of ["max", "min", "sum"]) jest.spyOn(model, method).mockResolvedValue(0 as never);
  }
  for (const method of ["save", "update", "destroy", "reload", "increment", "decrement"]) {
    jest.spyOn(Model.prototype as any, method).mockImplementation(async function (this: unknown) { // eslint-disable-line @typescript-eslint/no-explicit-any
      writes.push(`instance.${method}`);
      return this;
    } as never);
  }
  jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (sql: string) => {
    rawQueries.push(String(sql));
    return [[], undefined];
  }) as never);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockImplementation((async () => ({ commit: async () => undefined, rollback: async () => undefined })) as never);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(Logger, "info").mockImplementation((() => Logger) as never);
  jest.spyOn(Logger, "error").mockImplementation((() => Logger) as never);
  jest.spyOn(Logger, "warn").mockImplementation((() => Logger) as never);
};

// ---------------------------------------------------------------------------------------------------------
// the data
// ---------------------------------------------------------------------------------------------------------
const live = { isdeleted: false };
const levelRows = (t: typeof A, order: number, on: boolean): Row[] => [
  { _t: "levels", levelid: t.level, gradeid: GRADE, levelname: `Level ${order}`, leveldescription: "d", levelorder: order, levelstatus: on, points: 100, quiz_points: 20, passing_points: 80, ...live },
  { _t: "lessons", lessonid: t.lesson, levelid: t.level, lessonname: `Lesson ${order}`, lessondescription: "d", lessonorder: 1, lessonstatus: true, total_points: 100, passing_points: 80, learning_points: 20, quizzes_points: 40, practices_points: 40, practicecount: 1, quizcount: 1, ...live },
  { _t: "lessonlearnings", lessonlearningid: t.learning, lessonid: t.lesson, lessonlearningname: `Learning ${order}`, lessonlearningdescription: "d", lessonlearningorder: 1, lessonlearningstatus: true, documentid: t.document, points: 20 },
  { _t: "lessonpractices", lessonpracticeid: t.practice, lessonid: t.lesson, lessonpracticename: `Practice ${order}`, lessonpracticedescription: "d", lessonpracticeorder: 1, lessonpracticestatus: true, points: 40 },
  { _t: "lessonquizzes", lessonquizid: t.quiz, lessonid: t.lesson, lessonquizname: `Quiz ${order}`, lessonquizdescription: "d", lessonquizorder: 1, lessonquizstatus: true, points: 40 },
  { _t: "lessonplans", lessonplanid: t.plan, lessonid: t.lesson, lessonplanname: `Plan ${order}`, lessonplandescription: "d", lessonplanorder: 1, lessonplanstatus: true, documentid: t.planDocument },
  { _t: "documents", documentid: t.document, documenttypeid: 2, documentname: `video-${order}.mp4`, organisationid: ORG, ...live },
  { _t: "documents", documentid: t.planDocument, documenttypeid: 1, documentname: `plan-${order}.pdf`, organisationid: ORG, ...live },
  {
    _t: "questions", questionid: t.question, templatetypeid: 1, questiontext: `Question ${order}`, questionheading: { headingfile: null, headingtext: `Heading ${order}` },
    questionoptions: [
      { questionoptionid: `${t.question}-opt-1`, questionoptiontext: "yes", questionoptionsequence: 1, questionoptioniscorrect: true, questionassociate: null, questionoptionfile: null },
      { questionoptionid: `${t.question}-opt-2`, questionoptiontext: "no", questionoptionsequence: 2, questionoptioniscorrect: false, questionassociate: null, questionoptionfile: null },
    ],
    questiondistractors: [], questionfeedback: null, questionstatus: true, organisationid: ORG, ...live,
  },
  { _t: "lessonpracticequestions", lessonpracticequestionid: t.practiceJoin, lessonpracticeid: t.practice, questionid: t.question, lessonpracticequestionstatus: true, lessonpracticequestionorder: 1 },
  { _t: "lessonquizquestions", lessonquizquestionid: t.quizJoin, lessonquizid: t.quiz, questionid: t.question, lessonquizquestionstatus: true, lessonquizquestionorder: 1 },
  { _t: "levelquizquestions", levelquizquestionid: t.levelQuestion, levelid: t.level, questionid: t.question, levelquizquestionstatus: true, levelquizquestionorder: 1 },
  // the learner's progress on it (every list that totals progress sees these)
  { _t: "studentlessonsprogress", studentlessonprogressid: uid("f4", order * 10 + 1), studentid: STUDENT, lessonid: t.lesson, gradeid: GRADE, points: 100, completed: true },
  { _t: "studentlevelsprogress", studentlevelprogressid: uid("f4", order * 10 + 2), studentid: STUDENT, levelid: t.level, gradeid: GRADE, points: 100, scores: 25, completed: true },
  // the learner has taken the level quiz (what GET /question/level/:levelid/answers reads back)
  { _t: "studentprogress", studentprogressid: uid("f4", order * 10 + 3), studentid: STUDENT, studentprogressreferenceid: t.level, studentprogresstype: 3, starttime: new Date("2026-10-01T08:00:00Z"), endtime: new Date("2026-10-01T08:10:00Z"), ispass: true, points: 20, fullpoints: 20 },
];
const baseRows = (): Row[] => [
  { _t: "organisations", organisationid: ORG, organisationstatus: true, isdeleted: false, contentlanguage: "en" },
  { _t: "schools", schoolid: SCHOOL, organisationid: ORG, schoolname: "School", curriculums: [CURRICULUM], isdeleted: false },
  { _t: "students", studentid: STUDENT, schooluserid: SCHOOLUSER, schoolid: SCHOOL, schoolname: "School", curriculumid: CURRICULUM, curriculumids: [CURRICULUM], studentfirstname: "Learner", isactive: 1, is_teacher_acc: false },
  { _t: "curriculums", curriculumid: CURRICULUM, curriculumname: "Programme", curriculumdescription: "d", curriculumstatus: true, organisationid: ORG, subjectid: null, ...live },
  { _t: "grades", gradeid: GRADE, curriculumid: CURRICULUM, gradename: "Programme", gradedescription: "d", gradeorder: 1, gradestatus: true, points: 200, ...live },
  { _t: "studentgradesprogress", studentgradeprogressid: uid("f4", 91), studentid: STUDENT, gradeid: GRADE, points: 200, scores: 50, completed: true },
];
/** The tables by model name. `withB` adds the switched-off level B and the learner's progress on it. */
const seed = (withB: boolean) => {
  tables.clear();
  const byTable: Record<string, string> = {};
  for (const model of Object.values(sequelize.models) as any[]) byTable[model.tableName] = model.name; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows = [...baseRows(), ...levelRows(A, 1, true), ...(withB ? levelRows(B, 2, false) : [])];
  for (const { _t, ...row } of rows) {
    const name = byTable[_t];
    if (!name) throw new Error(`no model for the table ${_t}`);
    tables.set(name, [...(tables.get(name) ?? []), row]);
  }
};

// ---------------------------------------------------------------------------------------------------------
// the app
// ---------------------------------------------------------------------------------------------------------
let app: INestApplication;
const bearer = (): string =>
  `Bearer ${sign(
    { jti: "jti", sub: SCHOOLUSER, schooluserid: SCHOOLUSER, studentid: STUDENT, schooluserrole: SchoolRole.STUDENT, schoolid: SCHOOL, organisationid: ORG, curriculumids: [CURRICULUM], schoolname: "School", studentfirstname: "Learner" },
    Config.fortyk.api.rpi.applicationsecret,
    { expiresIn: "5m" },
  )}`;
const send = (method: "get" | "post", url: string, body?: unknown) => {
  const req = request(app.getHttpServer())[method](url).set("Authorization", bearer());
  return body === undefined ? req : req.send(body as object);
};

beforeAll(async () => {
  sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  initModels(sequelize);
  setuprelationshipforreport(sequelize);
  const moduleRef = await Test.createTestingModule({
    controllers: [CurriculumController, GradeController, LessonController, LessonLearningController, LevelController, QuestionController, ResultController, StudentController],
    providers: [JwtAccessStrategy],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  jest.restoreAllMocks();
  install();
  writes = [];
  rawQueries = [];
});
afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------------------------------------
// the learner routes
// ---------------------------------------------------------------------------------------------------------
type Ids = typeof A;
/** The learner routes of docs/route-policy-inventory.md, as `METHOD /path`. */
const learnerRoutes = (): string[] => {
  const text = fs.readFileSync(path.join(__dirname, "..", "..", "docs", "route-policy-inventory.md"), "utf8");
  return text
    .split("\n")
    .map((line) => /^\| (GET|POST|PUT|PATCH|DELETE) \| `([^`]+)` \|.*?\| learner \|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]} ${m[2]}`);
};

/** Routes whose answer is the learner's view of the programme: asked once per world. `shows` is what the answer must hold of level A (so it is not empty by accident). */
const LISTS: Record<string, { url: string; shows?: string[] }> = {
  "GET /curriculum": { url: "/curriculum" },
  "GET /curriculum/all": { url: "/curriculum/all" },
  "GET /curriculum/subjects": { url: "/curriculum/subjects" },
  "GET /curriculum/:curriculumid": { url: `/curriculum/${CURRICULUM}` },
  "GET /curriculum/:curriculumid/map": { url: `/curriculum/${CURRICULUM}/map`, shows: [A.level, A.lesson] },
  "GET /grade/all": { url: "/grade/all" },
  "GET /grade/curriculum/:curriculumid": { url: `/grade/curriculum/${CURRICULUM}` },
  "GET /grade/progress/curriculum/:curriculumid": { url: `/grade/progress/curriculum/${CURRICULUM}` },
  "GET /grade/totalgradeprogress/:gradeid": { url: `/grade/totalgradeprogress/${GRADE}` },
  "GET /level/all": { url: "/level/all", shows: [A.level] },
  "GET /level/library": { url: "/level/library", shows: [A.level] },
  "GET /level/grade/:gradeid": { url: `/level/grade/${GRADE}`, shows: [A.level] },
  "GET /level/progress/grade/:gradeid": { url: `/level/progress/grade/${GRADE}`, shows: [A.level] },
  "GET /Lesson/all": { url: "/Lesson/all", shows: [A.lesson] },
  "GET /student/progress": { url: "/student/progress" },
  "GET /student/progress/summary": { url: "/student/progress/summary", shows: [A.level] },
};
/** Routes that open a piece of content by its id: level A's must answer, level B's must answer as an id that names nothing does. */
const OPENS: Record<string, { url: (id: string) => string; of: keyof Ids; shows?: string[] }> = {
  "GET /Lesson/level/:levelid": { url: (id) => `/Lesson/level/${id}`, of: "level", shows: [A.lesson] },
  "GET /Lesson/level/:levelid/steps": { url: (id) => `/Lesson/level/${id}/steps`, of: "level" },
  "GET /Lesson/progress/level/:levelid": { url: (id) => `/Lesson/progress/level/${id}`, of: "level" },
  "GET /Lesson/:lessonid/progress": { url: (id) => `/Lesson/${id}/progress`, of: "lesson" },
  "GET /Lesson/:lessonid/activities/progress": { url: (id) => `/Lesson/${id}/activities/progress`, of: "lesson" },
  "GET /lesson/:lessonid/learning": { url: (id) => `/lesson/${id}/learning`, of: "lesson", shows: [A.learning] },
  "GET /lesson/:lessonid/learning/progress": { url: (id) => `/lesson/${id}/learning/progress`, of: "lesson" },
  "GET /lesson/learning/:lessonlearningid": { url: (id) => `/lesson/learning/${id}`, of: "learning", shows: [A.learning] },
  "GET /lesson/learning/:lessonlearningid/progress": { url: (id) => `/lesson/learning/${id}/progress`, of: "learning" },
  "GET /lesson/plan/:lessonplanid": { url: (id) => `/lesson/plan/${id}`, of: "plan", shows: [A.plan] },
  "GET /question/lesson/:lessonid": { url: (id) => `/question/lesson/${id}`, of: "lesson", shows: [A.question] },
  "GET /question/level/:levelid": { url: (id) => `/question/level/${id}`, of: "level" },
  "GET /question/level/:levelid/answers": { url: (id) => `/question/level/${id}/answers`, of: "level" },
  "GET /question/practice/:lessonpracticeid": { url: (id) => `/question/practice/${id}`, of: "practice", shows: [A.question] },
  "GET /question/quiz/:lessonquizid": { url: (id) => `/question/quiz/${id}`, of: "quiz", shows: [A.question] },
};
const now = "2026-10-29T08:00:00.000Z";
/** Routes that record a result: a submission to level B writes nothing and answers as an id that names nothing does. */
const WRITES: Record<string, { url: (t: Ids) => string; of: keyof Ids; body: (t: Ids) => unknown }> = {
  "POST /lesson/learning/:lessonlearningid/progress": {
    url: (t) => `/lesson/learning/${t.learning}/progress`,
    of: "learning",
    body: () => ({ ended: true, time: 10, content_length: 20, date: now }),
  },
  "POST /result/lesson/practice/:lessonpracticeid": {
    url: (t) => `/result/lesson/practice/${t.practice}`,
    of: "practice",
    body: (t) => ({ result: [{ iscorrect: true, lessonpracticeid: t.practice, lessonpracticequestionid: t.practiceJoin, questionid: t.question, tries: 1 }], starttime: now, endtime: now }),
  },
  "POST /result/lesson/quiz/:lessonquizid": {
    url: (t) => `/result/lesson/quiz/${t.quiz}`,
    of: "quiz",
    body: (t) => ({ result: [{ iscorrect: true, lessonquizid: t.quiz, lessonquizquestionid: t.quizJoin, questionid: t.question }], starttime: now, endtime: now }),
  },
  "POST /result/level/quiz/:levelid": {
    url: (t) => `/result/level/quiz/${t.level}`,
    of: "level",
    body: (t) => ({ result: [{ iscorrect: true, levelid: t.level, levelquizquestionid: t.levelQuestion, questionid: t.question }], starttime: now, endtime: now }),
  },
};
/** Learner routes that hold no module content, and why. */
const EXCLUDED: Record<string, string> = {
  "GET /access": "the caller's own usage rows",
  "POST /access": "records the caller's own usage",
  "POST /student/logintime": "the caller's own login time",
  "POST /student/profile": "the caller's own profile",
  "POST /curriculum/baseline/:curriculumid/:schoolname/:studentid": "a baseline hangs from the curriculum, not from a level; a module is a level",
  "GET /question/baseline/:curriculumbaselineid": "a baseline hangs from the curriculum, not from a level; a module is a level",
  "POST /result/baseline/question/:curriculumbaselineid": "a baseline hangs from the curriculum, not from a level; a module is a level",
};

const BMARKS = [...Object.values(B), "Level 2", "Lesson 2", "Learning 2", "Practice 2", "Quiz 2", "Plan 2", "Question 2", "Heading 2", "video-2", "plan-2"];
const leaks = (text: string): string[] => BMARKS.filter((m) => text.includes(m));
const stable = (body: unknown): string => JSON.stringify(body).replace(/"generated_at":"[^"]*"/g, '"generated_at":"<time>"');
const asked = async (method: "get" | "post", url: string, body?: unknown) => {
  const res = await send(method, url, body);
  return { status: res.status, text: stable(res.body) };
};
/** An answer with the id that was asked about taken out, so that two answers about different ids can be compared. */
const without = (text: string, id: string): string => text.split(id).join("<id>");

describe("the learner routes", () => {
  it("are the ones the route inventory lists, each placed here or excluded with its reason", () => {
    const placed = [...Object.keys(LISTS), ...Object.keys(OPENS), ...Object.keys(WRITES), ...Object.keys(EXCLUDED)].sort();
    expect(placed).toEqual([...learnerRoutes()].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });
});

describe("a level that is switched off", () => {
  it("is in the database the learner is asking: level B is off, level A is on, and the learner has progress on both", () => {
    seed(true);
    expect(rowsOf(sequelize.models.levels).map((r) => [r.levelid, r.levelstatus])).toEqual([[A.level, true], [B.level, false]]);
    expect(rowsOf(sequelize.models.studentlevelsprogress)).toHaveLength(2);
    seed(false);
    expect(rowsOf(sequelize.models.levels)).toHaveLength(1);
  });

  describe.each(Object.entries(LISTS))("%s", (route, { url, shows }) => {
    it("answers the same with the switched-off level as without it, and does not mention it", async () => {
      seed(false);
      const alone = await asked("get", url);
      seed(true);
      const withB = await asked("get", url);
      expect(alone.status).toBe(200);
      expect(withB.status).toBe(200);
      expect(leaks(withB.text)).toEqual([]);
      expect(withB.text).toBe(alone.text);
      for (const mark of shows ?? []) expect(withB.text).toContain(mark);
      expect(rawQueries).toEqual([]);
      void route;
    });
  });

  describe.each(Object.entries(OPENS))("%s", (route, { url, of, shows }) => {
    it("answers for level A, and for level B exactly as for an id that names nothing", async () => {
      seed(true);
      const a = await asked("get", url(A[of]));
      const b = await asked("get", url(B[of]));
      const missing = await asked("get", url(NOWHERE));
      expect(missing.status).toBe(404);
      expect(a.status).toBe(200);
      for (const mark of shows ?? []) expect(a.text).toContain(mark);
      expect(leaks(b.text)).toEqual([]);
      expect({ status: b.status, body: without(b.text, B[of]) }).toEqual({ status: missing.status, body: without(missing.text, NOWHERE) });
      // and level A is the same answer whether or not level B exists
      seed(false);
      expect(await asked("get", url(A[of]))).toEqual(a);
      expect(rawQueries).toEqual([]);
      void route;
    });
  });

  describe.each(Object.entries(WRITES))("%s", (route, { url, of, body }) => {
    it("saves a result for level A, and for level B answers as an id that names nothing does and writes nothing", async () => {
      seed(true);
      writes = [];
      const a = await asked("post", url(A), body(A));
      expect(a.status).toBeLessThan(300);
      expect(writes.length).toBeGreaterThan(0);
      writes = [];
      const b = await asked("post", url(B), body(B));
      expect(writes).toEqual([]);
      const none = { ...Object.fromEntries(Object.keys(B).map((k) => [k, NOWHERE])) } as Ids;
      const missing = await asked("post", url(none), body(none));
      expect(writes).toEqual([]);
      expect(missing.status).toBe(404);
      expect(leaks(b.text)).toEqual([]);
      expect({ status: b.status, body: without(b.text, B[of]) }).toEqual({ status: missing.status, body: without(missing.text, NOWHERE) });
      void route;
    });
  });

  describe("the switch is what keeps it away", () => {
    const switchOn = () => {
      for (const row of rowsOf(sequelize.models.levels)) if (row.levelid === B.level) row.levelstatus = true;
    };
    it("level B is listed and opens once it is switched on (so the answers above are because it is off, not because it is missing)", async () => {
      seed(true);
      switchOn();
      for (const [route, { url, of }] of Object.entries(OPENS)) {
        const b = await asked("get", url(B[of]));
        expect([route, b.status]).toEqual([route, 200]);
      }
      for (const url of ["/level/all", "/Lesson/all", `/level/grade/${GRADE}`]) {
        expect([url, (await asked("get", url)).text.includes(B.level)]).toEqual([url, true]);
      }
      const a = await asked("post", WRITES["POST /result/lesson/quiz/:lessonquizid"].url(B), WRITES["POST /result/lesson/quiz/:lessonquizid"].body(B));
      expect(a.status).toBeLessThan(300);
    });

    it("a level whose switch the database hands back as 0 or 1 is read the same as false or true", async () => {
      seed(true);
      for (const row of rowsOf(sequelize.models.levels)) row.levelstatus = row.levelid === B.level ? 0 : 1;
      expect((await asked("get", `/Lesson/level/${B.level}`)).status).toBe(404);
      expect((await asked("get", `/Lesson/level/${A.level}`)).status).toBe(200);
    });
  });

  describe("who is held to it", () => {
    const token = (role: SchoolRole): Token => ({ studentid: STUDENT, schooluserid: SCHOOLUSER, schooluserrole: role, schoolid: SCHOOL, organisationid: ORG } as Token);
    it("a learner is; school staff keep to the curriculum rule and can still open it by id (a facilitator can check a draft module)", async () => {
      seed(true);
      for (const [kind, id] of [["level", B.level], ["lesson", B.lesson], ["lessonlearning", B.learning], ["lessonplan", B.plan], ["lessonpractice", B.practice], ["lessonquiz", B.quiz], ["lessonpracticequestion", B.practiceJoin], ["lessonquizquestion", B.quizJoin], ["levelquizquestion", B.levelQuestion], ["document", B.document]] as const) {
        expect([kind, await canAccessContent(token(SchoolRole.STUDENT), kind, id)]).toEqual([kind, false]);
        expect([kind, await canAccessContent(token(SchoolRole.TEACHER), kind, id)]).toEqual([kind, true]);
        expect([kind, await canAccessContent(token(SchoolRole.ADMIN), kind, id)]).toEqual([kind, true]);
      }
      // level A, and the curriculum and grade above both levels, are visible to everyone
      for (const role of [SchoolRole.STUDENT, SchoolRole.TEACHER]) {
        expect(await canAccessContent(token(role), "level", A.level)).toBe(true);
        expect(await canAccessContent(token(role), "grade", GRADE)).toBe(true);
        expect(await canAccessContent(token(role), "curriculum", CURRICULUM)).toBe(true);
      }
    });
  });
});
