import { Model, Op, Sequelize } from "sequelize";
import { Logger } from "src/config";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { ApiError } from "src/models/ApiError";
import { ReportScope } from "src/business/report-scope";
import { certificateEligibility, learnerEligibility, parseEligibilityRequest, quizState, EligibilityRequest } from "./certificate-eligibility";

/**
 * Certificate eligibility (the rule and the business function behind `POST /report/certificate-eligibility`).
 * The database is an in-memory fake (where, includes through the models' own associations); nothing here ran on MySQL.
 * The organisation boundary of the route over HTTP is proved in src/modules/org-boundary.leak.spec.ts.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const uid = (ns: string, n: number): string => `${ns}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
/**
 * `[fn("COUNT" | "SUM", col(..)), alias]` among the attributes of a read: the routes' level counts (`grade.countLevels`, which Sequelize turns
 * into a plain COUNT read, and the grouped `COUNT(levelid)` of getusergradesprogess) and the points sums of the lesson routes. Evaluated as
 * MySQL would: the rows that match the where (and the includes), grouped by `group` (one group for all when there is none), one row per
 * group with the plain attributes taken from the group's first row. An ungrouped aggregate answers one row even over no rows (COUNT 0, SUM
 * null), as SQL does. Any other function is not modelled and fails loudly.
 */
type Aggregate = { alias: string; fn: "COUNT" | "SUM"; col: string };
const aggregatesOf = (options: any): Aggregate[] => // eslint-disable-line @typescript-eslint/no-explicit-any
  (options?.attributes ?? [])
    .filter((a: any) => Array.isArray(a) && a[0] && a[0].constructor && a[0].constructor.name === "Fn") // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((a: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const name = String(a[0].fn).toUpperCase();
      if (name !== "COUNT" && name !== "SUM") throw new Error(`the fake database only evaluates COUNT and SUM, not ${a[0].fn}`);
      return { alias: String(a[1]), fn: name as "COUNT" | "SUM", col: String(a[0].args[0]?.col ?? "").split(".").pop() as string };
    });
