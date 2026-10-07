import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import AdmZip from "adm-zip";
import { sign } from "jsonwebtoken";
import { Op, Sequelize } from "sequelize";
import request from "supertest";
import { Config } from "src/config";
import { mayTakeServerLogs } from "src/business/export-scope";
import { resolveReportScope, SERVER_USER_ID } from "src/business/report-scope";
import { SyncReport } from "src/business/sync.report";
import { checkTokenClaims } from "src/business/token-claims";
import { initModels } from "src/models/data-models/init-models";
import { organisations } from "src/models/data-models/organisations";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
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
import { SchoolRole } from "src/models/enums/school.role.enum";
import { ExportController } from "src/modules/export/export.controller";
import { JwtAccessStrategy } from "src/services/auth.strategy";

/**
 * The three data exports of the student API, over real HTTP through the real JWT strategy and the real guards
 * (organisations package 8, step 2): what each caller's zip holds.
 *
 * Fixtures: organisation X with two schools (each with learners and a login), organisation Y with one school, an
 * unowned school (a database from before owners were required; nobody signs in to it), a deleted unowned school, a
 * learner and a login that belong to no school, and a suspended organisation. Every learner has a row in every
 * progress table; one learner also has rows older than six months.
 *
 * What is real: the strategy, the guards, the report scope, `export-scope`, `SyncReport`, `LogBusiness`,
 * `SchoolUserBusiness.getschoolusers` and every query they make. What is faked: the database (an in-memory table
 * per model, with a `where` evaluator that does equality, lists and dates; a login's learner row is joined by id)
 * and the log directory (`fs`).
 *
 * Every export route has tests whose title starts with its `METHOD /path`, as the route inventory
 * (src/route-policy/route-inventory.spec.ts) looks them up.
 */
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists: jest.fn().mockResolvedValue(true) })),
}));
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readdirSync: jest.fn((dir: string) => (dir === "logs" ? ["RPI-API-info-1.log", "RPI-API-error-1.log", "other.log"] : jest.requireActual("fs").readdirSync(dir))),
  readFileSync: jest.fn((path: unknown, ...rest: unknown[]) =>
    typeof path === "string" && path.startsWith("logs/") ? `contents of ${path}` : (jest.requireActual("fs").readFileSync as (...a: unknown[]) => unknown)(path, ...rest),
  ),
}));

