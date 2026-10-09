import { Controller, Get, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CORS_ALLOWED_HEADERS, corsOptions } from "./cors-options";

/**
 * The browser's rule for a preflight: the real request is sent only if EVERY header it will carry is named in the
 * preflight answer's Access-Control-Allow-Headers (compared without regard to case). These specs ask the real
 * CORS middleware, configured with the options the server uses, and apply that rule.
 */
@Controller("ping")
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
}

const ORIGIN = "https://learn.example.test";

const makeApp = async (localDev: boolean, origins: string[] = [ORIGIN]): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableCors(corsOptions(localDev, new Set(origins)));
  await app.init();
  return app;
};

const preflight = (app: INestApplication, headers: string, origin = ORIGIN) =>
  request(app.getHttpServer())
    .options("/ping")
    .set("Origin", origin)
    .set("Access-Control-Request-Method", "GET")
    .set("Access-Control-Request-Headers", headers);

/** Would a browser send the real request after this preflight answer? */
const browserAllows = (res: request.Response, requested: string): boolean => {
  const allowed = String(res.headers["access-control-allow-headers"] ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase());
  return requested.split(",").every((h) => allowed.includes(h.trim().toLowerCase()));
};

describe.each([
  ["an allowed origin in production", false],
  ["any origin in local development", true],
])("CORS preflight, %s", (_name, localDev) => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await makeApp(localDev);
  });
  afterAll(async () => {
    await app.close();
  });

  it("allows X-Learning-Item-Types (the learner app's capability header), alone and with the others it sends", async () => {
    const res = await preflight(app, "x-learning-item-types");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(browserAllows(res, "x-learning-item-types")).toBe(true);
    const withOthers = await preflight(app, "authorization,content-type,x-learning-item-types,timeoffset");
    expect(browserAllows(withOthers, "authorization,content-type,x-learning-item-types,timeoffset")).toBe(true);
  });

  it("does NOT allow a header that is not on the list: the browser would refuse the real request", async () => {
    const res = await preflight(app, "x-not-on-the-list");
    expect(browserAllows(res, "x-not-on-the-list")).toBe(false);
    const mixed = await preflight(app, "authorization,x-learning-item-types,x-not-on-the-list");
    expect(browserAllows(mixed, "authorization,x-learning-item-types,x-not-on-the-list")).toBe(false);
  });

  it("answers with exactly the listed headers", async () => {
    const res = await preflight(app, "authorization");
    expect(String(res.headers["access-control-allow-headers"]).split(",").map((h) => h.trim())).toEqual(CORS_ALLOWED_HEADERS);
  });
});

describe("CORS preflight, an origin that is not allowed (production)", () => {
  it("gets no Access-Control-Allow-Origin, whatever the header", async () => {
    const app = await makeApp(false);
    const res = await preflight(app, "x-learning-item-types", "https://other.example.test");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });
});

describe("the allowed request headers", () => {
  it("are the ones the server has always allowed, plus X-Learning-Item-Types", () => {
    expect(CORS_ALLOWED_HEADERS).toEqual(["Content-Type", "Authorization", "Accept", "Accept-Language", "Cache-Control", "TIMEOFFSET", "X-Learning-Item-Types"]);
  });
});