const aggregate = (model: any, options: any): Row[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const aggregates = aggregatesOf(options);
  const rows = read(model, options);
  const groupBy: string[] = options.group ? (Array.isArray(options.group) ? options.group : [options.group]) : [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = JSON.stringify(groupBy.map((g) => r[g]));
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  if (groupBy.length === 0 && groups.size === 0) groups.set("[]", []);
  return [...groups.values()].map((members) => {
    const out: Row = {};
    for (const a of options.attributes) {
      if (typeof a === "string") out[a] = members[0]?.[a];
    }
    for (const g of aggregates) {
      if (g.fn === "COUNT") out[g.alias] = members.length;
      else out[g.alias] = members.length === 0 ? null : members.reduce((sum, m) => sum + Number(m[g.col] ?? 0), 0);
    }
    return out;
  });
};
const shape = (model: any, options: any, rows: Row[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const includes = includesOf(options?.include);
  return rows.map((r) => (options?.raw ? { ...r } : instanceOf(model, r, includes)));
};

const install = () => {
  const models = Object.values(sequelize.models) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const model of models) {
    jest.spyOn(model, "scope").mockReturnValue(model as never);
    jest.spyOn(model, "findAll").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (aggregatesOf(options).length > 0) {
        const out = aggregate(model, options);
        const shaped = options.raw ? out : out.map((r) => instanceOf(model, r, [])); // a read without `raw` answers model instances, as Sequelize does
        return options.plain ? shaped[0] : shaped;
      }
      return shape(model, options, read(model, options));
    }) as never);
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
// the world
// ---------------------------------------------------------------------------------------------------------
const ORG = uid("a1", 1);
const SCH = uid("a1", 2);
const SCH_OTHER = uid("b2", 2);
const ORG_OTHER = uid("b2", 1);
const C = uid("c1", 1); // the curriculum under test
const C2 = uid("c1", 2); // another curriculum of the same organisation
const C_OTHER = uid("c1", 3); // another organisation's curriculum
const G1 = uid("c2", 1);
const G2 = uid("c2", 2);
const G_OFF = uid("c2", 3); // a switched-off grade
const G_C2 = uid("c2", 4); // a grade of the other curriculum
const L1 = uid("c3", 1); // two lessons with a quiz each, and a level quiz
const L2 = uid("c3", 2); // a second live level of G1
const L_OFF = uid("c3", 3); // switched off, with a quiz
const L3 = uid("c3", 4); // a level of G2
const L_EMPTY = uid("c3", 5); // live, no lessons, no level quiz
const L_GOFF = uid("c3", 6); // a live level of the switched-off grade
const L_DEL = uid("c3", 7); // deleted
const L_C2 = uid("c3", 8); // a level of the other curriculum
const LS1 = uid("c4", 1);
const LS2 = uid("c4", 2);
const LS_DEL = uid("c4", 3); // deleted lesson of L1
const LS_NOQ = uid("c4", 4); // lesson of L1 whose quiz has no active question
const LS_L2 = uid("c4", 5);
const LS_OFF = uid("c4", 6);
const LS_L3 = uid("c4", 7);
const LS_GOFF = uid("c4", 8);
const Q1 = uid("c5", 1);
const Q2 = uid("c5", 2);
const Q_DEL = uid("c5", 3);
const Q_NOQ = uid("c5", 4);
const Q_L2 = uid("c5", 5);
const Q_OFF = uid("c5", 6);
const Q_L3 = uid("c5", 7);
const Q_GOFF = uid("c5", 8);
const Q_UNRENDERED = uid("c5", 9); // its only question is of a kind the app cannot show
const LS_UNR = uid("c4", 9);
const LS_SW = uid("c4", 10); // a switched-off lesson of L1
const LS_QOFF = uid("c4", 11); // a live lesson of L1 whose quiz is switched off
const Q_SW = uid("c5", 10);
const Q_QOFF = uid("c5", 11);
const S = (n: number) => uid("d1", n);
const SCOPE: ReportScope = { organisationid: ORG, schoolids: [SCH] };

let ids = 0;
const nextId = () => uid("f9", ++ids);
const add = (model: { name: string }, row: Row) => tables.set(model.name, [...(tables.get(model.name) ?? []), row]);
const attempt = (studentid: string, quizid: string, type: 2 | 3, resultpercentage: number, verified: boolean) =>
  add({ name: "studentprogress" }, { studentprogressid: nextId(), studentid, studentprogressreferenceid: quizid, progresstype: type, resultpercentage, verified, ispass: resultpercentage >= 80 ? 1 : 0 });
const question = (templatetypeid = 1): string => {
  const questionid = nextId();
  add({ name: "questions" }, { questionid, templatetypeid, questionstatus: true, isdeleted: false });
  return questionid;
};
const lessonQuizQuestion = (lessonquizid: string, status = true, templatetypeid = 1) =>
  add({ name: "lessonquizquestions" }, { lessonquizquestionid: nextId(), lessonquizid, questionid: question(templatetypeid), lessonquizquestionstatus: status });
const levelQuizQuestion = (levelid: string) =>
  add({ name: "levelquizquestions" }, { levelquizquestionid: nextId(), levelid, questionid: question(), levelquizquestionstatus: true });

