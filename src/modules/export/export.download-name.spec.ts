import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { Config } from "src/config";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { ExportController } from "./export.controller";

/**
 * GET /export/system-log/files names its file after the signed-in user's
 * school (logfiles-<school>-<date>-<time>.zip). A school with a Khmer name used
 * to answer 500: Node refuses a non-ASCII header value. Driven over real HTTP
 * through the real strategy, guard and controller; replaced are the token
 * lookup and the log directory listing.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const realFs = require("fs");

const tokenExists = jest.fn();
// Who may call what is this spec's subject; the organisation boundary (claims, scope, content access) has its
// own specs (src/modules/org-boundary.leak.spec.ts), so it is stood aside here.
jest.mock("src/business/token-claims", () => ({
  ...jest.requireActual("src/business/token-claims"),
  checkTokenClaims: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

const KHMER_SCHOOL = "សាលាបឋមសិក្សា ភ្នំពេញ";

const tokenFor = (schoolname: string | undefined) =>
  `Bearer ${sign(
    { jti: "test-jti", schooluserid: "u-1", schoolusername: "sample.admin", schooluserrole: SchoolRole.ADMIN, schoolname },
    Config.fortyk.api.rpi.applicationsecret,
    { expiresIn: "5m" }
  )}`;

describe("GET /export/system-log/files: the file name for a school with a Khmer name", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ExportController], providers: [JwtAccessStrategy] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    tokenExists.mockResolvedValue(true);
    jest.spyOn(realFs, "readdirSync").mockReturnValue([]);
  });
  afterEach(() => jest.restoreAllMocks());

  const download = (schoolname: string | undefined) => request(app.getHttpServer()).get("/export/system-log/files").set("Authorization", tokenFor(schoolname));

  it("answers 200 with both forms of the file name", async () => {
    const res = await download(KHMER_SCHOOL);
    expect(res.status).toBe(200);
    const header = res.headers["content-disposition"];
    expect(header).toMatch(/^attachment; filename="logfiles-[\x20-\x7e]*\.zip"; filename\*=UTF-8''logfiles-%E1%9E/);
    const encoded = /filename\*=UTF-8''(.*)$/.exec(header)?.[1] as string;
    expect(decodeURIComponent(encoded)).toMatch(new RegExp(`^logfiles-${KHMER_SCHOOL}-.*\\.zip$`, "u"));
  });

  it("a school with an ASCII name still gets a plain header", async () => {
    const res = await download("Riverside School");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="logfiles-Riverside School-[^"]*\.zip"$/);
  });

  it("a token with no school name still gets a download", async () => {
    const res = await download(undefined);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="logfiles--[^"]*\.zip"$/);
  });
});
