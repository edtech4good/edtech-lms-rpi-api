import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { Config } from "src/config";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { Sequelize } from "sequelize";
import { ACTIVITY_SOURCES, LEGACY_TABLES } from "src/business/remove-unused-learner";
import { initModels } from "src/models/data-models/init-models";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * `DELETE /import/students/:schooluserid`: removes a learner login that has never been used.
 *
 * Driven over real HTTP through the real guards. The database is an in-memory store behind the one
 * `query`/`transaction` seam the route uses, so every statement the route issues is read here: the
 * deletes only take effect on commit, and a rollback leaves the store as it was.
 */
jest.mock("src/business/token-claims", () => ({
  ...jest.requireActual("src/business/token-claims"),
  checkTokenClaims: jest.fn().mockResolvedValue(undefined),
}));
const tokenExists = jest.fn();
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

const ORG_A = "a1000000-0000-4000-8000-00000000000a";
const ORG_B = "a1000000-0000-4000-8000-00000000000b";
const SCHOOL_A = "5c000000-0000-4000-8000-0000000000a1";
const SCHOOL_B = "5c000000-0000-4000-8000-0000000000b1";
const LOGIN = "su-learner-1";
const LEARNER_1 = "st-learner-1";
const LEARNER_2 = "st-learner-2";

/** Every table and column that counts as use, named here independently of the route's own list. */
const ACTIVITY: Array<{ table: string; column: string; id: string }> = [
  { table: "tokens", column: "lmsuserid", id: LOGIN },
  { table: "rpiuseraccess", column: "userid", id: LOGIN },
  { table: "studentappusages", column: "schooluserid", id: LOGIN },
  { table: "accesslog", column: "schooluserid", id: LOGIN },
  { table: "studentprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentlearningsprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentpracticesprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentquizzesprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentgradesprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentlevelsprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentlessonsprogress", column: "studentid", id: LEARNER_1 },
  { table: "studentawards", column: "studentid", id: LEARNER_1 },
  { table: "studentcertificates", column: "studentid", id: LEARNER_1 },
  { table: "studentpoints", column: "studentid", id: LEARNER_1 },
  { table: "studentactives", column: "studentid", id: LEARNER_1 },
  { table: "studenttrash", column: "studentid", id: LEARNER_1 },
];

type Login = { schooluserid: string; schooluserrole: number; schoolid: string };
type Learner = { studentid: string; schooluserid: string; schoolid: string | null };

let logins: Login[];
let learners: Learner[];
let tokenRows: string[];
let activity: Set<string>;
let statements: string[];
let begun: () => void;
let missingTables: string[];

const seed = () => {
  logins = [{ schooluserid: LOGIN, schooluserrole: SchoolRole.STUDENT, schoolid: SCHOOL_A }];
  learners = [
    { studentid: LEARNER_1, schooluserid: LOGIN, schoolid: SCHOOL_A },
    { studentid: LEARNER_2, schooluserid: LOGIN, schoolid: SCHOOL_A },
  ];
  tokenRows = [];
  activity = new Set();
  statements = [];
  begun = () => undefined;
  missingTables = [];
};

const fakeQuery = async (sql: string, options: { replacements?: Record<string, any>; transaction?: { pending?: string[] } }) => {
  const r = options.replacements ?? {};
  statements.push(sql.replace(/\s+/g, " "));
  if (/^SELECT schooluserid, schooluserrole, schoolid FROM schoolusers/.test(sql)) {
    return logins.filter((l) => l.schooluserid === r.id);
  }
  if (/^SELECT studentid, schoolid FROM students/.test(sql)) {
    return learners.filter((l) => l.schooluserid === r.id);
  }
  if (/FROM information_schema.tables/.test(sql)) {
    return (r.names as string[]).filter((n) => !missingTables.includes(n)).map((name) => ({ name }));
  }
  const check = /^SELECT 1 AS found FROM `(\w+)` WHERE `(\w+)` IN/.exec(sql);
  if (check) {
    return (r.ids as string[]).some((id) => activity.has(`${check[1]}.${check[2]}.${id}`)) ? [{ found: 1 }] : [];
  }
  const del = /^DELETE FROM (\w+) WHERE/.exec(sql);
  if (del) {
    options.transaction?.pending?.push(del[1]);
    return [];
  }
  throw new Error(`unexpected statement: ${sql}`);
};

const fakeDb = {
  query: jest.fn(fakeQuery),
  transaction: jest.fn(async () => {
    begun();
    const tx = {
      pending: [] as string[],
      commit: jest.fn(async () => {
        for (const table of tx.pending) {
          if (table === "tokens") tokenRows = [];
          if (table === "students") learners = [];
          if (table === "schoolusers") logins = [];
        }
      }),
      rollback: jest.fn(async () => undefined),
    };
    return tx;
  }),
};