const seedWorld = () => {
  tables.clear();
  ids = 0;
  add({ name: "curriculums" }, { curriculumid: C, curriculumname: "Curriculum", organisationid: ORG, isdeleted: false });
  add({ name: "curriculums" }, { curriculumid: C2, curriculumname: "Second", organisationid: ORG, isdeleted: false });
  add({ name: "curriculums" }, { curriculumid: C_OTHER, curriculumname: "Elsewhere", organisationid: ORG_OTHER, isdeleted: false });
  const grade = (gradeid: string, curriculumid: string, gradeorder: number, gradestatus = true) =>
    add({ name: "grades" }, { gradeid, curriculumid, gradename: `Grade ${gradeorder}`, gradeorder, gradestatus, isdeleted: false });
  grade(G1, C, 1); grade(G2, C, 2); grade(G_OFF, C, 3, false); grade(G_C2, C2, 1);
  const level = (levelid: string, gradeid: string, levelorder: number, extra: Row = {}) =>
    add({ name: "levels" }, { levelid, gradeid, levelname: `Level ${levelorder}`, levelorder, levelstatus: true, isdeleted: false, ...extra });
  level(L1, G1, 1); level(L2, G1, 2); level(L_OFF, G1, 3, { levelstatus: false }); level(L3, G2, 1); level(L_EMPTY, G2, 2);
  level(L_GOFF, G_OFF, 1); level(L_DEL, G1, 4, { isdeleted: true }); level(L_C2, G_C2, 1);
  const lesson = (lessonid: string, levelid: string, lessonorder: number, extra: Row = {}) =>
    add({ name: "lessons" }, { lessonid, levelid, lessonname: `Lesson ${lessonorder}`, lessonorder, lessonstatus: true, isdeleted: false, ...extra });
  lesson(LS1, L1, 1); lesson(LS2, L1, 2); lesson(LS_DEL, L1, 3, { isdeleted: true }); lesson(LS_NOQ, L1, 4); lesson(LS_UNR, L1, 5);
  lesson(LS_SW, L1, 6, { lessonstatus: false }); lesson(LS_QOFF, L1, 7); lesson(LS_L2, L2, 1); lesson(LS_OFF, L_OFF, 1); lesson(LS_L3, L3, 1); lesson(LS_GOFF, L_GOFF, 1);
  const quiz = (lessonquizid: string, lessonid: string, name: string) =>
    add({ name: "lessonquizzes" }, { lessonquizid, lessonid, lessonquizname: name, lessonquizorder: 1, lessonquizstatus: true });
  quiz(Q1, LS1, "Quiz one"); quiz(Q2, LS2, "Quiz two"); quiz(Q_DEL, LS_DEL, "Quiz of a deleted lesson"); quiz(Q_NOQ, LS_NOQ, "Quiz with nothing to ask");
  quiz(Q_UNRENDERED, LS_UNR, "Quiz of unshowable questions"); quiz(Q_L2, LS_L2, "Quiz L2"); quiz(Q_OFF, LS_OFF, "Quiz of a switched-off level");
  quiz(Q_SW, LS_SW, "Quiz of a switched-off lesson"); 
  add({ name: "lessonquizzes" }, { lessonquizid: Q_QOFF, lessonid: LS_QOFF, lessonquizname: "Quiz switched off", lessonquizorder: 1, lessonquizstatus: false });
  quiz(Q_L3, LS_L3, "Quiz L3"); quiz(Q_GOFF, LS_GOFF, "Quiz of a switched-off grade");
  for (const q of [Q_SW, Q_QOFF, Q1, Q2, Q_DEL, Q_L2, Q_OFF, Q_L3, Q_GOFF]) lessonQuizQuestion(q);
  lessonQuizQuestion(Q_NOQ, false); // its only question is switched off
  lessonQuizQuestion(Q_UNRENDERED, true, 9); // its only question has no renderer
  levelQuizQuestion(L1); levelQuizQuestion(L_OFF);
  for (let n = 1; n <= 8; n += 1) add({ name: "students" }, { studentid: S(n), schoolid: SCH, schooluserid: nextId() });
  add({ name: "students" }, { studentid: S(20), schoolid: SCH_OTHER, schooluserid: nextId() }); // a learner of another organisation
};

