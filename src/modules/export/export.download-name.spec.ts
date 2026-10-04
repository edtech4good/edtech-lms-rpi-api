import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { Config } from "src/config";
import { schools } from "src/models/data-models/school";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { ExportController } from "./export.controller";

/**
 * GET /export/system-log/files names its file after the school's stored name
 * (logfiles-<school>-<date>-<time>.zip). A school with a Khmer name used
 * to answer 500: Node refuses a non-ASCII header value. Driven over real HTTP
 * through the real strategy, guard and controller; replaced are the token
 * lookup, the log directory listing and the school read. The route serves the
 * server's own log files on a classroom Pi only (src/modules/export-scope.leak.spec.ts
 * proves who gets them), so the server here is a Pi.
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
jest.mock("src/business/report-scope", () => ({
  ...jest.requireActual("src/business/report-scope"),
  resolveReportScope: jest.fn().mockResolvedValue({ organisationid: null, schoolids: ["s-1"] }),
}));
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

const KHMER_SCHOOL = "សាលាបឋមសិក្សា ភ្នំពេញ";

// the name in the token is never used: the school's stored name is
const tokenFor = () =>
  `Bearer ${sign(
    { jti: "test-jti", schooluserid: "u-1", schoolusername: "sample.admin", schooluserrole: SchoolRole.ADMIN, schoolname: "a name that is not the school's" },
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

  const offline = Config.fortyk.api.rpi.offline;
  beforeEach(() => {
    Config.fortyk.api.rpi.offline = true;
    tokenExists.mockResolvedValue(true);
    jest.spyOn(realFs, "readdirSync").mockReturnValue([]);
  });
  afterEach(() => {
    Config.fortyk.api.rpi.offline = offline;
    jest.restoreAllMocks();
  });

  /** The download for a school whose stored name is `schoolname` (undefined: no such school). */
  const download = (schoolname: string | undefined) => {
    jest.spyOn(schools, "findOne").mockResolvedValue((schoolname === undefined ? null : { schoolname }) as never);
    return request(app.getHttpServer()).get("/export/system-log/files").set("Authorization", tokenFor());
  };

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

  it("a school that is not found still gets a download, with no name in it", async () => {
    const res = await download(undefined);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="logfiles--[^"]*\.zip"$/);
  });
});
