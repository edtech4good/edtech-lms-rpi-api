import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import { cloneDeep } from "lodash";
import { Op } from "sequelize";
import request from "supertest";
import { Config } from "src/config";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { curriculums } from "src/models/data-models/curriculums";
import { documents } from "src/models/data-models/documents";
import { organisations } from "src/models/data-models/organisations";
import { questions } from "src/models/data-models/questions";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { subjects } from "src/models/data-models/subjects";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { dbinstance } from "src/services/dbservice";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { ImportController } from "./import.controller";

/**
 * `PUT /import/ownership`, over real HTTP through the real guard and JWT
 * strategy, with the five owned models and `organisations` replaced by an
 * in-memory store (no database here; the real-database run is in the change
 * description).
 *
 * The store keeps whole rows, and the fake `update`/`create` apply EXACTLY the
 * values the business code hands them, so the before/after snapshot of every
 * table proves what the route changes: only `organisationid` columns and the
 * `organisations` rows. A write to any other column, any delete, and any write
 * to a login or learner table shows up as a diff or a failed `not.toHaveBeenCalled`.
 */

jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists: jest.fn().mockResolvedValue(true) })),
}));

const ORG_A = "0a000000-0000-4000-8000-00000000000a";
const ORG_B = "0b000000-0000-4000-8000-00000000000b";
const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SCHOOL = (n: number) => id("5c", n);
const CURR = (n: number) => id("c1", n);
const QUES = (n: number) => id("90", n);
const DOCS = (n: number) => id("d0", n);
const SUBJ = (n: number) => id("50", n);

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

const orgRow = (organisationid: string, extra: Row = {}) => ({
  organisationid,
  organisationname: organisationid === ORG_A ? "Org A" : "Org B",
  organisationcode: organisationid === ORG_A ? "orga" : "orgb",
  organisationstatus: true,
  uitheme: "kids",
  brandingconfig: null,
  settingsconfig: null,
  isdeleted: false,
  ...extra,
});

const OWNED: Array<{ key: "schools" | "curriculums" | "questions" | "documents" | "subjects"; pk: string; model: any; make: (n: number) => string }> = [
  { key: "schools", pk: "schoolid", model: schools, make: SCHOOL },
  { key: "curriculums", pk: "curriculumid", model: curriculums, make: CURR },
  { key: "questions", pk: "questionid", model: questions, make: QUES },
  { key: "documents", pk: "documentid", model: documents, make: DOCS },
  { key: "subjects", pk: "subjectid", model: subjects, make: SUBJ },
];

const freshStore = (): Store => {
  const store: Store = { organisations: [], students: [], schoolusers: [], tokens: [] };
  for (const t of OWNED) {
    // three rows each; some other columns that must never change
    store[t.key] = [1, 2, 3].map((n) => ({ [t.pk]: t.make(n), name: `${t.key}-${n}`, isdeleted: false, organisationid: null }));
  }
  store.schoolusers = [{ schooluserid: "su1", schoolusername: "demo", schooluserpasswordhash: "hash", schoolname: "S", schoolid: null }];
  store.students = [{ studentid: "st1", schoolname: "S", schoolid: null }];
  store.tokens = [{ token: "t1" }];
  return store;
};

let store: Store;
const calls: string[] = [];

const inList = (cond: unknown): string[] => (cond as Record<symbol, string[]>)[Op.in as unknown as symbol];