let sequelizeInstance: Sequelize;
let queries: string[] = [];
beforeAll(() => {
  sequelizeInstance = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  sequelize = sequelizeInstance;
  initModels(sequelize);
  setuprelationshipforreport(sequelize);
});
beforeEach(() => {
  jest.restoreAllMocks();
  install();
  writes = [];
  rawQueries = [];
  queries = [];
  for (const model of Object.values(sequelize.models) as any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const method of ["findAll", "findOne", "count", "findAndCountAll"]) {
      const inner = (model[method] as jest.Mock).getMockImplementation() as (...a: unknown[]) => unknown;
      jest.spyOn(model, method).mockImplementation(((...args: unknown[]) => {
        queries.push(`${model.name}.${method}`);
        return inner(...args);
      }) as never);
    }
  }
  seedWorld();
});
afterEach(() => jest.restoreAllMocks());

const ask = (over: Partial<EligibilityRequest>, scope: ReportScope | null = SCOPE) =>
  certificateEligibility({ curriculumid: C, scope: "level", scopeid: L1, studentids: [S(1)], ...over }, scope);
const failure = async (p: Promise<unknown>): Promise<{ status: number; fields?: unknown }> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return { status: err.getStatus(), fields: err.fields };
    throw err;
  }
  return { status: 200 };
};

const quizOne = { id: Q1, kind: "lesson", name: "Quiz one" };
const reasonOf = (quiz: { id: string; kind: string; name: string }, lesson: { id: string; name: string } | undefined, state: string, bestpercent: number | null) => ({
  quiz, level: { id: L1, name: "Level 1" }, ...(lesson ? { lesson } : {}), state, bestpercent,
});
const lesson1 = { id: LS1, name: "Lesson 1" };

