import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import AdmZip from "adm-zip";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { Config } from "src/config";
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
    const moduleRef = await Test.createTestingModule({ controllers: [ImportController], providers: [JwtAccessStrategy] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    tokenExists.mockResolvedValue(true);
    tnx.commit.mockResolvedValue(undefined);
    tnx.rollback.mockResolvedValue(undefined);
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
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

    it("refuses a teacher token even with the organisation's claim: only central's key may send content to the shared API", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, { organisationid: ORG_X })).expect(403);
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
      const res = await put({ ...header(), scope: "curriculum" }, tokenFor(SchoolRole.TEACHER, { organisationid: ORG_X })).expect(400);
      expect(JSON.stringify(res.body)).toMatch(/scope must be/);
    });

    it("a teacher whose token names another organisation gets a 403, whatever the payload", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER, { organisationid: ORG_Y })).expect(403);
      await put({ ...header(), scope: "curriculum" }, tokenFor(SchoolRole.ADMIN, { organisationid: ORG_Y })).expect(403);
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("a token with no organisation claim gets a 403", async () => {
      await put(header(), tokenFor(SchoolRole.TEACHER)).expect(403);
      await put(header(), tokenFor(SchoolRole.SUPERADMIN, { organisationid: null })).expect(403);
    });

    it("a student token is still stopped by the guard", async () => {
      await put(header(), tokenFor(SchoolRole.STUDENT, { organisationid: ORG_X })).expect(403);
    });
  });
});
