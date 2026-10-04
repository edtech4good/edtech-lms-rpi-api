import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Config } from "src/config";

import { AppModule } from "src/app.module";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { ExportController } from "src/modules/export/export.controller";
import { ImportController } from "src/modules/import/import.controller";
import { ReportController } from "src/modules/report/report.controller";
import { StudentController } from "src/modules/student/student.controller";

/**
 * edtech4good/workspace#45 (PR #90, second fix round): a router sweep, not a
 * hand-picked sample — and, this round, one anchored to the real composition
 * root instead of a second hand-picked list.
 *
 * Round 1 built its own `ALL_CONTROLLERS` array and compared it against a
 * `Test.createTestingModule({ imports: [...] })` whose `imports` was a
 * second, separately hand-copied transcription of `AppModule`'s imports.
 * Both lists were written by hand from the same source, so the "reflected
 * vs live" cross-check only ever compared two views of each other — a new
 * module added to the real `AppModule` and left out of both lists here left
 * the sweep green. Proven: a `ZzModule` with an unguarded `GET /zz/open`
 * added to `AppModule` did not turn this spec red before this round's fix.
 *
 * Fixed by dropping the hand list entirely: `REFLECTED_ROUTES` below is
 * built by walking `AppModule`'s own `@Module` metadata (`imports` /
 * `controllers`, recursively, the same two keys Nest itself reads to wire
 * the app) — and the live app is booted from `imports: [AppModule]`, the
 * actual composition root, not a copy of it. A controller newly reachable
 * from `AppModule` — however deep the import chain — now shows up in both
 * readings automatically, with no list here to remember to update.
 */

type RouteKey = `${string} ${string}`;

const routeKey = (method: string, path: string): RouteKey =>
  `${method.toUpperCase()} ${path}` as RouteKey;

// The 15 report/* routes central proxies with the sync key (`offlineonline`
// is deliberately excluded: central's call to it is commented out, so it
// keeps the plain AccessGuard and refuses the key), plus
// curriculum/:id/getstudentresult, student/logintime, export/report-data (the
// nightly report pull) and the 4 import/* routes (ServerSyncGuard). export/log
// and export/system-log/files have no key caller and refuse the key. See export.controller.ts / report.controller.ts
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
  routeKey("GET", "/export/report-data"),
  routeKey("PUT", "/import/students"),
  routeKey("PUT", "/import/teachers"),
  routeKey("PUT", "/import/master"),
  routeKey("PUT", "/import/ownership"),
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

// Which controller method backs each ALLOWLIST route, so the sweep can spy
// on the handler itself and prove it actually ran — not just infer that from
// a status code. See "handler-ran proof" below (edtech4good/workspace#45,
// PR #90 second fix round): asserting "not 401/403" on the response status
// alone passes just as well when the guard CRASHES (a 500, same as a
// missing-database 500) as when it correctly lets the request through.
// Proven: making `AccessOrServerSyncGuard` throw a plain `Error` on the key
// path left this sweep green before this round's fix.
const ALLOWLIST_HANDLERS: Record<RouteKey, [any, string]> = {
  [routeKey("POST", "/report/studentprogress")]: [ReportController, "getStudentsProgress"],
  [routeKey("POST", "/report/studentprogress/class")]: [ReportController, "getClassProgress"],
  [routeKey("POST", "/report/studentlastcompletedquiz")]: [
    ReportController,
    "getStudentsLastProgress",
  ],
  [routeKey("POST", "/report/studentlevelquiz")]: [ReportController, "getLevelQuiz"],
  [routeKey("POST", "/report/studentlevelquiz/class")]: [ReportController, "getClassLevelQuiz"],
  [routeKey("POST", "/report/studentstatus")]: [ReportController, "getStudentStatus"],
  [routeKey("POST", "/report/student-grade-progress")]: [
    ReportController,
    "getStudentGradeProgress",
  ],
  [routeKey("POST", "/report/student-level-progress")]: [
    ReportController,
    "getStudentLevelProgress",
  ],
  [routeKey("POST", "/report/student-lesson-progress")]: [
    ReportController,
    "getStudentLessonProgress",
  ],
  [routeKey("POST", "/report/studentprogress/download")]: [
    ReportController,
    "getStudentsQuizzes",
  ],
  [routeKey("POST", "/report/studentlastcompletedquiz/download")]: [
    ReportController,
    "downloadOfflineCurrentLevel",
  ],
  [routeKey("POST", "/report/studentlevelquiz/download")]: [
    ReportController,
    "getStudentsLevelQuizzes",
  ],
  [routeKey("POST", "/report/studentlevelquiz/class/download")]: [
    ReportController,
    "getClassLevelQuizzes",
  ],
  [routeKey("POST", "/report/studentstatus/download")]: [ReportController, "getStudentsActivity"],
  [routeKey("POST", "/report/studentprogress/class/download")]: [
    ReportController,
    "getClassActivity",
  ],
  [routeKey("GET", "/curriculum/:curriculumbaselineid/getstudentresult")]: [
    CurriculumController,
    "getStudentBaselineEndlineResults",
  ],
  [routeKey("POST", "/student/logintime")]: [StudentController, "getlogintime"],
  [routeKey("GET", "/export/report-data")]: [ExportController, "getReportData"],
  [routeKey("PUT", "/import/students")]: [ImportController, "studentsimport"],
  [routeKey("PUT", "/import/teachers")]: [ImportController, "teachersimport"],
  [routeKey("PUT", "/import/master")]: [ImportController, "completesync"],
  [routeKey("PUT", "/import/ownership")]: [ImportController, "ownership"],
};