describe("the rule on one level: two lesson quizzes and the level quiz", () => {
  const passAll = (s: string) => {
    attempt(s, Q1, 2, 85, true); attempt(s, Q2, 2, 90, true); attempt(s, L1, 3, 80, true);
  };
  it("a. 85, 90 and 80 (exactly the mark), all marked by the server: ready", async () => {
    passAll(S(1));
    expect(await ask({ studentids: [S(1)] })).toEqual([{ studentid: S(1), status: "ready", reasons: [], quizcount: 3, passedcount: 3 }]);
  });

  it("b. a quiz whose best marked result is 60 is below, with the best percentage: not_yet", async () => {
    attempt(S(2), Q1, 2, 60, true); attempt(S(2), Q2, 2, 90, true); attempt(S(2), L1, 3, 80, true);
    expect(await ask({ studentids: [S(2)] })).toEqual([
      { studentid: S(2), status: "not_yet", reasons: [reasonOf(quizOne, lesson1, "below", 60)], quizcount: 3, passedcount: 2 },
    ]);
  });

  it("c. a quiz never attempted is not_taken with no percentage: not_yet", async () => {
    attempt(S(3), Q2, 2, 90, true); attempt(S(3), L1, 3, 90, true);
    expect(await ask({ studentids: [S(3)] })).toEqual([
      { studentid: S(3), status: "not_yet", reasons: [reasonOf(quizOne, lesson1, "not_taken", null)], quizcount: 3, passedcount: 2 },
    ]);
  });

  it("d. a quiz passed only by a result the server did not mark (92) is unverified; with the others passed the learner cannot be checked", async () => {
    attempt(S(4), Q1, 2, 92, false); attempt(S(4), Q2, 2, 90, true); attempt(S(4), L1, 3, 90, true);
    expect(await ask({ studentids: [S(4)] })).toEqual([
      { studentid: S(4), status: "cant_check", reasons: [reasonOf(quizOne, lesson1, "unverified", 92)], quizcount: 3, passedcount: 2 },
    ]);
  });

  it("e. an unverified quiz beside a quiz that is below: not_yet (below wins)", async () => {
    attempt(S(5), Q1, 2, 92, false); attempt(S(5), Q2, 2, 50, true); attempt(S(5), L1, 3, 90, true);
    const [row] = await ask({ studentids: [S(5)] });
    expect(row.status).toBe("not_yet");
    expect(row.reasons.map((r) => ("state" in r ? [r.quiz.id, r.state, r.bestpercent] : null))).toEqual([[Q1, "unverified", 92], [Q2, "below", 50]]);
  });

  it("a result with no percentage is not an attempt: with only such rows the quiz is not_taken, and beside a real attempt it changes nothing", async () => {
    attempt(S(1), Q1, 2, null as never, true);
    attempt(S(1), Q2, 2, 90, true); attempt(S(1), Q2, 2, null as never, false);
    attempt(S(1), L1, 3, 85, true);
    const [row] = await ask({ studentids: [S(1)] });
    expect(row.reasons).toEqual([reasonOf(quizOne, lesson1, "not_taken", null)]);
    expect(row.passedcount).toBe(2);
  });

  it("f. several attempts: 70 then 85 marked passes; 85 marked then 40 unmarked still passes", async () => {
    attempt(S(6), Q1, 2, 70, true); attempt(S(6), Q1, 2, 85, true);
    attempt(S(6), Q2, 2, 85, true); attempt(S(6), Q2, 2, 40, false);
    attempt(S(6), L1, 3, 99, true);
    expect(await ask({ studentids: [S(6)] })).toEqual([{ studentid: S(6), status: "ready", reasons: [], quizcount: 3, passedcount: 3 }]);
  });

  it("a level quiz result is counted only as a level quiz, and a lesson quiz result only as a lesson quiz", async () => {
    // a marked pass stored under the other kind of progress does not pass the quiz
    attempt(S(7), Q1, 3, 95, true); attempt(S(7), Q2, 2, 90, true); attempt(S(7), L1, 2, 95, true);
    const [row] = await ask({ studentids: [S(7)] });
    expect(row.status).toBe("not_yet");
    expect(row.passedcount).toBe(1);
  });

  it("names every quiz not passed, lesson quizzes in teaching order and the level quiz last", async () => {
    const [row] = await ask({ studentids: [S(8)] });
    expect(row).toEqual({
      studentid: S(8),
      status: "not_yet",
      reasons: [
        reasonOf(quizOne, lesson1, "not_taken", null),
        reasonOf({ id: Q2, kind: "lesson", name: "Quiz two" }, { id: LS2, name: "Lesson 2" }, "not_taken", null),
        reasonOf({ id: L1, kind: "level", name: "Level 1" }, undefined, "not_taken", null),
      ],
      quizcount: 3,
      passedcount: 0,
    });
  });
});

