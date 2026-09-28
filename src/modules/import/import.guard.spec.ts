import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { Config } from "src/config";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { ImportController } from "./import.controller";

/**
 * Who may call the bulk imports (`PUT import/master`, `import/students`,
 * `import/teachers`). They used to accept any ADMIN, SUPERADMIN or TEACHER
 * token, so an ordinary teacher's app login could wipe and replace all content
 * on the online student API.
 *
 * Driven over real HTTP through the real JWT strategy with signed tokens, so
 * the guards run exactly as they do in the app. Only the token-table lookup
 * is stubbed (no database here).
 *
 * A request that gets past the guard reaches the handler with no file and is
 * refused with 400 "Invalid file" before it touches the database. So 400
 * means "allowed", and 401/403 mean the guard stopped it.
 */
const ALLOWED = 400;

// `tokenExists` is an arrow-function field, so it can't be spied on the
// prototype; replace the class instead.
const tokenExists = jest.fn();
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

const tokenFor = (schooluserrole: SchoolRole) =>
  `Bearer ${sign(
    { jti: "test-jti", schooluserid: `u-${schooluserrole}`, schooluserrole },
    Config.fortyk.api.rpi.applicationsecret,
    { expiresIn: "5m" }
  )}`;

const ROUTES = ["master", "students", "teachers"] as const;

describe("ImportController guards", () => {
  let app: INestApplication;
  const originalOffline = Config.fortyk.api.rpi.offline;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImportController],
      providers: [JwtAccessStrategy],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    tokenExists.mockResolvedValue(true);
  });

  afterEach(() => {
    Config.fortyk.api.rpi.offline = originalOffline;
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (route: string, authorization?: string) => {
    const req = request(app.getHttpServer()).put(`/import/${route}`);
    return authorization ? req.set("Authorization", authorization) : req;
  };

  describe("online (RPI_OFFLINE unset)", () => {
    beforeEach(() => {
      Config.fortyk.api.rpi.offline = false;
    });

    it.each(ROUTES)("refuses a teacher token on import/%s with 403", async (route) => {
      await put(route, tokenFor(SchoolRole.TEACHER)).expect(403);
    });

    it.each(ROUTES)("refuses an admin token on import/%s with 403", async (route) => {
      await put(route, tokenFor(SchoolRole.ADMIN)).expect(403);
      await put(route, tokenFor(SchoolRole.SUPERADMIN)).expect(403);
    });

    it.each(ROUTES)("accepts the server sync key on import/%s", async (route) => {
      await put(route, Config.fortyk.api.serversynckey).expect(ALLOWED, /Invalid file/);
    });

    it.each(ROUTES)("gives 401 with no token, and with a revoked token, on import/%s", async (route) => {
      await put(route).expect(401);
      tokenExists.mockResolvedValue(false);
      await put(route, tokenFor(SchoolRole.TEACHER)).expect(401);
    });

    it("refuses the sync key sent as a Bearer token or with a different value", async () => {
      await put("master", `Bearer ${Config.fortyk.api.serversynckey}`).expect(401);
      await put("master", `${Config.fortyk.api.serversynckey}x`).expect(401);
    });
  });

  describe("classroom Pi (RPI_OFFLINE=true)", () => {
    beforeEach(() => {
      Config.fortyk.api.rpi.offline = true;
    });

    it("accepts teacher and admin tokens on import/master", async () => {
      await put("master", tokenFor(SchoolRole.TEACHER)).expect(ALLOWED, /Invalid file/);
      await put("master", tokenFor(SchoolRole.ADMIN)).expect(ALLOWED, /Invalid file/);
      await put("master", tokenFor(SchoolRole.SUPERADMIN)).expect(ALLOWED, /Invalid file/);
    });

    it("refuses a student token on import/master with 403", async () => {
      await put("master", tokenFor(SchoolRole.STUDENT)).expect(403);
    });

    it.each(["students", "teachers"])("refuses a teacher token on import/%s with 403", async (route) => {
      await put(route, tokenFor(SchoolRole.TEACHER)).expect(403);
      await put(route, tokenFor(SchoolRole.ADMIN)).expect(403);
    });

    it.each(ROUTES)("accepts the server sync key on import/%s", async (route) => {
      await put(route, Config.fortyk.api.serversynckey).expect(ALLOWED, /Invalid file/);
    });
  });
});
