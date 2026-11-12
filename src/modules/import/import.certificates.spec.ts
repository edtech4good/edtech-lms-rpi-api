import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import { Op } from "sequelize";
import request from "supertest";
import { Config } from "src/config";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { parseCertificatesPayload } from "src/business/certificates-import";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { studentcertificates } from "src/models/data-models/studentcertificates";
import { students } from "src/models/data-models/students";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * `PUT /import/certificates`: central pushes the certificates it issued or revoked for this server's learners.
 *
 * Driven over real HTTP through the real guards. The models are in-memory: a write is staged on the transaction and
 * takes effect only on commit, so a refused payload that wrote anything (or a rollback that did not happen) shows.
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
const A1 = "st-a-1";
const A2 = "st-a-2";
const B1 = "st-b-1";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let learners: Row[];
let stored: Row[];
let committed: number;
let rolledBack: number;
let writes: number;

const cert = (n: number, studentid: string, extra: Row = {}): Row => ({
  certificateid: `cert-${n}`,
  shortcode: `ABCD-${String(1000 + n)}`,
  studentid,
  curriculumid: "cur-1",
  scope: "level",
  scopeid: "lvl-1",
  issuedat: "2026-11-01T08:00:00.000Z",
  revokedat: null,
  snapshot: { learnername: "Learner One" },
  checkurl: `https://check.example.org/v/ABCD-${1000 + n}`,
  ...extra,
});
const stored1 = (n: number, studentid: string, extra: Row = {}): Row => ({ ...cert(n, studentid), issuedat: new Date("2026-11-01T08:00:00.000Z"), ...extra });
const ids = (rows: Row[]) => rows.map((r) => r.certificateid).sort();

const inList = (cond: any): string[] => (cond?.[Op.in as unknown as symbol] ?? []) as string[]; // eslint-disable-line @typescript-eslint/no-explicit-any

const fakeDb = {
  transaction: jest.fn(async () => {
    const staged: Array<() => void> = [];
    return {
      stage: (fn: () => void) => staged.push(fn),
      commit: jest.fn(async () => {
        committed += 1;
        staged.forEach((fn) => fn());
      }),
      rollback: jest.fn(async () => {
        rolledBack += 1;
      }),
    };
  }),
};

const tokenFor = (schooluserrole: SchoolRole) =>
  `Bearer ${sign({ jti: "t", schooluserid: `u-${schooluserrole}`, schooluserrole }, Config.fortyk.api.rpi.applicationsecret, { expiresIn: "5m" })}`;

