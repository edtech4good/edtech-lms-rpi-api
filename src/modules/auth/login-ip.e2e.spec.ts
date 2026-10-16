import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { json } from "express";
import request from "supertest";
import { Logger } from "src/config";
import { UserAccessBusiness } from "src/business/useraccess.business";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { AuthController } from "./auth.controller";

/**
 * The address a login stores in rpiuseraccess.ipaddress is Express's req.ip, the same value the
 * login throttler keys on: the socket address unless the deployment sets TRUST_PROXY (server.ts),
 * and then the address the trusted proxy appended to X-Forwarded-For. X-Client-IP and X-Real-IP
 * are never read.
 *
 * A real Nest application (real routing, body parser, Joi interceptor and throttler guard) driven
 * over HTTP; only the database-backed businesses are replaced, and the assertion target is the
 * `ipaddress` argument handed to createuseraccesslog.
 */
jest.mock("src/business/auth.business", () => ({
  AuthBusiness: jest.fn().mockImplementation(() => ({
    login: jest.fn().mockResolvedValue({
      schooluserid: "user-1",
      studentfirstname: "Test",
      getDataValue: () => null,
    }),
  })),
}));
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({
    generateAuthToken: jest.fn().mockResolvedValue("token"),
  })),
}));
jest.mock("src/business/useraccess.business", () => ({
  UserAccessBusiness: jest.fn(),
}));

const createuseraccesslog = jest.fn();

async function makeApp(trustProxy: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot({ ttl: 60, limit: 10 })],
    controllers: [AuthController],
  }).compile();
  const app = moduleRef.createNestApplication();
  if (trustProxy) {
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.use(json({ limit: "1kb" }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}

async function storedIp(app: INestApplication, headers: Record<string, string>): Promise<string> {
  createuseraccesslog.mockClear();
  let req = request(app.getHttpServer()).post("/auth/login");
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  const res = await req.send({ studentusername: "demo.learner", studentpassword: "not-a-real-password" });
  expect(res.status).toBe(200);
  expect(createuseraccesslog).toHaveBeenCalledTimes(1);
  expect(createuseraccesslog.mock.calls[0][0]).toBe("user-1");
  return createuseraccesslog.mock.calls[0][1];
}

// supertest connects over the loopback; Node reports it as an IPv4-mapped IPv6 address or plain IPv4
// depending on how the test server bound, so each app reads its socket value once from a request with no headers
// (one extra login of the throttler's ten per minute).
const SOCKET_IPS = ["::ffff:127.0.0.1", "127.0.0.1"];

const CASES: Array<{ name: string; headers: Record<string, string>; proxied?: string }> = [
  { name: "(a) no headers", headers: {} },
  { name: "(b) X-Forwarded-For: 203.0.113.9, 10.0.0.1", headers: { "X-Forwarded-For": "203.0.113.9, 10.0.0.1" }, proxied: "10.0.0.1" },
  { name: "(c) X-Real-IP: 203.0.113.7", headers: { "X-Real-IP": "203.0.113.7" } },
  { name: "(d) X-Client-IP: 203.0.113.5", headers: { "X-Client-IP": "203.0.113.5" } },
  {
    name: "(e) X-Forwarded-For + X-Real-IP",
    headers: { "X-Forwarded-For": "203.0.113.50", "X-Real-IP": "203.0.113.7" },
    proxied: "203.0.113.50",
  },
  {
    name: "(f) X-Client-IP + X-Forwarded-For: 198.51.100.20",
    headers: { "X-Client-IP": "203.0.113.5", "X-Forwarded-For": "198.51.100.20" },
    proxied: "198.51.100.20",
  },
  {
    name: "(g) X-Real-IP + X-Forwarded-For: 198.51.100.20",
    headers: { "X-Real-IP": "203.0.113.7", "X-Forwarded-For": "198.51.100.20" },
    proxied: "198.51.100.20",
  },
];

describe("POST /auth/login stores req.ip", () => {
  let infoSpy: jest.SpyInstance;

  beforeAll(() => {
    (UserAccessBusiness as unknown as jest.Mock).mockImplementation(() => ({ createuseraccesslog }));
    infoSpy = jest.spyOn(Logger, "info").mockImplementation(() => Logger as any);
  });
  afterAll(() => infoSpy.mockRestore());

  describe("trust proxy unset (a classroom Pi): every case stores the socket address", () => {
    let app: INestApplication;
    let socket: string;
    beforeAll(async () => {
      app = await makeApp(false);
      socket = await storedIp(app, {});
      expect(SOCKET_IPS).toContain(socket);
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(CASES)("$name", async ({ headers }) => {
      expect(await storedIp(app, headers)).toBe(socket);
    });
  });

  describe("trust proxy 1 (behind the one reverse proxy): the proxy's X-Forwarded-For entry, else the socket", () => {
    let app: INestApplication;
    let socket: string;
    beforeAll(async () => {
      app = await makeApp(true);
      socket = await storedIp(app, {});
      expect(SOCKET_IPS).toContain(socket);
    });
    afterAll(async () => {
      await app.close();
    });

    it.each(CASES)("$name", async ({ headers, proxied }) => {
      expect(await storedIp(app, headers)).toBe(proxied ?? socket);
    });
  });
});