const uid = (ns: string, n: number): string => `${ns}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG_X = uid("a1", 1);
const ORG_Y = uid("b2", 1);
const ORG_Z = uid("c3", 1); // suspended
const ORG_NOWHERE = uid("ee", 1);
const SCH_X = uid("a1", 2);
const SCH_X2 = uid("a1", 3); // a second school of X
const SCH_Y = uid("b2", 2);
const SCH_L = uid("d4", 2); // unowned
const SCH_LD = uid("d6", 2); // unowned and deleted
const SCH_Z = uid("c3", 2);

const ST_X1 = uid("a1", 31);
const ST_X2 = uid("a1", 32);
const ST_X3 = uid("a1", 33); // learner of X's second school
const ST_Y1 = uid("b2", 31);
const ST_L1 = uid("d4", 31);
const ST_N = uid("ee", 31); // belongs to no school
const SU_X1 = uid("a1", 41);
const SU_X2 = uid("a1", 42);
const SU_X3 = uid("a1", 45);
const SU_TX = uid("a1", 43); // teacher of X
const SU_AX = uid("a1", 44); // admin of X
const SU_SX = uid("a1", 46); // super admin of X
const SU_TX2 = uid("a1", 47); // teacher of X's second school
const SU_Y1 = uid("b2", 41);
const SU_TY = uid("b2", 43);
const SU_L1 = uid("d4", 41);
const SU_TL = uid("d4", 43); // teacher of the unowned school
const SU_N = uid("ee", 41); // login of the learner with no school
const SU_O = uid("ee", 42); // a login with no school and no learner
const SU_STUDENT = uid("a1", 49);

const LEARNERS: Array<[string, string, string | null]> = [
  [ST_X1, SU_X1, SCH_X],
  [ST_X2, SU_X2, SCH_X],
  [ST_X3, SU_X3, SCH_X2],
  [ST_Y1, SU_Y1, SCH_Y],
  [ST_L1, SU_L1, SCH_L],
  [ST_N, SU_N, null],
];
const STAFF: Array<[string, SchoolRole, string | null]> = [
  [SU_TX, SchoolRole.TEACHER, SCH_X],
  [SU_AX, SchoolRole.ADMIN, SCH_X],
  [SU_SX, SchoolRole.SUPERADMIN, SCH_X],
  [SU_TX2, SchoolRole.TEACHER, SCH_X2],
  [SU_TY, SchoolRole.TEACHER, SCH_Y],
  [SU_TL, SchoolRole.TEACHER, SCH_L],
  [SU_O, SchoolRole.TEACHER, null],
];

/** What each scope may carry. */
const WHOLE_X = { studentids: [ST_X1, ST_X2, ST_X3], logins: [SU_X1, SU_X2, SU_X3, SU_TX, SU_AX, SU_SX, SU_TX2, SU_STUDENT] };
const SCHOOL_X = { studentids: [ST_X1, ST_X2], logins: [SU_X1, SU_X2, SU_TX, SU_AX, SU_SX, SU_STUDENT] };
const SCHOOL_Y_ONLY = { studentids: [ST_Y1], logins: [SU_Y1, SU_TY] };
const EVERYTHING = {
  studentids: [ST_X1, ST_X2, ST_X3, ST_Y1, ST_L1, ST_N],
  logins: [SU_X1, SU_X2, SU_X3, SU_TX, SU_AX, SU_SX, SU_TX2, SU_STUDENT, SU_Y1, SU_TY, SU_L1, SU_TL, SU_N, SU_O],
};

// ---------------------------------------------------------------------------------------------------------
// the fake database
// ---------------------------------------------------------------------------------------------------------
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tables = new Map<unknown, Row[]>();
const rowsOf = (model: unknown): Row[] => tables.get(model) ?? [];
const same = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b || (a == null && b == null);

const matchesValue = (actual: unknown, cond: unknown): boolean => {
  if (cond === undefined) throw new Error("a where value is undefined (Sequelize would throw too)");
  if (cond === null) return actual == null;
  if (Array.isArray(cond)) return cond.some((c) => same(actual, c));
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond === "object") {
    const symbols = Object.getOwnPropertySymbols(cond as object);
    if (symbols.length === 0) throw new Error("a where object this fake cannot evaluate");
    for (const sym of symbols) {
      const arg = (cond as Record<symbol, any>)[sym]; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (sym === Op.in && !(Array.isArray(arg) && arg.some((c: unknown) => same(actual, c)))) return false;
      else if (sym === Op.gt && !(actual instanceof Date && actual.getTime() > (arg as Date).getTime())) return false;
      else if (sym === Op.eq && !same(actual, arg)) return false;
      else if (![Op.in, Op.gt, Op.eq].includes(sym as never)) throw new Error(`an operator this fake does not evaluate: ${String(sym)}`);
    }
    return true;
  }
  return same(actual, cond);
};
const matchesWhere = (row: Row, where: any): boolean => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!where) return true;
  // the by-name narrowing of the school resolver: `where(fn("TRIM", col("schoolname")), name)`
  if (where.constructor?.name === "Where") return typeof row.schoolname === "string" && row.schoolname.trim() === String(where.logic);
  for (const [key, cond] of Object.entries(where)) {
    if (!matchesValue(row[key], cond)) return false;
  }
  return true;
};

const wrap = (row: Row, options?: { attributes?: { exclude?: string[] } | string[] }): Row => {
  const copy: Row = { ...row };
  const exclude = Array.isArray(options?.attributes) ? [] : options?.attributes?.exclude ?? [];
  for (const key of exclude) delete copy[key];
  Object.defineProperty(copy, "get", { value: () => ({ ...copy }), enumerable: false });
  return copy;
};

const install = () => {
  const models: unknown[] = [
    organisations, schools, students, schoolusers, studentprogress, studentprogressquestions, rpiuseraccess, studentactives,
    studentlearningprogress, studentgradesprogress, studentlevelsprogress, studentlessonsprogress, studentpoints, studentappusages,
  ];
  for (const model of models as Array<typeof schools>) {
    const filtered = (options: any) => rowsOf(model).filter((r) => matchesWhere(r, options?.where)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const out = (rows: Row[], options: any) => rows.map((r) => (options?.raw ? { ...r } : wrap(r, options))); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(model, "findAll").mockImplementation((async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      let rows = filtered(options);
      if ((model as unknown) === schoolusers && !options?.raw) {
        // the join of a login's learner row (the report data's login rows carry it)
        rows = rows.map((r) => ({ ...r, student: rowsOf(students).find((s) => s.schooluserid === r.schooluserid) ?? null }));
      }
      return out(rows, options);
    }) as never);
    jest.spyOn(model, "findOne").mockImplementation((async (options: any) => out(filtered(options).slice(0, 1), options)[0] ?? null) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  jest.spyOn(schools, "scope").mockReturnValue({
    findOne: (options: unknown) => schools.findOne(options as never),
    findAll: (options: unknown) => schools.findAll(options as never),
  } as never);
};

/** A Pi that holds one school: every other school is gone from the table, except the deleted one (deleted schools do not count). */
const piWithOnly = (schoolid: string) => {
  seed();
  tables.set(schools, rowsOf(schools).filter((s) => s.schoolid === schoolid || s.isdeleted));
};

const RECENT = () => new Date(Date.now() - 24 * 3600 * 1000);
const OLD = () => new Date(Date.now() - 300 * 24 * 3600 * 1000);

const seed = () => {
  tables.clear();
  const put = (model: unknown, rows: Row[]) => tables.set(model, [...rowsOf(model), ...rows]);
  put(organisations, [
    { organisationid: ORG_X, organisationstatus: true, isdeleted: false },
    { organisationid: ORG_Y, organisationstatus: true, isdeleted: false },
    { organisationid: ORG_Z, organisationstatus: false, isdeleted: false },
  ]);
  put(schools, [
    { schoolid: SCH_X, schoolname: "School X", organisationid: ORG_X, isdeleted: false, curriculums: [] },
    { schoolid: SCH_X2, schoolname: "School X Two", organisationid: ORG_X, isdeleted: false, curriculums: [] },
    { schoolid: SCH_Y, schoolname: "School Y", organisationid: ORG_Y, isdeleted: false, curriculums: [] },
    { schoolid: SCH_L, schoolname: "Legacy School", organisationid: null, isdeleted: false, curriculums: [] },
    { schoolid: SCH_LD, schoolname: "Closed Legacy School", organisationid: null, isdeleted: true, curriculums: [] },
    { schoolid: SCH_Z, schoolname: "School Z", organisationid: ORG_Z, isdeleted: false, curriculums: [] },
  ]);
  put(students, LEARNERS.map(([studentid, schooluserid, schoolid]) => ({ studentid, schooluserid, schoolid, studentfirstname: "L", isactive: 1 })));
  put(schoolusers, [
    ...LEARNERS.map(([, schooluserid, schoolid]) => ({ schooluserid, schoolusername: `u-${schooluserid.slice(0, 4)}`, schooluserrole: SchoolRole.STUDENT, schoolid, schooluserstatus: true, schooluserpasswordhash: "HASH" })),
    ...STAFF.map(([schooluserid, role, schoolid]) => ({ schooluserid, schoolusername: `t-${schooluserid.slice(0, 4)}`, schooluserrole: role, schoolid, schooluserstatus: true, schooluserpasswordhash: "HASH" })),
    { schooluserid: SU_STUDENT, schoolusername: "x.pupil", schooluserrole: SchoolRole.STUDENT, schoolid: SCH_X, schooluserstatus: true, schooluserpasswordhash: "HASH" },
  ]);
  const rowsForEachLearner = (build: (studentid: string, schooluserid: string, n: number) => Row) =>
    LEARNERS.map(([studentid, schooluserid], n) => build(studentid, schooluserid, n));
  put(studentprogress, [
    ...rowsForEachLearner((studentid, _u, n) => ({ studentprogressid: uid("f1", n), studentid, starttime: RECENT(), ispass: 1 })),
    { studentprogressid: uid("f1", 99), studentid: ST_X1, starttime: OLD(), ispass: 1 }, // older than six months: never exported
  ]);
  put(studentprogressquestions, [
    ...rowsForEachLearner((_s, _u, n) => ({ studentprogressquestionid: uid("f9", n), studentprogressid: uid("f1", n), referencequestionid: "q", iscorrect: 1 })),
    { studentprogressquestionid: uid("f9", 99), studentprogressid: uid("f1", 99), referencequestionid: "q", iscorrect: 1 },
  ]);
  put(rpiuseraccess, [
    ...rowsForEachLearner((_s, userid, n) => ({ rpiuseraccessid: uid("f2", n), userid, logintime: RECENT(), ipaddress: "10.0.0.1" })),
    ...STAFF.map(([userid], n) => ({ rpiuseraccessid: uid("f2", 50 + n), userid, logintime: RECENT(), ipaddress: "10.0.0.2" })),
  ]);
  put(studentactives, rowsForEachLearner((studentid, _u, n) => ({ studentactiveid: uid("f3", n), studentid, created_at: RECENT() })));
  put(studentlearningprogress, rowsForEachLearner((studentid, _u, n) => ({ studentlearningprogressid: uid("f4", n), studentid, lastupdated: RECENT() })));
  put(studentgradesprogress, rowsForEachLearner((studentid, _u, n) => ({ studentgradeprogressid: uid("f5", n), studentid, lastupdated: RECENT() })));
  put(studentlevelsprogress, rowsForEachLearner((studentid, _u, n) => ({ studentlevelprogressid: uid("f6", n), studentid, lastupdated: RECENT() })));
  put(studentlessonsprogress, rowsForEachLearner((studentid, _u, n) => ({ studentlessonprogressid: uid("f7", n), studentid, lastupdated: RECENT() })));
  put(studentpoints, rowsForEachLearner((studentid, _u, n) => ({ studentpointid: uid("f8", n), studentid, created_at: RECENT() })));
  put(studentappusages, [
    ...rowsForEachLearner((_s, schooluserid, n) => ({ studentappusageid: uid("fa", n), schooluserid, time_spent: 60, created_at: RECENT() })),
    ...STAFF.map(([schooluserid], n) => ({ studentappusageid: uid("fa", 50 + n), schooluserid, time_spent: 60, created_at: RECENT() })),
  ]);
};

// ---------------------------------------------------------------------------------------------------------
// callers
// ---------------------------------------------------------------------------------------------------------
const bearer = (claims: Record<string, unknown>): string =>
  `Bearer ${sign({ jti: "jti", ...claims }, Config.fortyk.api.rpi.applicationsecret, { expiresIn: "5m" })}`;
const token = (id: string, role: SchoolRole, school: string, org: string, schoolname = "forged name in the token") => ({
  sub: id, schooluserid: id, schooluserrole: role, schoolid: school, organisationid: org, schoolname,
});
const X_TEACHER = bearer(token(SU_TX, SchoolRole.TEACHER, SCH_X, ORG_X));
const X_ADMIN = bearer(token(SU_AX, SchoolRole.ADMIN, SCH_X, ORG_X));
const X_SUPERADMIN = bearer(token(SU_SX, SchoolRole.SUPERADMIN, SCH_X, ORG_X));
const X2_TEACHER = bearer(token(SU_TX2, SchoolRole.TEACHER, SCH_X2, ORG_X));
const Y_TEACHER = bearer(token(SU_TY, SchoolRole.TEACHER, SCH_Y, ORG_Y));
const X_PUPIL = bearer({ sub: SU_STUDENT, schooluserid: SU_STUDENT, studentid: ST_X1, schooluserrole: SchoolRole.STUDENT, schoolid: SCH_X, organisationid: ORG_X, schoolname: "School X" });
const CLAIMLESS_TEACHER = bearer({ sub: SU_TX, schooluserid: SU_TX, schooluserrole: SchoolRole.TEACHER, schoolname: "School X" });
// a token of a school that has no organisation, with no organisation claim: refused everywhere, on a Pi too
const PI_WINDOW_TEACHER = bearer({ sub: SU_TL, schooluserid: SU_TL, schooluserrole: SchoolRole.TEACHER, schoolid: SCH_L, organisationid: null, schoolname: "Legacy School" });
// an older token of the same school: no school id either, only the name
const PI_WINDOW_TEACHER_BY_NAME = bearer({ sub: SU_TL, schooluserid: SU_TL, schooluserrole: SchoolRole.TEACHER, schoolname: "Legacy School" });
const PI_WINDOW_DELETED = bearer({ sub: SU_TL, schooluserid: SU_TL, schooluserrole: SchoolRole.TEACHER, schoolid: SCH_LD, schoolname: "Closed Legacy School" });

type Caller = { bearer: string } | { key: true; org?: string };
const KEY = () => Config.fortyk.api.serversynckey;

const originalOffline = Config.fortyk.api.rpi.offline;

describe("the data exports are confined to the caller's scope (organisations package 8, step 2)", () => {
  let app: INestApplication;
  let sequelize: Sequelize;

  beforeAll(async () => {
    sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
    initModels(sequelize);
    const moduleRef = await Test.createTestingModule({ controllers: [ExportController], providers: [JwtAccessStrategy] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await sequelize.close();
  });
  beforeEach(() => {
    Config.fortyk.api.rpi.offline = false;
    install();
    seed();
  });
  afterEach(() => {
    Config.fortyk.api.rpi.offline = originalOffline;
    jest.restoreAllMocks();
  });

  const get = (path: string, caller: Caller, extraHeaders: Record<string, string> = {}) => {
    let req = request(app.getHttpServer()).get(path);
    if ("bearer" in caller) {
      req = req.set("Authorization", caller.bearer);
    } else {
      req = req.set("Authorization", KEY());
      if (caller.org !== undefined) req = req.set("X-Organisation-Id", caller.org);
    }
    for (const [k, v] of Object.entries(extraHeaders)) req = req.set(k, v);
    return req.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  };

  const zipOf = (body: Buffer) => new AdmZip(body);
  const entryNames = (body: Buffer) => zipOf(body).getEntries().map((e) => e.entryName).sort();
  const json = (body: Buffer, name: string) => JSON.parse(zipOf(body).readAsText(name));

  /** Every learner id and login id that appears anywhere in an export's rows. */
  const idsIn = (payload: { students?: any[]; studentprogress?: Record<string, any[]>; studentresult?: any[]; studentaccess?: any[]; log?: never }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const studentids = new Set<string>();
    const logins = new Set<string>();
    for (const login of payload.students ?? []) {
      logins.add(login.schooluserid);
      if (login.student?.studentid) studentids.add(login.student.studentid);
    }
    for (const rows of Object.values(payload.studentprogress ?? {})) {
      for (const row of rows) {
        if (row.studentid) studentids.add(row.studentid);
        if (row.schooluserid) logins.add(row.schooluserid);
      }
    }
    for (const row of payload.studentresult ?? []) studentids.add(row.studentid);
    for (const row of payload.studentaccess ?? []) logins.add(row.userid);
    return { studentids: [...studentids].sort(), logins: [...logins].sort() };
  };
  const sorted = (x: { studentids: string[]; logins: string[] }) => ({ studentids: [...x.studentids].sort(), logins: [...x.logins].sort() });
  const logIdsIn = (body: Buffer) => {
    const { log } = json(body, "log.ini");
    return idsIn({ studentprogress: log.progress, studentresult: log.result, studentaccess: log.access });
  };
  /** The log carries rows, not login records: a login with no sign-in or usage row (the pupil login of X with no learner) is not in it. */
  const inLog = (x: { studentids: string[]; logins: string[] }) => sorted({ studentids: x.studentids, logins: x.logins.filter((l) => l !== SU_STUDENT) });

  // -------------------------------------------------------------------------------------------------------
  describe("GET /export/report-data", () => {
    it("GET /export/report-data: a teacher gets syncfile.ini with their own school's learners and logins, and nothing else", async () => {
      const res = await get("/export/report-data", { bearer: X_TEACHER }).expect(200);
      expect(entryNames(res.body)).toEqual(["syncfile.ini"]);
      expect(res.headers["content-disposition"]).toBe('attachment; filename="sync-data.zip"');
      const payload = json(res.body, "syncfile.ini");
      expect(Object.keys(payload).sort()).toEqual(["students", "studentaccess", "studentprogress", "studentresult"].sort());
      expect(Object.keys(payload.studentprogress).sort()).toEqual(
        ["studentactives", "studentappusages", "studentgradesprogress", "studentlearningprogress", "studentlessonsprogress", "studentlevelsprogress", "studentpoints"],
      );
      expect(idsIn(payload)).toEqual(sorted(SCHOOL_X));
      // the six-month window still applies, and the password hash still never leaves
      expect(payload.studentresult.map((r: any) => r.studentprogressid)).not.toContain(uid("f1", 99)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(JSON.stringify(payload)).not.toContain("HASH");
    });

    it("GET /export/report-data: an admin and a super admin of a school get their school's rows, not their organisation's (the organisation's view is the platform's)", async () => {
      for (const who of [X_ADMIN, X_SUPERADMIN]) {
        const res = await get("/export/report-data", { bearer: who }).expect(200);
        expect(idsIn(json(res.body, "syncfile.ini"))).toEqual(sorted(SCHOOL_X));
      }
      // X's second school is the same organisation's and is still not in their export
      const second = await get("/export/report-data", { bearer: X2_TEACHER }).expect(200);
      expect(idsIn(json(second.body, "syncfile.ini"))).toEqual(sorted({ studentids: [ST_X3], logins: [SU_X3, SU_TX2] }));
    });

    it("GET /export/report-data: a teacher of another organisation gets that organisation's school and none of X's", async () => {
      const res = await get("/export/report-data", { bearer: Y_TEACHER }).expect(200);
      expect(idsIn(json(res.body, "syncfile.ini"))).toEqual(sorted(SCHOOL_Y_ONLY));
    });

    it("GET /export/report-data: the server key is not admitted (nothing calls it with the key), with any header or none", async () => {
      for (const org of [undefined, ORG_X, "platform", "", "PLATFORM", "not an id"]) {
        const res = await get("/export/report-data", { key: true, ...(org === undefined ? {} : { org }) });
        expect({ org, status: res.status }).toEqual({ org, status: 401 });
      }
    });

    // The scope still knows the key's views, and the payload is what it was for the platform; no route hands them
    // out today, so they are proved where they are built.
    const serverScope = (header?: string) => resolveReportScope({ headers: header === undefined ? {} : { "x-organisation-id": header }, user: { schooluserid: SERVER_USER_ID } as never });
    const payloadFor = async (scope: Awaited<ReturnType<typeof serverScope>>) => idsIn(JSON.parse(await new SyncReport().getreportdata(scope)));

    it("GET /export/report-data: the payload for the key's organisation scope carries every school of that organisation and no other", async () => {
      expect(await payloadFor(await serverScope(ORG_X))).toEqual(sorted(WHOLE_X));
      expect(await payloadFor(await serverScope(ORG_Y))).toEqual(sorted(SCHOOL_Y_ONLY));
    });

    it("GET /export/report-data: the payload for an organisation that is not here, or a suspended one, carries nothing", async () => {
      for (const org of [ORG_NOWHERE, ORG_Z]) {
        expect(await payloadFor(await serverScope(org))).toEqual({ studentids: [], logins: [] });
      }
    });

    it("GET /export/report-data: the payload for the platform scope is the whole server, including rows that belong to no school", async () => {
      expect(await serverScope("platform")).toBeNull();
      expect(await payloadFor(null)).toEqual(sorted(EVERYTHING));
    });

    it("GET /export/report-data: a key scope with no header, a blank one, another case or one that is not an identifier is refused (400) with one answer", async () => {
      const answers = new Set<string>();
      for (const org of [undefined, "", "   ", "PLATFORM", "Platform", "everything", "not an id", "'; drop table students; --"]) {
        const refusal = await serverScope(org).catch((e) => e);
        expect({ org, status: refusal.status ?? refusal.getStatus?.() }).toEqual({ org, status: 400 });
        answers.add(JSON.stringify({ message: refusal.message, fields: refusal.fields }));
      }
      expect(answers.size).toBe(1);
    });

    it("GET /export/report-data: a token's own scope wins over any header it sends", async () => {
      const res = await get("/export/report-data", { bearer: X_TEACHER }, { "X-Organisation-Id": "platform" }).expect(200);
      expect(idsIn(json(res.body, "syncfile.ini"))).toEqual(sorted(SCHOOL_X));
      const other = await get("/export/report-data", { bearer: X_TEACHER }, { "X-Organisation-Id": ORG_Y }).expect(200);
      expect(idsIn(json(other.body, "syncfile.ini"))).toEqual(sorted(SCHOOL_X));
    });

    it("GET /export/report-data: a token with no claims is refused (401), and so is a learner's token (403)", async () => {
      await get("/export/report-data", { bearer: CLAIMLESS_TEACHER }).expect(401);
      await get("/export/report-data", { bearer: X_PUPIL }).expect(403);
      await request(app.getHttpServer()).get("/export/report-data").expect(401);
    });

    it("GET /export/report-data: a token with no organisation claim is refused (401) on a classroom Pi as online, by school id or by name, and for a deleted school", async () => {
      for (const offline of [false, true]) {
        Config.fortyk.api.rpi.offline = offline;
        for (const bearer of [PI_WINDOW_TEACHER, PI_WINDOW_TEACHER_BY_NAME, PI_WINDOW_DELETED]) {
          await get("/export/report-data", { bearer }).expect(401);
        }
      }
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe("GET /export/log", () => {
    it("GET /export/log: an organisation's teacher online gets log.ini with their school's rows, and none of the server's log files", async () => {
      const res = await get("/export/log", { bearer: X_TEACHER }).expect(200);
      expect(entryNames(res.body)).toEqual(["log.ini"]);
      expect(logIdsIn(res.body)).toEqual(inLog(SCHOOL_X));
      expect(Object.keys(json(res.body, "log.ini").log).sort()).toEqual(["access", "progress", "result"]);
      expect(res.body.toString("latin1")).not.toContain("contents of logs/");
    });

    it("GET /export/log: an admin and a super admin online get their school's rows, and the other organisation's teacher theirs", async () => {
      for (const who of [X_ADMIN, X_SUPERADMIN]) {
        const res = await get("/export/log", { bearer: who }).expect(200);
        expect(logIdsIn(res.body)).toEqual(inLog(SCHOOL_X));
        expect(entryNames(res.body)).toEqual(["log.ini"]);
      }
      const y = await get("/export/log", { bearer: Y_TEACHER }).expect(200);
      expect(logIdsIn(y.body)).toEqual(sorted(SCHOOL_Y_ONLY));
      expect(entryNames(y.body)).toEqual(["log.ini"]);
    });

    it("GET /export/log: on a classroom Pi that holds one school (the operator's own machine) the log files are included as before, with the school's rows", async () => {
      Config.fortyk.api.rpi.offline = true;
      piWithOnly(SCH_X);
      const owned = await get("/export/log", { bearer: X_TEACHER }).expect(200);
      expect(entryNames(owned.body)).toEqual(["RPI-API-error-1.log", "RPI-API-info-1.log", "log.ini"]);
      expect(logIdsIn(owned.body)).toEqual(inLog(SCHOOL_X));
      piWithOnly(SCH_L);
      await get("/export/log", { bearer: PI_WINDOW_TEACHER }).expect(401); // a school with no organisation has no sign-in, even alone on a Pi
    });

    it("GET /export/log: on a classroom Pi that holds several schools, a school's teacher gets log.ini only, with their school's rows", async () => {
      Config.fortyk.api.rpi.offline = true; // the fixtures hold five live schools
      const res = await get("/export/log", { bearer: X_TEACHER }).expect(200);
      expect(entryNames(res.body)).toEqual(["log.ini"]);
      expect(logIdsIn(res.body)).toEqual(inLog(SCHOOL_X));
      await get("/export/log", { bearer: PI_WINDOW_TEACHER }).expect(401);
    });

    it("GET /export/log: the server key is not admitted (nothing sends it here), with or without a header", async () => {
      await get("/export/log", { key: true, org: ORG_X }).expect(401);
      await get("/export/log", { key: true, org: "platform" }).expect(401);
      await get("/export/log", { key: true }).expect(401);
    });

    it("GET /export/log: no claims is refused (401), a learner's token (403)", async () => {
      await get("/export/log", { bearer: CLAIMLESS_TEACHER }).expect(401);
      await get("/export/log", { bearer: X_PUPIL }).expect(403);
    });

    it("GET /export/log: the server's log files are for the platform view, and a Pi whose scope covers every school on it", async () => {
      const x = { organisationid: ORG_X, schoolids: [SCH_X] };
      expect(await mayTakeServerLogs(null)).toBe(true); // platform
      expect(await mayTakeServerLogs(x)).toBe(false); // an organisation's caller, online
      Config.fortyk.api.rpi.offline = true;
      expect(await mayTakeServerLogs(x)).toBe(false); // a Pi with several schools
      expect(await mayTakeServerLogs({ organisationid: ORG_X, schoolids: [SCH_X, SCH_X2, SCH_Y, SCH_L, SCH_Z] })).toBe(true); // a scope that covers them all
      piWithOnly(SCH_X);
      expect(await mayTakeServerLogs(x)).toBe(true); // a Pi with one (a deleted school does not count)
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe("GET /export/system-log/files", () => {
    it("GET /export/system-log/files: online, an organisation's teacher, admin and super admin get the answer for a role that is not allowed", async () => {
      const reference = await get("/export/system-log/files", { bearer: X_PUPIL }); // a role the guard refuses
      expect(reference.status).toBe(403);
      for (const who of [X_TEACHER, X_ADMIN, X_SUPERADMIN, Y_TEACHER]) {
        const res = await get("/export/system-log/files", { bearer: who });
        expect(res.status).toBe(403);
        expect(res.body.toString("utf8")).toBe(reference.body.toString("utf8"));
        expect(res.headers["content-type"]).toBe(reference.headers["content-type"]);
      }
    });

    it("GET /export/system-log/files: on a classroom Pi the log files are served, named by the school's stored name and not by the token's", async () => {
      Config.fortyk.api.rpi.offline = true;
      piWithOnly(SCH_X);
      const res = await get("/export/system-log/files", { bearer: X_TEACHER }).expect(200);
      expect(entryNames(res.body)).toEqual(["RPI-API-error-1.log", "RPI-API-info-1.log"]);
      const disposition = String(res.headers["content-disposition"]);
      expect(disposition).toContain("logfiles-School X-");
      expect(disposition).not.toContain("forged");
      piWithOnly(SCH_L);
      await get("/export/system-log/files", { bearer: PI_WINDOW_TEACHER }).expect(401);
    });

    it("GET /export/system-log/files: on a classroom Pi that holds several schools, a school's staff get the answer for a role that is not allowed", async () => {
      Config.fortyk.api.rpi.offline = true;
      const reference = await get("/export/system-log/files", { bearer: X_PUPIL });
      expect(reference.status).toBe(403);
      for (const who of [X_TEACHER, X_ADMIN]) {
        const res = await get("/export/system-log/files", { bearer: who });
        expect(res.status).toBe(403);
        expect(res.headers["content-type"]).toBe(reference.headers["content-type"]);
      }
      await get("/export/system-log/files", { bearer: PI_WINDOW_TEACHER }).expect(401);
    });

    it("GET /export/system-log/files: the server key is not admitted, and no claims is refused (401)", async () => {
      await get("/export/system-log/files", { key: true, org: "platform" }).expect(401);
      await get("/export/system-log/files", { key: true, org: ORG_X }).expect(401);
      await get("/export/system-log/files", { bearer: CLAIMLESS_TEACHER }).expect(401);
    });
  });

  // -------------------------------------------------------------------------------------------------------
  describe("a school with no organisation has no window, on a classroom Pi or online (token-claims)", () => {
    it("checkTokenClaims: an unowned school, deleted or not, by id or by name, is refused whatever the Pi flag", async () => {
      for (const offline of [false, true]) {
        Config.fortyk.api.rpi.offline = offline;
        await expect(checkTokenClaims({ schoolid: SCH_L })).rejects.toMatchObject({ status: 401 });
        await expect(checkTokenClaims({ schoolid: SCH_L, organisationid: null })).rejects.toMatchObject({ status: 401 });
        await expect(checkTokenClaims({ schoolname: "Legacy School" } as Record<string, unknown>)).rejects.toMatchObject({ status: 401 });
        await expect(checkTokenClaims({ schoolid: SCH_LD })).rejects.toMatchObject({ status: 401 });
        await expect(checkTokenClaims({ schoolname: "Closed Legacy School" } as Record<string, unknown>)).rejects.toMatchObject({ status: 401 });
      }
    });
  });
});
