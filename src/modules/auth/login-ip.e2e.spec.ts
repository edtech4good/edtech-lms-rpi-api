import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { json } from "express";
import request from "supertest";
import { Logger } from "src/config";
import { UserAccessBusiness } from "src/business/useraccess.business";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
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
  // A client that reaches the API directly, with TRUST_PROXY set, chooses X-Forwarded-For: only an IP address is stored.
  { name: "(h) X-Forwarded-For: not-an-ip", headers: { "X-Forwarded-For": "not-an-ip" } },
  { name: "(i) X-Forwarded-For: a 60-character value", headers: { "X-Forwarded-For": "a".repeat(60) } },
];

// The login route allows ten attempts a minute per address, and each describe below opens its own application.
const MORE_CASES: Array<{ name: string; headers: Record<string, string>; proxied?: string }> = [
  { name: "(j) X-Forwarded-For: an IPv6 address", headers: { "X-Forwarded-For": "2001:db8::1" }, proxied: "2001:db8::1" },
  { name: "(k) X-Forwarded-For: an IP address followed by text", headers: { "X-Forwarded-For": "203.0.113.9; DROP TABLE" } },
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

describe("POST /auth/login stores req.ip: more forwarded values, trust proxy 1", () => {
  let infoSpy: jest.SpyInstance;
  let app: INestApplication;
  let socket: string;
  beforeAll(async () => {
    (UserAccessBusiness as unknown as jest.Mock).mockImplementation(() => ({ createuseraccesslog }));
    infoSpy = jest.spyOn(Logger, "info").mockImplementation(() => Logger as any);
    app = await makeApp(true);
    socket = await storedIp(app, {});
  });
  afterAll(async () => {
    infoSpy.mockRestore();
    await app.close();
  });

  it.each(MORE_CASES)("$name", async ({ headers, proxied }) => {
    expect(await storedIp(app, headers)).toBe(proxied ?? socket);
  });
});

/**
 * The same login with the real access-log business over a stand-in for the table that, like MySQL, refuses an
 * address wider than the column (STRING(45)): the stored address is the socket's, the login answers 200, and a
 * login whose access row is refused leaves the user's previous session open.
 */
describe("POST /auth/login with the real access-log business", () => {
  type Access = { rpiuseraccessid: string; userid: string; status: number; ipaddress: string };
  let rows: Access[];
  let infoSpy: jest.SpyInstance;
  let refuseCreate: boolean;
  let tableSpies: jest.SpyInstance[] = [];

  beforeAll(() => {
    const Actual = jest.requireActual("src/business/useraccess.business").UserAccessBusiness;
    (UserAccessBusiness as unknown as jest.Mock).mockImplementation(() => new Actual());
    infoSpy = jest.spyOn(Logger, "info").mockImplementation(() => Logger as any);
  });
  afterAll(() => infoSpy.mockRestore());

  beforeEach(() => {
    refuseCreate = false;
    rows = [{ rpiuseraccessid: "previous", userid: "user-1", status: 1, ipaddress: "198.51.100.1" }];
    const createSpy = jest.spyOn(rpiuseraccess, "create").mockImplementation((async (row: Access) => {
      if (refuseCreate || row.ipaddress.length > 45) throw new Error("Data too long for column 'ipaddress'");
      rows.push({ rpiuseraccessid: row.rpiuseraccessid, userid: row.userid, status: row.status, ipaddress: row.ipaddress });
      return row;
    }) as never);
    const updateSpy = jest.spyOn(rpiuseraccess, "update").mockImplementation((async (values: { status: number }, options: { where: { userid: string; status: number; rpiuseraccessid?: { [k: symbol]: string } } }) => {
      const [ne] = Object.getOwnPropertySymbols(options.where.rpiuseraccessid ?? {});
      const except = ne ? options.where.rpiuseraccessid![ne] : undefined;
      let n = 0;
      for (const r of rows) {
        if (r.userid === options.where.userid && r.status === options.where.status && r.rpiuseraccessid !== except) {
          r.status = values.status;
          n += 1;
        }
      }
      return [n];
    }) as never);
    tableSpies = [createSpy, updateSpy];
  });
  afterEach(() => tableSpies.forEach((spy) => spy.mockRestore()));

  const loginWith = async (app: INestApplication, headers: Record<string, string>) => {
    let req = request(app.getHttpServer()).post("/auth/login");
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send({ studentusername: "demo.learner", studentpassword: "not-a-real-password" });
  };

  describe("trust proxy 1", () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await makeApp(true);
    });
    afterAll(async () => {
      await app.close();
    });

    it("a 60-character X-Forwarded-For: the login answers 200, the socket address is stored, and the previous session is closed as on any login", async () => {
      const res = await loginWith(app, { "X-Forwarded-For": "a".repeat(60) });
      expect(res.status).toBe(200);
      const added = rows.filter((r) => r.rpiuseraccessid !== "previous");
      expect(added).toHaveLength(1);
      expect(SOCKET_IPS).toContain(added[0].ipaddress);
      expect(added[0].status).toBe(1);
      expect(rows.find((r) => r.rpiuseraccessid === "previous")!.status).toBe(3);
    });

    it("an access row that is refused leaves the previous session open", async () => {
      refuseCreate = true;
      const res = await loginWith(app, {});
      expect(res.status).not.toBe(200);
      expect(rows).toEqual([{ rpiuseraccessid: "previous", userid: "user-1", status: 1, ipaddress: "198.51.100.1" }]);
    });
  });
});
