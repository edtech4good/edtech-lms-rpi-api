import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import AdmZip from "adm-zip";
import { sign } from "jsonwebtoken";
import { Sequelize } from "sequelize";
import request from "supertest";
import { Config } from "src/config";
import { initModels } from "src/models/data-models/init-models";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * Who may send one organisation's content (a format-3 payload) to
 * `PUT /import/master`, over real HTTP through the real guard and JWT strategy,
 * with a real zip. A payload that is refused for its CONTENT is refused with a
 * 400 before anything reaches the database, so 400 here means "the sender was
 * allowed and the payload was read", and 403 means the sender was stopped.
 */
const ORG_X = "a1000000-0000-4000-8000-00000000000a";
const ORG_Y = "b2000000-0000-4000-8000-00000000000b";
const SCHOOL_X = "a1000000-0000-4000-8000-0000000000a1";
const SCHOOL_Y = "b2000000-0000-4000-8000-0000000000b1";
const SCHOOL_NEW = "c3000000-0000-4000-8000-0000000000c1"; // a school here that has no organisation yet
// What the strategy finds when it checks a token's claims (no database here).
const ORGS: Record<string, { organisationstatus: boolean; isdeleted: boolean }> = {
  [ORG_X]: { organisationstatus: true, isdeleted: false },
  [ORG_Y]: { organisationstatus: true, isdeleted: false },
};
const SCHOOLS: Record<string, { schoolid: string; organisationid: string | null }> = {
  [SCHOOL_X]: { schoolid: SCHOOL_X, organisationid: ORG_X },
  [SCHOOL_Y]: { schoolid: SCHOOL_Y, organisationid: ORG_Y },
  [SCHOOL_NEW]: { schoolid: SCHOOL_NEW, organisationid: null },
};
const CLAIMS_X = { organisationid: ORG_X, schoolid: SCHOOL_X };
const CLAIMS_Y = { organisationid: ORG_Y, schoolid: SCHOOL_Y };

const tokenExists = jest.fn();
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

const tokenFor = (schooluserrole: SchoolRole, claims: Record<string, unknown> = {}) =>
  `Bearer ${sign({ jti: "test-jti", schooluserid: `u-${schooluserrole}`, schooluserrole, ...claims }, Config.fortyk.api.rpi.applicationsecret, { expiresIn: "5m" })}`;

// A header and nothing else: it is refused for its tables before it can reach the database.
const zipOf = (payload: unknown) => {
  const zip = new AdmZip();
  zip.addFile("master.json", Buffer.from(JSON.stringify(payload), "utf8"));
  return zip.toBuffer();
};
const header = (organisationid = ORG_X) => ({ format: 3, organisationid, organisationcode: "xorg", scope: "organisation" });

describe("PUT import/master with one organisation's content", () => {
  let app: INestApplication;
  const originalOffline = Config.fortyk.api.rpi.offline;
  const tnx = { commit: jest.fn(), rollback: jest.fn() };

  beforeAll(async () => {
    initModels(new Sequelize("test", "test", "test", { dialect: "mysql", logging: false }));
    const moduleRef = await Test.createTestingModule({ controllers: [ImportController], providers: [JwtAccessStrategy] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    tokenExists.mockResolvedValue(true);
    tnx.commit.mockResolvedValue(undefined);
    tnx.rollback.mockResolvedValue(undefined);
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
    jest.spyOn(organisations, "findOne").mockImplementation((async (o: { where: { organisationid: string } }) => {
      const row = ORGS[o.where.organisationid];
      return row ? { organisationid: o.where.organisationid, ...row } : null;
    }) as never);
    jest.spyOn(schools, "findOne").mockImplementation((async (o: { where: { schoolid: string } }) => SCHOOLS[o.where.schoolid] ?? null) as never);
  });
  afterEach(() => {
    Config.fortyk.api.rpi.offline = originalOffline;
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });

  const put = (payload: unknown, authorization: string) =>
    request(app.getHttpServer()).put("/import/master").set("Authorization", authorization).attach("importfile", zipOf(payload), "master.zip");

  describe("online", () => {
    beforeEach(() => {
      Config.fortyk.api.rpi.offline = false;
    });

    it("refuses a teacher token even with the organisation's claims: only central's key may send content to the shared API", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, CLAIMS_X)).expect(403);
    });

    it("refuses a teacher token with no claims at all (401: it signs in again), whatever the payload", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER)).expect(401);
    });

    it("central's key is read: the payload is refused for what is wrong with it, and the reason is given", async () => {
      const res = await put({ ...header(), scope: "curriculum" }, Config.fortyk.api.serversynckey).expect(400);
      expect(JSON.stringify(res.body)).toMatch(/scope must be \\"organisation\\"/);
      expect(tnx.commit).not.toHaveBeenCalled();
      expect(tnx.rollback).toHaveBeenCalledTimes(1);
    });
  });

  describe("classroom Pi (RPI_OFFLINE=true)", () => {
    beforeEach(() => {
      Config.fortyk.api.rpi.offline = true;
    });

    it("a teacher whose token names the organisation is read (a payload with a wrong scope gets its 400)", async () => {
      const res = await put({ ...header(), scope: "curriculum" }, tokenFor(SchoolRole.TEACHER, CLAIMS_X)).expect(400);
      expect(JSON.stringify(res.body)).toMatch(/scope must be/);
    });

    it("a teacher whose token names another organisation gets a 403, whatever the payload", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, CLAIMS_Y)).expect(403);
      await put({ ...header(), scope: "curriculum" }, tokenFor(SchoolRole.ADMIN, CLAIMS_Y)).expect(403);
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("a token whose school has no organisation yet (no organisation claim) is judged after the payload is read (its school must be adoptable): an unreadable payload is a 400", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, { schoolid: SCHOOL_NEW })).expect(400);
      await put(header(), tokenFor(SchoolRole.SUPERADMIN, { organisationid: null, schoolid: SCHOOL_NEW })).expect(400);
    });

    it("a token with no organisation claim whose school already has an owner is refused (401): it signs in again", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, { schoolid: SCHOOL_X })).expect(401);
      await put(header(), tokenFor(SchoolRole.TEACHER)).expect(401);
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("a claim that is not an organisation id is refused (401)", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, { organisationid: 42, schoolid: SCHOOL_X })).expect(401);
    });

    it("a student token is still stopped by the guard", async () => {
      await put(header(), tokenFor(SchoolRole.STUDENT, CLAIMS_X)).expect(403);
    });
  });
});