const tokenFor = (schooluserrole: SchoolRole) =>
  `Bearer ${sign({ jti: "t", schooluserid: `u-${schooluserrole}`, schooluserrole }, Config.fortyk.api.rpi.applicationsecret, { expiresIn: "5m" })}`;

const stored = () => ({ logins: logins.length, learners: learners.length, tokens: tokenRows.length });
const untouched = { logins: 1, learners: 2, tokens: 0 };

describe("DELETE /import/students/:schooluserid", () => {
  let app: INestApplication;
  const originalOffline = Config.fortyk.api.rpi.offline;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ImportController], providers: [JwtAccessStrategy] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    seed();
    tokenExists.mockResolvedValue(true);
    jest.spyOn(dbinstance, "getdbinstance").mockReturnValue(fakeDb as never);
    jest.spyOn(organisations, "findOne").mockImplementation((async (opts: any) => ({
      organisationid: opts.where.organisationid,
      organisationstatus: true,
      isdeleted: false,
    })) as never);
    jest.spyOn(schools, "scope").mockImplementation((() => ({
      findAll: async (opts: any) => (opts.where.organisationid === ORG_A ? [{ schoolid: SCHOOL_A }] : opts.where.organisationid === ORG_B ? [{ schoolid: SCHOOL_B }] : []),
    })) as never);
    Config.fortyk.api.rpi.offline = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Config.fortyk.api.rpi.offline = originalOffline;
  });

  afterAll(async () => {
    await app.close();
  });

  const NO_HEADER = null;
  const call = (org: string | null = ORG_A, id: string = LOGIN, authorization: string | undefined = Config.fortyk.api.serversynckey) => {
    let req = request(app.getHttpServer()).delete(`/import/students/${id}`);
    if (authorization) req = req.set("Authorization", authorization);
    if (org !== NO_HEADER) req = req.set("X-Organisation-Id", org);
    return req;
  };

  it("removes the learner rows and the login of a learner who was never used", async () => {
    const res = await call().expect(200);
    expect(res.body).toEqual({ removed: true });
    expect(stored()).toEqual({ logins: 0, learners: 0, tokens: 0 });
    const deletes = statements.filter((s) => s.startsWith("DELETE")).map((s) => /DELETE FROM (\w+)/.exec(s)![1]);
    expect(deletes).toEqual(["tokens", "students", "schoolusers"]);
  });

  it("answers absent, and changes nothing, for an id that is not here", async () => {
    const res = await call(ORG_A, "no-such-login").expect(200);
    expect(res.body).toEqual({ removed: false, absent: true });
    expect(stored()).toEqual(untouched);
    expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
  });

  const elsewhere = { removed: false, reason: "elsewhere" };

  it("answers 409 elsewhere, and changes nothing, for another organisation's learner", async () => {
    const res = await call(ORG_B).expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(stored()).toEqual(untouched);
    expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
  });

  it("answers 409 elsewhere for another organisation's learner whose learner rows name no school", async () => {
    learners.forEach((l) => (l.schoolid = null));
    const res = await call(ORG_B).expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(stored()).toEqual(untouched);
  });

  it("answers 409 elsewhere, and changes nothing, for an organisation that has no schools here", async () => {
    const res = await call("a1000000-0000-4000-8000-00000000000c").expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(stored()).toEqual(untouched);
  });

  it.each([SchoolRole.TEACHER, SchoolRole.ADMIN, SchoolRole.SUPERADMIN])("answers 409 elsewhere, and changes nothing, for a login whose role is %s", async (role) => {
    logins[0].schooluserrole = role;
    const res = await call().expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(stored()).toEqual(untouched);
  });

  it("answers 409 elsewhere when one of the login's learner rows sits in a school of another organisation", async () => {
    learners[1].schoolid = SCHOOL_B;
    const res = await call().expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(stored()).toEqual(untouched);
  });

  it("answers 409 elsewhere when only learner rows carry the id", async () => {
    logins = [];
    const res = await call().expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(learners).toHaveLength(2);
  });

  it("answers absent when the id is gone by the time the transaction looks again", async () => {
    begun = () => {
      logins = [];
      learners = [];
    };
    const res = await call().expect(200);
    expect(res.body).toEqual({ removed: false, absent: true });
    expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
  });

  it("answers 409 elsewhere when the login moves out of the organisation before the transaction looks again", async () => {
    begun = () => (logins[0].schoolid = SCHOOL_B);
    const res = await call().expect(409);
    expect(res.body).toEqual(elsewhere);
    expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
  });

  describe("a learner who has been used", () => {
    it.each(ACTIVITY)("is refused with 409 and nothing is deleted when `$table`.`$column` has a row", async ({ table, column, id }) => {
      activity.add(`${table}.${column}.${id}`);
      const res = await call().expect(409);
      expect(res.body).toEqual({ removed: false, reason: "activity" });
      expect(stored()).toEqual(untouched);
      expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
    });

    it("does not fail on a table this database does not have, and still checks the ones it has", async () => {
      missingTables = ["accesslog", "studentpracticesprogress", "studentquizzesprogress"];
      activity.add(`accesslog.schooluserid.${LOGIN}`); // not reachable: the table is not there
      await call().expect(200);
      expect(statements.some((s) => /`accesslog`|`studentpracticesprogress`|`studentquizzesprogress`/.test(s))).toBe(false);
      seed();
      missingTables = ["accesslog"];
      activity.add(`studentpoints.studentid.${LEARNER_1}`);
      await call().expect(409);
    });

    it("fails closed, with 500 and nothing deleted, when an activity table that is not a legacy one is missing", async () => {
      missingTables = ["studentpoints"];
      await call().expect(500);
      expect(stored()).toEqual(untouched);
      expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
    });

    it.each(ACTIVITY.filter((a) => !LEGACY_TABLES.has(a.table)).map((a) => a.table))("fails closed when `%s` is missing", async (table) => {
      missingTables = [table];
      await call().expect(500);
      expect(stored()).toEqual(untouched);
      expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
    });

    it("counts a row of the login's second learner row as use", async () => {
      activity.add(`studentpoints.studentid.${LEARNER_2}`);
      await call().expect(409);
      expect(stored()).toEqual(untouched);
    });

    it("is refused when the use is written after the first look but before the delete, and nothing is deleted", async () => {
      begun = () => activity.add(`rpiuseraccess.userid.${LOGIN}`); // a sign-in lands as the transaction starts
      const res = await call().expect(409);
      expect(res.body).toEqual({ removed: false, reason: "activity" });
      expect(stored()).toEqual(untouched);
      expect(statements.some((s) => s.startsWith("DELETE"))).toBe(false);
    });

    it("locks the login row before it looks again inside the transaction", async () => {
      await call().expect(200);
      expect(statements.filter((s) => /FOR UPDATE$/.test(s)).length).toBeGreaterThanOrEqual(2);
      expect(statements.filter((s) => /FROM schoolusers/.test(s) && /FOR UPDATE$/.test(s))).toHaveLength(1);
    });
  });

  describe("the tables that show use", () => {
    const registered = (): Set<string> => {
      const sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
      initModels(sequelize);
      return new Set(
        Object.values(sequelize.models).map((m) => {
          const name = m.getTableName();
          return String(typeof name === "string" ? name : (name as { tableName: string }).tableName).toLowerCase();
        })
      );
    };

    it("every table the route checks, except the named legacy ones, is a table the models register", () => {
      const tables = registered();
      const unknown = ACTIVITY_SOURCES.filter((x) => !LEGACY_TABLES.has(x.table)).filter((x) => !tables.has(x.table.toLowerCase()));
      expect(unknown).toEqual([]);
    });

    it("no legacy table is one the models register, so the legacy list hides nothing", () => {
      const tables = registered();
      expect([...LEGACY_TABLES].filter((t) => tables.has(t))).toEqual([]);
    });

    it("the spec's own list and the route's list name the same tables", () => {
      expect(ACTIVITY.map((a) => a.table).sort()).toEqual([...new Set(ACTIVITY_SOURCES.map((x) => x.table))].sort());
    });
  });

  describe("who may call it", () => {
    it.each([SchoolRole.STUDENT, SchoolRole.TEACHER, SchoolRole.ADMIN, SchoolRole.SUPERADMIN])("refuses a user token of role %s with 403", async (role) => {
      await call(ORG_A, LOGIN, tokenFor(role)).expect(403);
      expect(stored()).toEqual(untouched);
    });

    it("refuses a user token even on a classroom Pi", async () => {
      Config.fortyk.api.rpi.offline = true;
      await call(ORG_A, LOGIN, tokenFor(SchoolRole.ADMIN)).expect(403);
      expect(stored()).toEqual(untouched);
    });

    it("gives 401 with no credential, and for the sync key sent as a Bearer token", async () => {
      await request(app.getHttpServer()).delete(`/import/students/${LOGIN}`).set("X-Organisation-Id", ORG_A).expect(401);
      await call(ORG_A, LOGIN, `Bearer ${Config.fortyk.api.serversynckey}`).expect(401);
      expect(stored()).toEqual(untouched);
    });

    it("refuses the server key with no organisation header with 400", async () => {
      await call(NO_HEADER).expect(400);
      expect(stored()).toEqual(untouched);
    });

    it.each(["", "Platform", "not an id", "platform"])("refuses the organisation header %p with 400", async (header) => {
      await call(header).expect(400);
      expect(stored()).toEqual(untouched);
    });
  });
});