/**
 * `jest.spyOn(prototype, methodName)` replaces the prototype property with a
 * brand-new mock function object. Nest's `RouterExplorer` reads
 * `PATH_METADATA`/`METHOD_METADATA`/`GUARDS_METADATA`/etc. directly off that
 * exact function reference when it scans a controller at module-compile
 * time (`Reflect.getMetadata(KEY, prototype[methodName])`) — a bare spy
 * wrapper carries none of that, so the route silently fails to register at
 * all if the spy is installed before `compile()` with nothing done about
 * it. This copies every metadata key from the original handler onto the
 * spy's function object before Nest ever scans it, so route discovery sees
 * an unchanged method (same guards, same path) and the spy still records
 * every call once the app is running.
 */
function spyOnRouteHandler(controllerClass: any, methodName: string): jest.SpyInstance {
  const original = controllerClass.prototype[methodName];
  const spy = jest.spyOn(controllerClass.prototype, methodName);
  const spyFn = controllerClass.prototype[methodName];
  for (const metadataKey of Reflect.getMetadataKeys(original)) {
    Reflect.defineMetadata(metadataKey, Reflect.getMetadata(metadataKey, original), spyFn);
  }
  return spy;
}

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
 * Reads the same `@Controller`/`@Get`/`@Post`/... decorator metadata Nest's
 * own router-explorer reads to mount routes, but synchronously, off a
 * controller class already in hand (no app needed to boot).
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

function reflectRoutesForController(controllerClass: any): Array<EnumeratedRoute> {
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

/**
 * A NestJS `@Module()`'s `imports` entry is either a module class (plain
 * decorator metadata to read) or a `DynamicModule` object (e.g.
 * `ThrottlerModule.forRoot(...)`, `ScheduleModule.forRoot()`) that carries
 * its own `module`/`imports`/`controllers` instead of, or in addition to,
 * decorator metadata on the class. This normalizes either shape to the same
 * three fields.
 */
function describeModule(entry: any): {
  moduleClass: any;
  controllers: Array<any>;
  imports: Array<any>;
} {
  const isDynamicModule = entry && typeof entry === "object" && "module" in entry;
  const moduleClass = isDynamicModule ? entry.module : entry;
  const controllers: Array<any> =
    (isDynamicModule ? entry.controllers : undefined) ??
    Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) ??
    [];
  const imports: Array<any> =
    (isDynamicModule ? entry.imports : undefined) ??
    Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ??
    [];
  return { moduleClass, controllers, imports };
}