describe("PUT /import/certificates", () => {
  let app: INestApplication;
  const originalOffline = Config.fortyk.api.rpi.offline;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ImportController], providers: [JwtAccessStrategy] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    learners = [
      { studentid: A1, schoolid: SCHOOL_A },
      { studentid: A2, schoolid: SCHOOL_A },
      { studentid: B1, schoolid: SCHOOL_B },
    ];
    stored = [];
    committed = 0;
    rolledBack = 0;
    writes = 0;
    tokenExists.mockResolvedValue(true);
    jest.spyOn(dbinstance, "getdbinstance").mockReturnValue(fakeDb as never);
    jest.spyOn(organisations, "findOne").mockImplementation((async (opts: any) => ({ organisationid: opts.where.organisationid, organisationstatus: true, isdeleted: false })) as never);
    jest.spyOn(schools, "scope").mockImplementation((() => ({
      findAll: async (opts: any) => (opts.where.organisationid === ORG_A ? [{ schoolid: SCHOOL_A }] : opts.where.organisationid === ORG_B ? [{ schoolid: SCHOOL_B }] : []),
    })) as never);
    jest.spyOn(students, "findAll").mockImplementation((async (opts: any) => {
      expect(opts.transaction).toBeDefined(); // every read is on the import's own transaction
      const wanted = inList(opts.where.studentid).map((x) => x.toLowerCase());
      const inSchools = inList(opts.where.schoolid);
      return learners.filter((l) => wanted.includes(l.studentid.toLowerCase()) && inSchools.includes(l.schoolid)).map((l) => ({ studentid: l.studentid }));
    }) as never);
    jest.spyOn(studentcertificates, "findAll").mockImplementation((async (opts: any) => {
      expect(opts.transaction).toBeDefined();
      const w = opts.where;
      const byId = w.certificateid ? inList(w.certificateid) : null;
      const byStudent = w.studentid ? inList(w.studentid) : null;
      return stored.filter((r) => (byId ? byId.includes(r.certificateid) : true) && (byStudent ? byStudent.includes(r.studentid) : true)).map((r) => ({ ...r }));
    }) as never);
    jest.spyOn(studentcertificates, "bulkCreate").mockImplementation((async (rows: Row[], opts: any) => {
      writes += 1;
      expect(opts.updateOnDuplicate).toEqual(expect.arrayContaining(["revokedat", "checkurl"]));
      opts.transaction.stage(() => {
        for (const row of rows) {
          const at = stored.findIndex((r) => r.certificateid === row.certificateid);
          if (at >= 0) stored[at] = { ...stored[at], ...row };
          else stored.push({ ...row });
        }
      });
      return rows;
    }) as never);
    jest.spyOn(studentcertificates, "destroy").mockImplementation((async (opts: any) => {
      writes += 1;
      const doomed = inList(opts.where.certificateid);
      const count = stored.filter((r) => doomed.includes(r.certificateid)).length;
      opts.transaction.stage(() => {
        stored = stored.filter((r) => !doomed.includes(r.certificateid));
      });
      return count;
    }) as never);
    Config.fortyk.api.rpi.offline = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Config.fortyk.api.rpi.offline = originalOffline;
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (body: unknown, org: string | null = ORG_A, authorization: string | undefined = Config.fortyk.api.serversynckey) => {
    let req = request(app.getHttpServer()).put("/import/certificates");
    if (authorization) req = req.set("Authorization", authorization);
    if (org !== null) req = req.set("X-Organisation-Id", org);
    return req.send(body as object);
  };

  it("inserts new certificates and answers the counts", async () => {
    const res = await put({ certificates: [cert(1, A1), cert(2, A2)] }).expect(200);
    expect(res.body).toEqual({ error: false, data: { upserted: 2, deleted: 0 } });
    expect(ids(stored)).toEqual(["cert-1", "cert-2"]);
    expect(stored.find((r) => r.certificateid === "cert-1")).toMatchObject({
      studentid: A1,
      shortcode: "ABCD-1001",
      scope: "level",
      scopeid: "lvl-1",
      curriculumid: "cur-1",
      revokedat: null,
      checkurl: "https://check.example.org/v/ABCD-1001",
      snapshot: { learnername: "Learner One" },
    });
    expect(stored[0].issuedat).toEqual(new Date("2026-11-01T08:00:00.000Z"));
    expect(committed).toBe(1);
  });

  it("answers an empty payload with zero counts", async () => {
    const res = await put({ certificates: [] }).expect(200);
    expect(res.body).toEqual({ error: false, data: { upserted: 0, deleted: 0 } });
  });

  it("updates a certificate of the same id: a later revokedat and checkurl overwrite", async () => {
    stored = [stored1(1, A1)];
    const res = await put({ certificates: [cert(1, A1, { revokedat: "2026-11-05T00:00:00.000Z", checkurl: null })] }).expect(200);
    expect(res.body.data).toEqual({ upserted: 1, deleted: 0 });
    expect(stored).toHaveLength(1);
    expect(stored[0].revokedat).toEqual(new Date("2026-11-05T00:00:00.000Z"));
    expect(stored[0].checkurl).toBeNull();
  });

  it("refuses the whole payload, writing nothing, when a row is for a learner of another organisation", async () => {
    const res = await put({ certificates: [cert(1, A1), cert(2, B1)] }).expect(400);
    expect(JSON.stringify(res.body)).toContain("certificates row 2 studentid");
    expect(stored).toEqual([]);
    expect(writes).toBe(0);
    expect(committed).toBe(0);
    expect(rolledBack).toBe(1);
  });

  it("refuses the whole payload, writing nothing, when a row is for a learner this server does not have", async () => {
    const res = await put({ certificates: [cert(1, "nobody"), cert(2, A1)] }).expect(400);
    expect(JSON.stringify(res.body)).toContain("certificates row 1 studentid");
    expect(stored).toEqual([]);
    expect(writes).toBe(0);
  });

  it("refuses a replaceForStudents entry that is not a learner of the organisation, and deletes nothing", async () => {
    stored = [stored1(9, B1)];
    const res = await put({ certificates: [], replaceForStudents: [B1] }).expect(400);
    expect(JSON.stringify(res.body)).toContain("replaceForStudents entry 1");
    expect(ids(stored)).toEqual(["cert-9"]);
    expect(writes).toBe(0);
  });

  it("refuses a certificate id the server holds for another learner, writing nothing", async () => {
    stored = [stored1(1, A2)];
    const res = await put({ certificates: [cert(3, A1), cert(1, A1)] }).expect(400);
    expect(JSON.stringify(res.body)).toContain("certificates row 2 certificateid");
    expect(ids(stored)).toEqual(["cert-1"]);
    expect(stored[0].studentid).toBe(A2);
    expect(writes).toBe(0);
  });

  const bad: Array<[string, Row, string]> = [
    ["a scope that is not level, grade or curriculum", { scope: "lesson" }, "certificates row 2 scope"],
    ["a shortcode that is not shaped XXXX-XXXX", { shortcode: "ABCD1234" }, "certificates row 2 shortcode"],
    ["a shortcode with a letter central never uses", { shortcode: "ABCI-1234" }, "certificates row 2 shortcode"],
    ["a missing certificateid", { certificateid: "" }, "certificates row 2 certificateid"],
    ["a certificateid with a trailing space", { certificateid: "cert-2 " }, "certificates row 2 certificateid"],
    ["a studentid with a leading space", { studentid: " st-a-2" }, "certificates row 2 studentid"],
    ["a scopeid padded with spaces", { scopeid: " lvl-1 " }, "certificates row 2 scopeid"],
    ["a snapshot over 16 KB", { snapshot: { text: "x".repeat(16 * 1024) } }, "certificates row 2 snapshot"],
    ["an issuedat that is not a date", { issuedat: "yesterday" }, "certificates row 2 issuedat"],
    ["a revokedat that is not a date", { revokedat: "soon" }, "certificates row 2 revokedat"],
    ["a snapshot that is not an object", { snapshot: "text" }, "certificates row 2 snapshot"],
    ["a checkurl that is not a web address", { checkurl: "javascript:alert(1)" }, "certificates row 2 checkurl"],
  ];
  it.each(bad)("refuses %s, naming the field and the row, and writes nothing", async (_what, change, named) => {
    const res = await put({ certificates: [cert(1, A1), cert(2, A2, change)] }).expect(400);
    expect(res.body.fields).toEqual([{ field: named, message: expect.any(String) }]);
    expect(stored).toEqual([]);
    expect(writes).toBe(0);
  });

  it("refuses a replaceForStudents entry with a leading or trailing space", async () => {
    const res = await put({ certificates: [], replaceForStudents: [`${A1} `] }).expect(400);
    expect(res.body.fields).toEqual([{ field: "replaceForStudents entry 1", message: expect.any(String) }]);
  });

  it("accepts a snapshot just under 16 KB", async () => {
    await put({ certificates: [cert(1, A1, { snapshot: { text: "x".repeat(16 * 1024 - 20) } })] }).expect(200);
    expect(ids(stored)).toEqual(["cert-1"]);
  });

  it("refuses a body with no certificates list, a list over 2000 rows, and a certificate named twice", async () => {
    await put({}).expect(400);
    // (the test app keeps Express's default body limit, so the 2000-row ceiling is asked of the parser the route uses)
    expect(() => parseCertificatesPayload({ certificates: Array.from({ length: 2001 }, (_, i) => cert(i, A1)) })).toThrow(/At most 2000 certificates/);
    expect(parseCertificatesPayload({ certificates: Array.from({ length: 2000 }, (_, i) => cert(i, A1)) }).certificates).toHaveLength(2000);
    const twice = await put({ certificates: [cert(1, A1), cert(1, A1)] }).expect(400);
    expect(JSON.stringify(twice.body)).toContain("certificates row 2 certificateid");
    expect(stored).toEqual([]);
  });

  it("replaceForStudents removes a learner's certificate that is absent from the payload and leaves other learners' alone", async () => {
    stored = [stored1(1, A1), stored1(2, A1), stored1(3, A2), stored1(4, A2)];
    const res = await put({ certificates: [cert(1, A1)], replaceForStudents: [A1] }).expect(200);
    expect(res.body.data).toEqual({ upserted: 1, deleted: 1 });
    expect(ids(stored)).toEqual(["cert-1", "cert-3", "cert-4"]);
  });

  it("without replaceForStudents nothing is deleted", async () => {
    stored = [stored1(1, A1), stored1(2, A1)];
    const res = await put({ certificates: [cert(1, A1)] }).expect(200);
    expect(res.body.data).toEqual({ upserted: 1, deleted: 0 });
    expect(ids(stored)).toEqual(["cert-1", "cert-2"]);
  });

  it("replaceForStudents with an empty payload clears those learners' certificates", async () => {
    stored = [stored1(1, A1), stored1(3, A2)];
    const res = await put({ certificates: [], replaceForStudents: [A1] }).expect(200);
    expect(res.body.data).toEqual({ upserted: 0, deleted: 1 });
    expect(ids(stored)).toEqual(["cert-3"]);
  });

  it("rolls the whole push back when a write fails, so the replace does not half apply", async () => {
    stored = [stored1(1, A1), stored1(2, A1)];
    (studentcertificates.destroy as jest.Mock).mockRejectedValueOnce(new Error("lost connection"));
    await put({ certificates: [cert(3, A1)], replaceForStudents: [A1] }).expect(500);
    expect(ids(stored)).toEqual(["cert-1", "cert-2"]);
    expect(rolledBack).toBe(1);
    expect(committed).toBe(0);
  });

  it("is for the server key only: a staff token and no key are refused, and the platform marker and a missing header are 400", async () => {
    const body = { certificates: [cert(1, A1)] };
    await put(body, ORG_A, tokenFor(SchoolRole.SUPERADMIN)).expect(403);
    await put(body, ORG_A, "").expect(401);
    await put(body, null).expect(400);
    await put(body, "platform").expect(400);
    await put(body, "not-an-organisation!").expect(400);
    expect(stored).toEqual([]);
    expect(writes).toBe(0);
  });
});
