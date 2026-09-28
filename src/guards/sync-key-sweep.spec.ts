import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Config } from "src/config";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { ThrottlerModule } from "@nestjs/throttler";

import { AppController } from "src/app.controller";
import { AuthController } from "src/modules/auth/auth.controller";
import { AuthModule } from "src/modules/auth/auth.module";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { CurriculumModule } from "src/modules/curriculum/curriculum.module";
import { ExportController } from "src/modules/export/export.controller";
import { ExportModule } from "src/modules/export/export.module";
import { GradeController } from "src/modules/grade/grade.controller";
import { GradeModule } from "src/modules/grade/grade.module";
import { ImportController } from "src/modules/import/import.controller";
import { ImportModule } from "src/modules/import/import.module";
import { LessonController } from "src/modules/lesson/lesson.controller";
import { LessonLearningController } from "src/modules/lesson/lesson.learning.controller";
import { LessonModule } from "src/modules/lesson/lesson.module";
import { LevelController } from "src/modules/level/level.controller";
import { LevelModule } from "src/modules/level/level.module";
import { QuestionController } from "src/modules/question/question.controller";
import { QuestionModule } from "src/modules/question/question.module";
import { ReportController } from "src/modules/report/report.controller";
import { ReportModule } from "src/modules/report/report.module";
import { ResultController } from "src/modules/result/result.controller";
import { ResultModule } from "src/modules/result/result.module";
import { SchoolController } from "src/modules/school/school.controller";
import { SchoolModule } from "src/modules/school/school.module";
import { StudentController } from "src/modules/student/student.controller";
import { StudentModule } from "src/modules/student/student.module";
import { TeacherController } from "src/modules/teachers/teacher.controller";
import { TeacherModule } from "src/modules/teachers/teacher.module";
import { AccessController } from "src/modules/access/access.controller";
import { AccessModule } from "src/modules/access/access.module";

/**
 * edtech4good/workspace#45 (PR #90 fix round): a router sweep, not a
 * hand-picked sample. It builds the real Nest app — every controller the
 * real `AppModule` wires up, the real JWT strategy — walks the actual
 * Express router stack Nest produced (method + path, every controller, path
 * params filled with a dummy value) and fires the configured server sync
 * key at literally every one of them.
 *
 * Only the token-table lookup is stubbed (no database here); nothing about
 * the guards themselves is mocked. Business-layer calls are NOT stubbed —
 * an allow-listed route that gets the guard's blessing is allowed to 500
 * from a missing database; that still proves the guard let it through. Only
 * 401/403 mean the guard stopped the request.
 *
 * The two lists below are the entire contract:
 *   - ALLOWLIST: routes central legitimately calls server-to-server with
 *     the sync key (the 15 report/* routes it proxies, plus
 *     curriculum/:id/getstudentresult, student/logintime, and the 3
 *     import/* routes guarded by ServerSyncGuard).
 *   - PUBLIC: routes that take no authentication at all, sync key or
 *     otherwise (login, logout, branding, the two unauthenticated basics).
 *
 * Every OTHER route enumerated off the router — including any route added
 * after this test was written — must refuse the sync key with 401. That is
 * what makes this a sweep instead of a sample: a new route with no guard,
 * or a route someone widens to accept the key without updating ALLOWLIST,
 * fails this spec by construction, not by someone remembering to add a
 * case for it.
 */

type RouteKey = `${string} ${string}`;

const routeKey = (method: string, path: string): RouteKey =>
  `${method.toUpperCase()} ${path}` as RouteKey;

// The 15 report/* routes central proxies with the sync key (`offlineonline`
// is deliberately excluded: central's call to it is commented out, so it
// keeps the plain AccessGuard and refuses the key), plus
// curriculum/:id/getstudentresult, student/logintime, and the 3 import/*
// routes (ServerSyncGuard). See export.controller.ts / report.controller.ts
// / curriculum.controller.ts / student.controller.ts for the per-route
// comments citing the central caller for each.
const ALLOWLIST: Array<RouteKey> = [
  routeKey("POST", "/report/studentprogress"),
  routeKey("POST", "/report/studentprogress/class"),
  routeKey("POST", "/report/studentlastcompletedquiz"),
  routeKey("POST", "/report/studentlevelquiz"),
  routeKey("POST", "/report/studentlevelquiz/class"),
  routeKey("POST", "/report/studentstatus"),
  routeKey("POST", "/report/student-grade-progress"),
  routeKey("POST", "/report/student-level-progress"),
  routeKey("POST", "/report/student-lesson-progress"),
  routeKey("POST", "/report/studentprogress/download"),
  routeKey("POST", "/report/studentlastcompletedquiz/download"),
  routeKey("POST", "/report/studentlevelquiz/download"),
  routeKey("POST", "/report/studentlevelquiz/class/download"),
  routeKey("POST", "/report/studentstatus/download"),
  routeKey("POST", "/report/studentprogress/class/download"),
  routeKey("GET", "/curriculum/:curriculumbaselineid/getstudentresult"),
  routeKey("POST", "/student/logintime"),
  routeKey("PUT", "/import/students"),
  routeKey("PUT", "/import/teachers"),
  routeKey("PUT", "/import/master"),
];