const installFakes = () => {
  for (const t of OWNED) {
    const fake = {
      findAll: jest.fn(async (opts: any) => {
        calls.push(`${t.key}.findAll`);
        const ids = inList(opts.where[t.pk]).map((x) => x.toLowerCase());
        return cloneDeep(store[t.key].filter((r) => ids.includes(String(r[t.pk]).toLowerCase()))).map((r) =>
          Object.fromEntries((opts.attributes as string[]).map((a) => [a, r[a]])),
        );
      }),
      update: jest.fn(async (values: Row, opts: any) => {
        calls.push(`${t.key}.update`);
        const ids = inList(opts.where[t.pk]).map((x) => x.toLowerCase());
        const mustBeNull = opts.where.organisationid === null;
        let n = 0;
        for (const r of store[t.key]) {
          if (ids.includes(String(r[t.pk]).toLowerCase()) && (!mustBeNull || r.organisationid === null)) {
            Object.assign(r, values);
            n += 1;
          }
        }
        return [n];
      }),
      count: jest.fn(async () => store[t.key].length),
    };
    jest.spyOn(t.model, "scope").mockReturnValue({ findAll: fake.findAll } as never);
    jest.spyOn(t.model, "update").mockImplementation(fake.update as never);
    jest.spyOn(t.model, "count").mockImplementation(fake.count as never);
    for (const forbidden of ["destroy", "bulkCreate", "create", "upsert", "truncate"]) {
      jest.spyOn(t.model, forbidden).mockImplementation((() => {
        throw new Error(`${t.key}.${forbidden} must not be called`);
      }) as never);
    }
  }

  jest.spyOn(organisations, "findAll").mockImplementation((async (opts: any) => {
    calls.push("organisations.findAll");
    const ids = inList(opts.where.organisationid).map((x) => x.toLowerCase());
    return store.organisations
      .filter((r) => ids.includes(String(r.organisationid).toLowerCase()))
      .map((r) => ({
        organisationid: r.organisationid,
        get: (col: string) => cloneDeep(r[col]),
        update: async (changed: Row) => {
          calls.push("organisations.update");
          Object.assign(r, changed);
        },
      }));
  }) as never);
  jest.spyOn(organisations, "create").mockImplementation((async (row: Row) => {
    calls.push("organisations.create");
    store.organisations.push(cloneDeep(row));
  }) as never);
  jest.spyOn(organisations, "destroy").mockImplementation((() => {
    throw new Error("organisations.destroy must not be called");
  }) as never);

  // The login and learner tables: nothing here may touch them at all.
  for (const model of [schoolusers, students]) {
    for (const method of ["update", "create", "destroy", "bulkCreate", "upsert", "findAll", "findOne"]) {
      jest.spyOn(model as any, method).mockImplementation((() => {
        throw new Error(`${(model as any).name}.${method} must not be called`);
      }) as never);
    }
  }
};

let tnx: { commit: jest.Mock; rollback: jest.Mock; LOCK: { UPDATE: string } };
let schemaRows: Array<{ tbl: string }>;

const FULL_SCHEMA = ["organisations", "schools", "curriculums", "questions", "documents", "subjects"].map((tbl) => ({ tbl }));

const tokenFor = (schooluserrole: SchoolRole) =>
  `Bearer ${sign({ jti: "jti", schooluserid: `u-${schooluserrole}`, schooluserrole }, Config.fortyk.api.rpi.applicationsecret, {
    expiresIn: "5m",
  })}`;

const validBody = (overrides: Row = {}) => ({
  format: 3,
  organisations: [orgRow(ORG_A), orgRow(ORG_B)],
  schools: { [SCHOOL(1)]: ORG_A, [SCHOOL(2)]: ORG_B },
  content: {
    curriculums: { [CURR(1)]: ORG_A },
    questions: { [QUES(1)]: ORG_A, [QUES(2)]: ORG_A },
    documents: {},
    subjects: { [SUBJ(1)]: ORG_B },
  },
  ...overrides,
});