describe("which quizzes are in a scope", () => {
  const quizIds = async (scope: EligibilityRequest["scope"], scopeid: string): Promise<string[]> => {
    const [row] = await ask({ scope, scopeid, studentids: [S(8)] });
    return row.reasons.flatMap((r) => ("quiz" in r ? [r.quiz.id] : []));
  };
  it("g. a switched-off level, a deleted level, a deleted lesson, a quiz with no active question and a quiz of unshowable questions are left out", async () => {
    expect((await quizIds("level", L1)).sort()).toEqual([L1, Q1, Q2].sort());
    const off = await ask({ scope: "level", scopeid: L_OFF, studentids: [S(8)] });
    expect(off).toEqual([{ studentid: S(8), status: "not_yet", reasons: [{ reason: "no_quizzes" }], quizcount: 0, passedcount: 0 }]);
    const deleted = await ask({ scope: "level", scopeid: L_DEL, studentids: [S(8)] });
    expect(deleted[0].reasons).toEqual([{ reason: "no_quizzes" }]);
  });

  it("g. a live level with nothing to take is not_yet with no_quizzes, never ready", async () => {
    expect(await ask({ scope: "level", scopeid: L_EMPTY, studentids: [S(8)] })).toEqual([
      { studentid: S(8), status: "not_yet", reasons: [{ reason: "no_quizzes" }], quizcount: 0, passedcount: 0 },
    ]);
  });

  it("g. a switched-off grade, or a deleted one, makes its levels not live: grade scope and level scope answer no_quizzes, as the curriculum scope leaves them out", async () => {
    const none = (studentid: string) => [{ studentid, status: "not_yet", reasons: [{ reason: "no_quizzes" }], quizcount: 0, passedcount: 0 }];
    expect(await ask({ scope: "grade", scopeid: G_OFF, studentids: [S(8)] })).toEqual(none(S(8)));
    expect(await ask({ scope: "level", scopeid: L_GOFF, studentids: [S(8)] })).toEqual(none(S(8)));
    expect(await quizIds("curriculum", C)).not.toContain(Q_GOFF);
    tables.set("grades", (tables.get("grades") ?? []).map((g) => (g.gradeid === G2 ? { ...g, isdeleted: true } : g)));
    expect(await ask({ scope: "grade", scopeid: G2, studentids: [S(8)] })).toEqual(none(S(8)));
    expect(await ask({ scope: "level", scopeid: L3, studentids: [S(8)] })).toEqual(none(S(8)));
  });

  it("g. a switched-off lesson and a lesson quiz that is switched off are left out", async () => {
    const all = await quizIds("level", L1);
    expect(all).not.toContain(Q_SW);
    expect(all).not.toContain(Q_QOFF);
    expect(all.sort()).toEqual([L1, Q1, Q2].sort());
  });

  it("h. a grade covers its live levels; the curriculum covers every live grade's live levels", async () => {
    expect((await quizIds("grade", G1)).sort()).toEqual([L1, Q1, Q2, Q_L2].sort());
    expect((await quizIds("curriculum", C)).sort()).toEqual([L1, Q1, Q2, Q_L2, Q_L3].sort());
  });

  it("h. the answer's order is teaching order: grade, level, lesson", async () => {
    expect(await quizIds("curriculum", C)).toEqual([Q1, Q2, L1, Q_L2, Q_L3]);
  });
});