// Routes that take no authentication at all — the sync key isn't relevant
// to them one way or the other, so they're excluded from the "must 401"
// sweep below and (where cheap) just checked for being reachable.
const PUBLIC: Array<RouteKey> = [
  routeKey("GET", "/"),
  routeKey("GET", "/version"),
  routeKey("POST", "/auth/login"),
  routeKey("POST", "/auth/logout"),
  routeKey("GET", "/school/branding"),
];

const tokenExists = jest.fn();
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

/**
 * Fills every `:param` segment of an Express route path with a dummy value
 * so it becomes a concrete, requestable URL. Nest/Express route paths never
 * contain literal colons outside a param name, so this is unambiguous.
 */
const concretePath = (path: string): string =>
  path.replace(/:[^/]+/g, "dummy-id");

interface EnumeratedRoute {
  method: string;
  path: string; // raw path, e.g. "/curriculum/:curriculumbaselineid/getstudentresult"
}

/**
 * Walks the Express router stack the running Nest app actually registered
 * — not a list transcribed from the controller source, which could drift
 * from what's really mounted (a guard applied to the wrong decorator, a
 * route Nest silently didn't register, etc). Handles both top-level routes
 * and any nested router layers, though Nest's default Express adapter
 * mounts everything at the top level for an app with no path versioning.
 */
const REQUEST_METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
};

// Joins a controller prefix and a route sub-path the way Express ends up
// storing them: no trailing slash, single leading slash, and a bare
// `@Get()`/`@Post()` (sub-path "" or "/") contributes nothing.
const joinPath = (prefix: string, sub: string): string => {
  const segments = [...prefix.split("/"), ...sub.split("/")].filter(
    (s) => s.length > 0
  );
  return `/${segments.join("/")}`;
};

/**
 * Reads the same `@Controller`/`@Get`/`@Post`/... decorator metadata Nest's
 * own router-explorer reads to mount routes, but synchronously and at
 * module-load time (no app to boot) — so `it.each` below can enumerate one
 * test per route instead of one aggregate test, and a route someone adds
 * later shows up as its own new test case without needing the app running
 * first. `enumerateRoutes` (Express-stack based, below) cross-checks this
 * list against what actually got mounted at runtime, so a decorator this
 * function misreads and a real mounting bug are both caught.
 */
function reflectRoutes(controllerClass: any): Array<EnumeratedRoute> {
  const prefix: string = Reflect.getMetadata(PATH_METADATA, controllerClass) ?? "";
  const proto = controllerClass.prototype;
  const routes: Array<EnumeratedRoute> = [];
  for (const propertyName of Object.getOwnPropertyNames(proto)) {
    if (propertyName === "constructor") continue;
    const handler = proto[propertyName];
    const subPath = Reflect.getMetadata(PATH_METADATA, handler);
    const methodEnum = Reflect.getMetadata(METHOD_METADATA, handler);
    if (subPath === undefined || methodEnum === undefined) continue;
    const subPaths: Array<string> = Array.isArray(subPath) ? subPath : [subPath];
    for (const sp of subPaths) {
      routes.push({
        method: REQUEST_METHOD_NAME[methodEnum] ?? String(methodEnum),
        path: joinPath(prefix, sp),
      });
    }
  }
  return routes;
}

const ALL_CONTROLLERS = [
  AppController,
  AuthController,
  CurriculumController,
  ExportController,
  GradeController,
  ImportController,
  LessonController,
  LessonLearningController,
  LevelController,
  QuestionController,
  ReportController,
  ResultController,
  SchoolController,
  StudentController,
  TeacherController,
  AccessController,
];

// The source of truth for the sweep: every route reflected off every
// controller registered in the real AppModule (src/app.module.ts).
const REFLECTED_ROUTES: Array<EnumeratedRoute> = ALL_CONTROLLERS.flatMap(reflectRoutes);