describe("PUT /import/ownership", () => {
  let app: INestApplication;
  const originalOffline = Config.fortyk.api.rpi.offline;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [JwtAccessStrategy],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    Config.fortyk.api.rpi.offline = false;
    store = freshStore();
    calls.length = 0;
    schemaRows = FULL_SCHEMA;
    tnx = { commit: jest.fn().mockResolvedValue(undefined), rollback: jest.fn().mockResolvedValue(undefined), LOCK: { UPDATE: "UPDATE" } };
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockImplementation((() => Promise.resolve(tnx)) as never);
    jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((() => Promise.resolve(schemaRows)) as never);
    installFakes();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Config.fortyk.api.rpi.offline = originalOffline;
  });

  const put = (body: unknown, authorization: string | null = Config.fortyk.api.serversynckey) => {
    const req = request(app.getHttpServer()).put("/import/ownership").send(body as object);
    return authorization ? req.set("Authorization", authorization) : req;
  };

  const owners = (key: string) => Object.fromEntries(store[key].map((r) => [Object.values(r)[0], r.organisationid]));

  describe("who may call it", () => {
    it("accepts the server sync key", async () => {
      await put(validBody()).expect(200);
    });

    const ROLES: Array<[string, SchoolRole]> = [
      ["TEACHER", SchoolRole.TEACHER],
      ["ADMIN", SchoolRole.ADMIN],
      ["SUPERADMIN", SchoolRole.SUPERADMIN],
      ["STUDENT", SchoolRole.STUDENT],
    ];

    it.each(ROLES)(
      "refuses a %s token online with 403, and writes nothing",
      async (_name, role) => {
        const before = cloneDeep(store);
        await put(validBody(), tokenFor(role)).expect(403);
        expect(store).toEqual(before);
        expect(tnx.commit).not.toHaveBeenCalled();
      },
    );

    it.each(ROLES)(
      "refuses a %s token on a classroom Pi too (the Pi exception is for import/master only)",
      async (_name, role) => {
        Config.fortyk.api.rpi.offline = true;
        const before = cloneDeep(store);
        await put(validBody(), tokenFor(role)).expect(403);
        expect(store).toEqual(before);
      },
    );

    it("accepts the sync key on a classroom Pi", async () => {
      Config.fortyk.api.rpi.offline = true;
      await put(validBody()).expect(200);
    });

    it("gives 401 with no Authorization header, and for the key sent as a Bearer token or altered", async () => {
      await put(validBody(), null).expect(401);
      await put(validBody(), `Bearer ${Config.fortyk.api.serversynckey}`).expect(401);
      await put(validBody(), `${Config.fortyk.api.serversynckey}x`).expect(401);
      expect(tnx.commit).not.toHaveBeenCalled();
    });
  });

  describe("what it applies", () => {
    it("creates the organisation rows and fills NULL owners, reporting the counts", async () => {
      const res = await put(validBody()).expect(200);
      expect(res.body.applied).toEqual({ organisations: 2, schools: 2, curriculums: 1, questions: 2, documents: 0, subjects: 1 });
      expect(res.body.disagreements).toEqual([]);
      expect(res.body.unknown).toEqual({ schools: [], curriculums: [], questions: [], documents: [], subjects: [] });
      expect(store.organisations.map((o) => o.organisationid).sort()).toEqual([ORG_A, ORG_B].sort());
      expect(owners("schools")).toEqual({ [SCHOOL(1)]: ORG_A, [SCHOOL(2)]: ORG_B, [SCHOOL(3)]: null });
      expect(owners("questions")).toEqual({ [QUES(1)]: ORG_A, [QUES(2)]: ORG_A, [QUES(3)]: null });
      expect(tnx.commit).toHaveBeenCalledTimes(1);
    });

    it("counts the rows the map does not mention as unmapped, and changes none of them", async () => {
      const res = await put(validBody()).expect(200);
      expect(res.body.unmapped).toEqual({ schools: 1, curriculums: 2, questions: 1, documents: 3, subjects: 2 });
      expect(owners("curriculums")[CURR(2)]).toBeNull();
      expect(owners("documents")).toEqual({ [DOCS(1)]: null, [DOCS(2)]: null, [DOCS(3)]: null });
    });

    it("is idempotent: a second call applies nothing", async () => {
      await put(validBody()).expect(200);
      const afterFirst = cloneDeep(store);
      const second = await put(validBody()).expect(200);
      expect(second.body.applied).toEqual({ organisations: 0, schools: 0, curriculums: 0, questions: 0, documents: 0, subjects: 0 });
      expect(second.body.disagreements).toEqual([]);
      expect(store).toEqual(afterFirst);
    });

    it("sets the same value again as a no-op: a row already owned by the requested organisation is neither changed nor reported", async () => {
      store.schools[0].organisationid = ORG_A;
      const res = await put(validBody()).expect(200);
      expect(res.body.applied.schools).toBe(1); // only school 2
      expect(res.body.disagreements).toEqual([]);
      expect(owners("schools")[SCHOOL(1)]).toBe(ORG_A);
    });

    it("reports a row owned by a DIFFERENT organisation and leaves it unchanged", async () => {
      store.schools[0].organisationid = ORG_B; // body asks for A
      store.questions[1].organisationid = ORG_B; // body asks for A
      const res = await put(validBody()).expect(200);
      expect(res.body.disagreements).toEqual(
        expect.arrayContaining([
          { table: "schools", id: SCHOOL(1), current: ORG_B, requested: ORG_A },
          { table: "questions", id: QUES(2), current: ORG_B, requested: ORG_A },
        ]),
      );
      expect(res.body.disagreements).toHaveLength(2);
      expect(res.body.disagreementCount).toBe(2);
      expect(owners("schools")[SCHOOL(1)]).toBe(ORG_B);
      expect(owners("questions")[QUES(2)]).toBe(ORG_B);
      // the rest of the map still applied
      expect(owners("schools")[SCHOOL(2)]).toBe(ORG_B);
      expect(owners("questions")[QUES(1)]).toBe(ORG_A);
      expect(res.body.applied.schools).toBe(1);
      expect(res.body.applied.questions).toBe(1);
    });

    it("never overwrites a row that gained an owner between the read and the write: the write itself only touches NULL rows", async () => {
      // The read sees school 1 as unowned (stale), but by the time of the write it belongs to B.
      store.schools[0].organisationid = ORG_B;
      jest.spyOn(schools, "scope").mockReturnValue({
        findAll: jest.fn(async () => [{ schoolid: SCHOOL(1), organisationid: null }]),
      } as never);
      const body = validBody({ schools: { [SCHOOL(1)]: ORG_A }, content: { curriculums: {}, questions: {}, documents: {}, subjects: {} } });
      const res = await put(body).expect(200);
      expect(res.body.applied.schools).toBe(0);
      expect(owners("schools")[SCHOOL(1)]).toBe(ORG_B);
    });

    it("lists at most 500 disagreements, with the full count alongside", async () => {
      const map: Record<string, string> = {};
      store.schools = [];
      for (let n = 1; n <= 650; n += 1) {
        store.schools.push({ schoolid: SCHOOL(n), name: `s${n}`, isdeleted: false, organisationid: ORG_B });
        map[SCHOOL(n)] = ORG_A;
      }
      const res = await put(validBody({ schools: map })).expect(200);
      expect(res.body.disagreementCount).toBe(650);
      expect(res.body.disagreements).toHaveLength(500);
      expect(res.body.applied.schools).toBe(0);
      expect(store.schools.every((r) => r.organisationid === ORG_B)).toBe(true);
    });

    it("lists ids it has no row for under unknown, and creates nothing for them", async () => {
      const ghost = SCHOOL(99);
      const body = validBody({ schools: { [SCHOOL(1)]: ORG_A, [ghost]: ORG_A } });
      const res = await put(body).expect(200);
      expect(res.body.unknown.schools).toEqual([ghost]);
      expect(store.schools).toHaveLength(3);
      expect(res.body.applied.schools).toBe(1);
    });

    it("matches ids the way the database does, case-insensitively", async () => {
      const body = validBody({ schools: { [SCHOOL(1).toUpperCase()]: ORG_A } });
      const res = await put(body).expect(200);
      expect(res.body.unknown.schools).toEqual([]);
      expect(owners("schools")[SCHOOL(1)]).toBe(ORG_A);
    });

    it("updates an existing organisation row whose columns differ, and only counts it when something changed", async () => {
      store.organisations.push(orgRow(ORG_A, { organisationname: "Old name", uitheme: "corporate" }));
      store.organisations.push(orgRow(ORG_B));
      const res = await put(validBody()).expect(200);
      expect(res.body.applied.organisations).toBe(1);
      expect(store.organisations.find((o) => o.organisationid === ORG_A)).toMatchObject({ organisationname: "Org A", uitheme: "kids" });
      expect(calls.filter((c) => c === "organisations.create")).toHaveLength(0);
    });

    it("takes every organisation column, including the JSON ones", async () => {
      const branding = { logourl: "https://example.org/logo.png", displayname: "Org A", tilecolour: "#112233" };
      const settings = { anything: ["goes", { here: 1 }] };
      const body = validBody({ organisations: [orgRow(ORG_A, { brandingconfig: branding, settingsconfig: settings, organisationstatus: false, isdeleted: true, uitheme: "corporate" }), orgRow(ORG_B)] });
      await put(body).expect(200);
      expect(store.organisations.find((o) => o.organisationid === ORG_A)).toEqual(
        orgRow(ORG_A, { brandingconfig: branding, settingsconfig: settings, organisationstatus: false, isdeleted: true, uitheme: "corporate" }),
      );
      const again = await put(body).expect(200);
      expect(again.body.applied.organisations).toBe(0);
    });

    it("refuses the whole call, before writing anything, when a map names an organisation that is neither sent nor known", async () => {
      const body = validBody({ organisations: [orgRow(ORG_A)] }); // ORG_B referenced, not sent, not here
      const before = cloneDeep(store);
      await put(body).expect(400);
      expect(store).toEqual(before);
      expect(tnx.rollback).toHaveBeenCalledTimes(1);
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("accepts a map that names an organisation already known here but not re-sent", async () => {
      store.organisations.push(orgRow(ORG_B));
      const body = validBody({ organisations: [orgRow(ORG_A)] });
      await put(body).expect(200);
      expect(owners("schools")[SCHOOL(2)]).toBe(ORG_B);
    });

    it("rolls the whole transaction back, and answers with an error, when a write fails half-way", async () => {
      jest.spyOn(questions, "update").mockRejectedValue(new Error("boom") as never);
      const res = await put(validBody());
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(tnx.rollback).toHaveBeenCalledTimes(1);
      expect(tnx.commit).not.toHaveBeenCalled();
    });
  });

  describe("what it never does", () => {
    it("changes nothing but organisationid columns and organisations rows: a full before/after snapshot of every table", async () => {
      const before = cloneDeep(store);
      await put(validBody()).expect(200);
      const stripped = (s: Store) => {
        const out = cloneDeep(s);
        delete out.organisations;
        for (const rows of Object.values(out)) {
          for (const r of rows) delete r.organisationid;
        }
        return out;
      };
      expect(stripped(store)).toEqual(stripped(before));
      // the logins and learners are untouched, columns and all
      expect(store.schoolusers).toEqual(before.schoolusers);
      expect(store.students).toEqual(before.students);
      expect(store.tokens).toEqual(before.tokens);
      // and organisationid is the only thing that moved on an owned table
      expect(owners("schools")[SCHOOL(1)]).toBe(ORG_A);
    });

    it("deletes nothing: row counts are unchanged and no destroy, bulkCreate or create reaches an owned model", async () => {
      const counts = Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v.length]));
      await put(validBody()).expect(200);
      for (const t of OWNED) {
        expect(store[t.key]).toHaveLength(counts[t.key]);
      }
      // (the fakes throw if any of those methods is called, which would have been a 500 above)
    });

    it("does not write to a login or a learner: no model call at all reaches schoolusers or students", async () => {
      await put(validBody()).expect(200);
      // the fakes throw on any call; reaching here with 200 is the proof. Check the SQL path too:
      const query = dbinstance.getdbinstance().query as jest.Mock;
      for (const [sql] of query.mock.calls) {
        expect(String(sql)).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|ALTER|TRUNCATE)\b/i);
      }
    });
  });

  describe("body validation", () => {
    it("refuses an empty body with a 400 that names the problem", async () => {
      const res = await put({}).expect(400);
      expect(res.body.code).toBe("INVALID_INPUT");
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it.each([
      ["a top-level key it does not know", () => ({ ...validBody(), extra: 1 })],
      ["an unknown key inside content", () => ({ ...validBody(), content: { ...validBody().content, lessons: {} } })],
      ["an unknown key on an organisation", () => ({ ...validBody(), organisations: [orgRow(ORG_A, { organisationshortname: "x" }), orgRow(ORG_B)] })],
      ["a missing content map", () => ({ ...validBody(), content: { curriculums: {}, questions: {}, documents: {} } })],
      ["a format other than 3", () => ({ ...validBody(), format: 2 })],
      ["format as a string", () => ({ ...validBody(), format: "3" })],
      ["a missing organisations array", () => { const b: any = validBody(); delete b.organisations; return b; }],
      ["an organisation id that is not a uuid", () => ({ ...validBody(), organisations: [orgRow("not-a-uuid"), orgRow(ORG_B)] })],
      ["the same organisation twice", () => ({ ...validBody(), organisations: [orgRow(ORG_A), orgRow(ORG_A), orgRow(ORG_B)] })],
      ["a map value that is not an organisation id", () => ({ ...validBody(), schools: { [SCHOOL(1)]: "nope" } })],
      ["a map key that is not an id", () => ({ ...validBody(), schools: { "not an id": ORG_A } })],
      ["a null owner (ownership is never cleared by this call)", () => ({ ...validBody(), schools: { [SCHOOL(1)]: null } })],
      ["a string status", () => ({ ...validBody(), organisations: [orgRow(ORG_A, { organisationstatus: "true" }), orgRow(ORG_B)] })],
      ["an unknown theme", () => ({ ...validBody(), organisations: [orgRow(ORG_A, { uitheme: "neon" }), orgRow(ORG_B)] })],
      ["an unknown branding key", () => ({ ...validBody(), organisations: [orgRow(ORG_A, { brandingconfig: { evil: 1 } }), orgRow(ORG_B)] })],
      ["a branding logo that is not https", () => ({ ...validBody(), organisations: [orgRow(ORG_A, { brandingconfig: { logourl: "http://example.org/a.png" } }), orgRow(ORG_B)] })],
      ["a name made only of invisible characters", () => ({ ...validBody(), organisations: [orgRow(ORG_A, { organisationname: "​\t" }), orgRow(ORG_B)] })],
    ])("refuses %s, and writes nothing", async (_label, make) => {
      const before = cloneDeep(store);
      await put(make()).expect(400);
      expect(store).toEqual(before);
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("refuses a map that names the same uuid in two letter cases, rather than taking the last", async () => {
      const lower = SCHOOL(1);
      const upper = SCHOOL(1).toUpperCase();
      expect(lower).not.toBe(upper);
      const before = cloneDeep(store);
      const res = await put(validBody({ schools: { [lower]: ORG_A, [upper]: ORG_B } })).expect(400);
      expect(res.body.code).toBe("INVALID_INPUT");
      expect(store).toEqual(before);
      await put(validBody({ content: { ...validBody().content, curriculums: { [CURR(1)]: ORG_A, [CURR(1).toUpperCase()]: ORG_A } } })).expect(400);
    });

    it("refuses the same organisation id twice in different letter cases", async () => {
      await put(validBody({ organisations: [orgRow(ORG_A), orgRow(ORG_A.toUpperCase()), orgRow(ORG_B)] })).expect(400);
    });

    it("counts settingsconfig in BYTES of its JSON: 25,000 Khmer characters (75 KB) is refused, 60,000 ASCII characters (60 KB) is accepted", async () => {
      const khmer = { note: "ក".repeat(25000) };
      expect(JSON.stringify(khmer).length).toBeLessThan(64 * 1024);
      const refused = await put(validBody({ organisations: [orgRow(ORG_A, { settingsconfig: khmer }), orgRow(ORG_B)] })).expect(400);
      expect(JSON.stringify(refused.body)).toMatch(/too large/);
      await put(validBody({ organisations: [orgRow(ORG_A, { settingsconfig: { note: "a".repeat(60000) } }), orgRow(ORG_B)] })).expect(200);
    });

    it.each(["A", "ORG", "has space", "toolongcode1234567", "under_score", "ünï", ""])(
      "refuses the organisation code %j (2 to 16 lower-case letters and digits only)",
      async (code) => {
        const body = validBody({ organisations: [orgRow(ORG_A, { organisationcode: code }), orgRow(ORG_B)] });
        await put(body).expect(400);
        expect(store.organisations).toEqual([]);
      },
    );

    it.each(["ab", "a1", "abcdefghij123456", "cambodia2"])("accepts the organisation code %j", async (code) => {
      const body = validBody({ organisations: [orgRow(ORG_A, { organisationcode: code }), orgRow(ORG_B)] });
      await put(body).expect(200);
    });

    it("never treats a key such as __proto__ or constructor as an id", async () => {
      const raw = `{"format":3,"organisations":[],"schools":{"__proto__":"${ORG_A}"},"content":{"curriculums":{},"questions":{},"documents":{},"subjects":{}}}`;
      await request(app.getHttpServer())
        .put("/import/ownership")
        .set("Authorization", Config.fortyk.api.serversynckey)
        .set("Content-Type", "application/json")
        .send(raw)
        .expect(400);
      await put({ ...validBody(), schools: { constructor: ORG_A } }).expect(400);
      expect(({} as Record<string, unknown>).organisationid).toBeUndefined();
    });
  });

  describe("an unmigrated database", () => {
    it.each(["organisations", "schools", "curriculums", "questions", "documents", "subjects"])(
      "answers 503 with a plain message, and writes nothing, when %s has not been migrated",
      async (missing) => {
        schemaRows = FULL_SCHEMA.filter((r) => r.tbl !== missing);
        const before = cloneDeep(store);
        const res = await put(validBody()).expect(503);
        expect(res.body.code).toBe("SERVICE_UNAVAILABLE");
        expect(res.body.errormessage ?? res.body.message).toMatch(/migrat/i);
        expect(store).toEqual(before);
        expect(tnx.commit).not.toHaveBeenCalled();
      },
    );
  });
});