/**
 * Walks `AppModule`'s own `@Module({ imports, controllers })` metadata
 * recursively — the exact two properties Nest's own module scanner reads to
 * wire the app — and collects every controller class reachable from it, at
 * any depth. This is the fix for the enumeration gap: previously this spec
 * carried its own hand-written `ALL_CONTROLLERS` list, so "reflected vs
 * live" only ever compared two hand-written lists against each other. Now
 * there is exactly one list of controllers in this spec, and it is read off
 * `AppModule` itself — a controller added anywhere in `AppModule`'s import
 * tree (however deep) is picked up automatically, with nothing here to
 * remember to update.
 */
function collectControllersFromModule(rootModule: any): Array<any> {
  const seen = new Set<any>();
  const controllers = new Set<any>();

  const visit = (entry: any): void => {
    const { moduleClass, controllers: moduleControllers, imports } = describeModule(entry);
    if (seen.has(moduleClass)) return;
    seen.add(moduleClass);
    for (const controller of moduleControllers) controllers.add(controller);
    for (const imported of imports) visit(imported);
  };

  visit(rootModule);
  return [...controllers];
}

// The source of truth for the sweep: every controller reachable from the
// real `AppModule` (src/app.module.ts), read off its own metadata — not a
// list transcribed by hand.
const REFLECTED_ROUTES: Array<EnumeratedRoute> = collectControllersFromModule(
  AppModule
).flatMap(reflectRoutesForController);

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
  let handlerSpies: Record<RouteKey, jest.SpyInstance>;

  beforeAll(async () => {
    // Spy on (not replace) each allow-listed route's controller method
    // BEFORE the module compiles/boots: Nest's router explorer binds each
    // route to a specific function reference (`instance[method].bind(...)`)
    // during `app.init()`, so a spy installed afterward is never the
    // function Express actually calls. Installed here, the spy IS the
    // prototype method Nest binds, so the "gets past the guard" assertions
    // below can prove the handler body itself ran, independent of whatever
    // status code a real (absent) database causes it to end in.
    handlerSpies = Object.fromEntries(
      Object.entries(ALLOWLIST_HANDLERS).map(([key, [controllerClass, methodName]]) => [
        key,
        spyOnRouteHandler(controllerClass, methodName),
      ])
    ) as Record<RouteKey, jest.SpyInstance>;

    // The real composition root — not a copy of its `imports` list. A
    // module added to `AppModule` (however it gets there) is compiled for
    // real here. `ScheduleModule.forRoot()`/`TasksService`'s `@Cron` only
    // registers with `SchedulerRegistry`; nothing here opens a database
    // connection (the app's own `dbinstance` is a lazily-created singleton —
    // see src/services/dbservice.ts — never touched at module-compile time).
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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
    // `X-Organisation-Id: platform` is what central sends for a platform user: the report routes refuse a key call without it.
    return request(app.getHttpServer())[m](path).set("Authorization", syncKey()).set("X-Organisation-Id", "platform");
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

  it("the reflected (AppModule metadata) route list matches the live (Express router) route list", () => {
    // Two independent readings of "what routes exist" — AppModule's own
    // `@Module` metadata, walked recursively and read synchronously, versus
    // the actual Express stack the booted app mounted — must agree. Both
    // now trace back to the same composition root (`AppModule`), so this
    // catches a decorator misread or a mounting bug, not a drift between two
    // hand-written lists.
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

  describe("every ALLOWLIST route gets the sync key past the guard, and the handler itself runs", () => {
    // Not just "not 401/403": that alone also passes when the GUARD crashes
    // (a 500 looks the same as the "no database" 500 this spec otherwise
    // tolerates). Proven: a plain `Error` thrown from
    // `AccessOrServerSyncGuard` on the sync-key path left this describe
    // block green before this round's fix. The spy proves the controller
    // method itself was invoked — which only happens once the guard has
    // actually let the request through — independent of what a real
    // (absent) database then does to the response status.
    it.each(ALLOWLIST)(
      "%s: sync key reaches the handler (a 500 from a stubbed/absent database afterward is acceptable; the handler running is not optional)",
      async (key) => {
        const [method, path] = key.split(" ");
        const spy = handlerSpies[key];
        await send(method, concretePath(path));
        expect(spy).toHaveBeenCalledTimes(1);
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