describe("who is answered, and what is refused", () => {
  it("i. a learner of another organisation and an id that names nobody are absent, the rest keep the order given and a repeat is answered once", async () => {
    const rows = await ask({ studentids: [S(2), S(20), uid("ee", 9), S(1), S(2)] });
    expect(rows.map((r) => r.studentid)).toEqual([S(2), S(1)]);
    expect(await ask({ studentids: [S(20)] })).toEqual([]);
  });

  it("i. another organisation's curriculum answers as one that does not exist (404), as does an id that names nothing", async () => {
    expect(await failure(ask({ curriculumid: C_OTHER, scope: "curriculum", scopeid: C_OTHER, studentids: [S(20)] }))).toEqual({ status: 404 });
    expect(await failure(ask({ curriculumid: uid("ee", 9), scope: "curriculum", scopeid: uid("ee", 9) }))).toEqual({ status: 404 });
    // a school's own list of curricula narrows it further
    expect(await failure(ask({ curriculumid: C }, { ...SCOPE, curriculumids: [C2] }))).toEqual({ status: 404 });
  });

  it("i. the unscoped platform view reads the learners of every organisation, and still not a curriculum that is not there", async () => {
    expect((await ask({ studentids: [S(20)] }, null)).map((r) => r.studentid)).toEqual([S(20)]);
    expect(await failure(ask({ curriculumid: uid("ee", 9), scope: "curriculum", scopeid: uid("ee", 9) }, null))).toEqual({ status: 404 });
  });

  it("j. a scope id that is not part of the curriculum is a 400 naming scopeid", async () => {
    const named = { status: 400, fields: [{ field: "scopeid", message: "That is not part of this curriculum." }] };
    expect(await failure(ask({ scope: "level", scopeid: L_C2 }))).toEqual(named); // a level of another curriculum
    expect(await failure(ask({ scope: "grade", scopeid: G_C2 }))).toEqual(named);
    expect(await failure(ask({ scope: "curriculum", scopeid: C2 }))).toEqual(named);
    expect(await failure(ask({ scope: "level", scopeid: G1 }))).toEqual(named); // right kind of id, wrong tier
    expect(await failure(ask({ scope: "level", scopeid: uid("ee", 9) }))).toEqual(named);
  });

  it("j. the body is checked, and the 400 names the field", () => {
    const bad = (body: unknown): unknown => {
      try {
        parseEligibilityRequest(body);
      } catch (err) {
        return err instanceof ApiError ? [err.getStatus(), err.fields?.map((f) => f.field)] : err;
      }
      return "accepted";
    };
    const good = { curriculumid: C, scope: "level", scopeid: L1, studentids: [S(1)] };
    expect(bad({ ...good, scope: "module" })).toEqual([400, ["scope"]]);
    expect(bad({ ...good, scope: undefined })).toEqual([400, ["scope"]]);
    expect(bad({ ...good, studentids: [] })).toEqual([400, ["studentids"]]);
    expect(bad({ ...good, studentids: undefined })).toEqual([400, ["studentids"]]);
    expect(bad({ ...good, studentids: "x" })).toEqual([400, ["studentids"]]);
    expect(bad({ ...good, studentids: [S(1), 7] })).toEqual([400, ["studentids"]]);
    expect(bad({ ...good, studentids: Array.from({ length: 501 }, (_, i) => `id${i}`) })).toEqual([400, ["studentids"]]);
    expect(bad({ ...good, curriculumid: "" })).toEqual([400, ["curriculumid"]]);
    expect(bad({ ...good, scopeid: 5 })).toEqual([400, ["scopeid"]]);
    expect(bad(null)).toEqual([400, ["curriculumid"]]);
    expect(bad({ ...good, studentids: Array.from({ length: 500 }, (_, i) => `id${i}`) })).toBe("accepted");
  });
});

describe("what the route does to the database", () => {
  it("k. writes nothing, and asks a fixed number of questions however many learners and quizzes there are", async () => {
    for (let n = 1; n <= 8; n += 1) { attempt(S(n), Q1, 2, 90, true); attempt(S(n), L1, 3, 70, false); }
    await ask({ scope: "curriculum", scopeid: C, studentids: [S(1)] });
    const one = queries.length;
    queries = [];
    await ask({ scope: "curriculum", scopeid: C, studentids: [1, 2, 3, 4, 5, 6, 7, 8].map(S) });
    expect(queries.length).toBe(one);
    expect(one).toBeLessThanOrEqual(9);
    expect(writes).toEqual([]);
  });
});

describe("the pure rule", () => {
  it("quizState: best attempt wins, a marked pass is never taken away, an unmarked one is only reported", () => {
    expect(quizState([])).toEqual({ state: "not_taken", bestpercent: null });
    expect(quizState([{ verified: true, percentage: 79.99 }])).toEqual({ state: "below", bestpercent: 79.99 });
    expect(quizState([{ verified: true, percentage: 80 }])).toEqual({ state: "passed", bestpercent: 80 });
    expect(quizState([{ verified: false, percentage: 100 }])).toEqual({ state: "unverified", bestpercent: 100 });
    expect(quizState([{ verified: false, percentage: 100 }, { verified: true, percentage: 50 }])).toEqual({ state: "unverified", bestpercent: 100 });
    expect(quizState([{ verified: true, percentage: 85 }, { verified: false, percentage: 40 }])).toEqual({ state: "passed", bestpercent: 85 });
  });
  it("learnerEligibility: no quizzes is not_yet", () => {
    expect(learnerEligibility("s", [], () => [])).toEqual({ studentid: "s", status: "not_yet", reasons: [{ reason: "no_quizzes" }], quizcount: 0, passedcount: 0 });
  });
});