function enumerateRoutes(app: INestApplication): Array<EnumeratedRoute> {
  const httpAdapter = app.getHttpAdapter().getInstance();
  const routes: Array<EnumeratedRoute> = [];

  const walk = (stack: any[], prefix: string): void => {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix + layer.route.path;
        const methods = Object.keys(layer.route.methods).filter(
          (m) => layer.route.methods[m]
        );
        for (const method of methods) {
          routes.push({ method: method.toUpperCase(), path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };

  walk(httpAdapter._router.stack, "");
  return routes;
}

describe("Server sync key router sweep (edtech4good/workspace#45)", () => {
  let app: INestApplication;
  let routes: Array<EnumeratedRoute>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // Mirrors AppModule's own imports (src/app.module.ts) minus
      // ScheduleModule/TasksService, which register cron jobs and have
      // nothing to do with routing.
      imports: [
        ThrottlerModule.forRoot({ ttl: 60, limit: 10 }),
        AuthModule,
        CurriculumModule,
        QuestionModule,
        ExportModule,
        ResultModule,
        ImportModule,
        TeacherModule,
        LessonModule,
        GradeModule,
        LevelModule,
        StudentModule,
        AccessModule,
        ReportModule,
        SchoolModule,
      ],
      controllers: [AppController],
      providers: [JwtAccessStrategy],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    routes = enumerateRoutes(app);
  });

  beforeEach(() => {
    tokenExists.mockResolvedValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  const syncKey = () => Config.fortyk.api.serversynckey;

  const send = (method: string, path: string) => {
    const m = method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    return request(app.getHttpServer())[m](path).set("Authorization", syncKey());
  };

  it("enumerated at least every route this spec knows about (sweep isn't silently empty)", () => {
    // A sanity floor, not an exact count: guards against a refactor (e.g. a
    // global route prefix) silently breaking `enumerateRoutes` and leaving
    // every `it.each` below iterating an empty array, which would pass
    // vacuously and prove nothing.
    expect(routes.length).toBeGreaterThanOrEqual(
      ALLOWLIST.length + PUBLIC.length + 20
    );
  });

  it("the reflected (decorator) route list matches the live (Express router) route list", () => {
    // Two independent readings of "what routes exist" — decorator metadata
    // read synchronously at module-load, and the actual Express stack the
    // booted app mounted — must agree. If they don't, `it.each(REFLECTED_ROUTES)`
    // below could be silently checking routes that were never really
    // registered (or missing ones that were).
    const toSet = (list: Array<EnumeratedRoute>) =>
      new Set(list.map((r) => routeKey(r.method, r.path)));
    const reflected = toSet(REFLECTED_ROUTES);
    const live = toSet(routes);
    expect([...reflected].sort()).toEqual([...live].sort());
  });

  describe("every ALLOWLIST route is actually a real, registered route", () => {
    it.each(ALLOWLIST)("%s is registered", (key) => {
      const [method, path] = key.split(" ");
      expect(
        routes.some((r) => r.method === method && r.path === path)
      ).toBe(true);
    });
  });

  describe("every PUBLIC route is actually a real, registered route", () => {
    it.each(PUBLIC)("%s is registered", (key) => {
      const [method, path] = key.split(" ");
      expect(
        routes.some((r) => r.method === method && r.path === path)
      ).toBe(true);
    });
  });

  // One test per route (not one aggregate assertion) so a regression shows
  // up as N individual failures naming the exact routes that started
  // accepting the key — not a single opaque "the sweep failed".
  const NON_ALLOWLISTED_NON_PUBLIC = REFLECTED_ROUTES.filter((r) => {
    const key = routeKey(r.method, r.path);
    return !ALLOWLIST.includes(key) && !PUBLIC.includes(key);
  });

  describe("the sweep: every non-allow-listed, non-public route refuses the sync key with 401", () => {
    // Fails loudly (not vacuously) if a change upstream means nothing is
    // left to check — e.g. every route accidentally ending up allow-listed.
    it("has routes left to check", () => {
      expect(NON_ALLOWLISTED_NON_PUBLIC.length).toBeGreaterThan(20);
    });

    it.each(NON_ALLOWLISTED_NON_PUBLIC.map((r) => routeKey(r.method, r.path)))(
      "%s refuses the sync key with 401",
      async (key) => {
        const [method, path] = key.split(" ");
        const res = await send(method, concretePath(path));
        expect(res.status).toBe(401);
      }
    );
  });

  describe("every ALLOWLIST route gets the sync key past the guard", () => {
    it.each(ALLOWLIST)(
      "%s: sync key is not refused with 401/403 (a 500 from a stubbed/absent database is acceptable — it only proves the guard let the request through)",
      async (key) => {
        const [method, path] = key.split(" ");
        const res = await send(method, concretePath(path));
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      }
    );
  });

  describe("PUBLIC routes are excluded from the sweep and reachable without auth", () => {
    it("GET / is reachable with no Authorization header", async () => {
      await request(app.getHttpServer()).get("/").expect(200);
    });

    it("GET /version is reachable with no Authorization header", async () => {
      await request(app.getHttpServer()).get("/version").expect(200);
    });

    it("GET /school/branding is reachable with no Authorization header (cheap: no body, stubbed token lookup unused)", async () => {
      const res = await request(app.getHttpServer()).get("/school/branding");
      expect(res.status).not.toBe(401);
    });

    // auth/login and auth/logout aren't asserted reachable here: login
    // needs a real body and hits the business/DB layer for real (not
    // cheap), and logout's behavior with no Authorization header is
    // "returns {error: true}", not a status worth asserting against a
    // guard. Both are still excluded from the 401 sweep above because they
    // are public — that's the property this spec is responsible for.
  });
});
