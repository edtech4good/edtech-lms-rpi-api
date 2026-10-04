import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mixin } from "@nestjs/common";
import { MODULE_PATH } from "@nestjs/common/constants";
import * as ts from "typescript";
import { ORG_POLICIES, ORG_POLICY_DEFINITIONS, ORG_POLICY_TIE_BREAK } from "src/decorators/orgPolicy.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { withGuardInfo } from "src/guards/guard-info";
import { TokenType } from "src/models/enums";
import { SchoolRole } from "src/models/enums/school.role.enum";
import {
  countByPolicy,
  describeGuard,
  duplicateRoutes,
  enforcementState,
  enumerateRoutes,
  INVENTORY_DOC_PATH,
  modulesWithModulePath,
  parsePendingSnapshot,
  PENDING_MEANING,
  pendingEnforcementLines,
  policyGuardViolations,
  policyLabel,
  renderInventoryMarkdown,
  renderPendingSnapshot,
  RouteRecord,
  routesWithoutPolicy,
  routesWithUnknownPolicy,
  specProvesRoute,
  specTests,
} from "./route-inventory";

/**
 * The organisation route inventory (docs/admin-organisations-schema.md §8, in the platform's workspace repository).
 *
 * Several organisations share this API, and a classroom Pi runs the same code for one school, so every route must
 * declare which organisation policy applies to it (`@OrgPolicy`, src/decorators/orgPolicy.decorator.ts). This spec
 * enumerates the routes the application REALLY registers - AppModule's module graph, read through Nest's own
 * DiscoveryService - and fails when:
 *  - a route has no policy, or a policy that is not in the list;
 *  - two routes resolve to the same method and path;
 *  - the route total, the count per policy or the count proved / not applicable / pending changes (pinned below, so
 *    adding a route is a conscious edit);
 *  - the pending snapshot or docs/route-policy-inventory.md no longer matches what the code says;
 *  - a policy contradicts the guards the route has today;
 *  - a route that names a proving spec (`enforcedBy`) is not proved by it.
 *
 * No server is started and no database is opened: the application context is created, read and closed.
 */

// Pinned on purpose. When you add or remove a route, update these numbers AND run
// `npm run routes:policy -- --write` to refresh the committed files.
const EXPECTED_TOTAL = 83;
const EXPECTED_BY_POLICY = { public: 5, learner: 42, teacher: 32, server: 3, "pi-import": 1 };
const EXPECTED_PROVED = 72;
const EXPECTED_NOT_APPLICABLE = 5;
const EXPECTED_PENDING = 6;

// The routes still pending, by name. They are the ones the leak spec does not prove: the whole-server exports, and the
// three server-key-only imports (whose rows are proved by the specs under src/modules/import, which the inventory does
// not read).
const EXPECTED_PENDING_ROUTES = [
  "GET /export/log",
  "GET /export/report-data",
  "GET /export/system-log/files",
  "PUT /import/ownership",
  "PUT /import/students",
  "PUT /import/teachers",
];

// Routes with no AccessGuard that read the bearer token in the handler.
const AUTHENTICATED_IN_HANDLER = ["POST /auth/logout"];

const SNAPSHOT_FILE = join(__dirname, "pending-enforcement.snapshot.txt");
const DOC_FILE = join(__dirname, "..", "..", INVENTORY_DOC_PATH);
const DECORATOR_FILE = join(__dirname, "..", "decorators", "orgPolicy.decorator.ts");
const SERVER_FILE = join(__dirname, "..", "server.ts");

const key = (r: RouteRecord) => `${r.method} ${r.path}`;

describe("route inventory (real application wiring)", () => {
  let routes: RouteRecord[];

  beforeAll(async () => {
    routes = await enumerateRoutes();
  }, 180_000);

  it("finds routes in the registered controllers", () => {
    expect(routes.length).toBeGreaterThan(0);
    for (const controller of ["TeacherController", "ReportController", "ResultController", "ImportController", "SchoolController"]) {
      expect(routes.filter((r) => r.controller === controller).length).toBeGreaterThan(0);
    }
  });

  it("gives every route an @OrgPolicy", () => {
    expect(routesWithoutPolicy(routes)).toEqual([]);
  });

  it("allows only known policy values", () => {
    expect(routesWithUnknownPolicy(routes)).toEqual([]);
  });

  it("has no two routes with the same method and path", () => {
    expect(duplicateRoutes(routes)).toEqual([]);
  });

  it("pins the total number of routes", () => {
    expect(routes).toHaveLength(EXPECTED_TOTAL);
  });

  it("pins the number of routes per policy", () => {
    expect(countByPolicy(routes)).toEqual(EXPECTED_BY_POLICY);
  });

  describe("proved and pending", () => {
    it("divides the routes into 72 proved by a spec, 5 not applicable (public) and 6 pending", () => {
      const count = (state: string) => routes.filter((r) => enforcementState(r) === state).length;
      expect(count("yes")).toBe(EXPECTED_PROVED);
      expect(count("n/a")).toBe(EXPECTED_NOT_APPLICABLE);
      expect(count("pending")).toBe(EXPECTED_PENDING);
      expect(EXPECTED_PROVED + EXPECTED_NOT_APPLICABLE + EXPECTED_PENDING).toBe(EXPECTED_TOTAL);
      expect(routes.filter((r) => r.policy === "public").every((r) => enforcementState(r) === "n/a")).toBe(true);
    });

    it("the pending routes are exactly the six named ones", () => {
      expect(routes.filter((r) => enforcementState(r) === "pending").map(key).sort()).toEqual([...EXPECTED_PENDING_ROUTES].sort());
    });

    it("every route that names a proving spec is proven by it (the file exists and has the route in a test title)", () => {
      const declared = routes.filter((r) => r.enforcedBy !== undefined);
      expect(declared.filter((r) => !r.enforcedByProven).map(key)).toEqual([]);
      expect(declared).toHaveLength(EXPECTED_PROVED);
    });

    it("no public route names a proving spec (there is nothing to prove)", () => {
      expect(routes.filter((r) => r.policy === "public" && r.enforcedBy !== undefined).map(key)).toEqual([]);
    });

    it("the proving spec is the leak spec", () => {
      expect([...new Set(routes.filter((r) => r.enforcedBy !== undefined).map((r) => r.enforcedBy))]).toEqual(["src/modules/org-boundary.leak.spec.ts"]);
    });

    it("the snapshot file, header included, is exactly what the generator writes", () => {
      const text = readFileSync(SNAPSHOT_FILE, "utf8");
      expect(text).toBe(renderPendingSnapshot(routes));
      expect(text).toContain(PENDING_MEANING);
    });

    it("matches the checked-in snapshot exactly", () => {
      expect(pendingEnforcementLines(routes)).toEqual(parsePendingSnapshot(readFileSync(SNAPSHOT_FILE, "utf8")));
    });

    it("the snapshot leaves out proved and public routes", () => {
      const listed = new Set(pendingEnforcementLines(routes).map((l) => l.split("  ")[0]));
      for (const r of routes) {
        if (r.policy === "public" || r.enforcedByProven) {
          expect(listed.has(key(r))).toBe(false);
        }
      }
    });
  });

  describe("policy against today's guards", () => {
    it("every route's policy agrees with its guards", () => {
      expect(policyGuardViolations(routes, AUTHENTICATED_IN_HANDLER)).toEqual([]);
    });

    it("routes with no authentication guard are `public`, and `public` routes have none", () => {
      expect(routes.filter((r) => r.auth === "none" && r.policy !== "public").map(key)).toEqual([]);
      expect(routes.filter((r) => r.policy === "public" && r.auth !== "none").map(key)).toEqual([]);
    });

    it("the handler-authenticated exception really has no guard", () => {
      for (const name of AUTHENTICATED_IN_HANDLER) {
        const r = routes.find((x) => key(x) === name);
        expect(r?.auth).toBe("none");
        expect(r?.policy).toBe("public");
      }
    });

    it("`server` routes are the three imports that take only central's key", () => {
      expect(routes.filter((r) => r.policy === "server").map(key).sort()).toEqual(["PUT /import/ownership", "PUT /import/students", "PUT /import/teachers"]);
      expect(routes.filter((r) => r.auth === "server-key-only").map(key).sort()).toEqual(["PUT /import/ownership", "PUT /import/students", "PUT /import/teachers"]);
    });

    it("`pi-import` is the content import alone: the key, and staff tokens on a Pi", () => {
      const pi = routes.filter((r) => r.policy === "pi-import");
      expect(pi.map(key)).toEqual(["PUT /import/master"]);
      expect(pi[0].admitsServerKey).toBe(true);
      expect(pi[0].rolesRequired).toBe(true);
    });

    it("the routes that admit central's server key besides the imports are the 15 proxied reports, login time and the baseline results", () => {
      expect(routes.filter((r) => r.admitsServerKey && r.policy !== "server").map(key).sort()).toEqual([
        "GET /curriculum/:curriculumbaselineid/getstudentresult",
        "POST /report/student-grade-progress",
        "POST /report/student-lesson-progress",
        "POST /report/student-level-progress",
        "POST /report/studentlastcompletedquiz",
        "POST /report/studentlastcompletedquiz/download",
        "POST /report/studentlevelquiz",
        "POST /report/studentlevelquiz/class",
        "POST /report/studentlevelquiz/class/download",
        "POST /report/studentlevelquiz/download",
        "POST /report/studentprogress",
        "POST /report/studentprogress/class",
        "POST /report/studentprogress/class/download",
        "POST /report/studentprogress/download",
        "POST /report/studentstatus",
        "POST /report/studentstatus/download",
        "POST /student/logintime",
        "PUT /import/master",
      ]);
    });

    it("every route that names content or a scope has the guard that applies it", () => {
      const withGuard = (name: string) => routes.filter((r) => r.guards.some((g) => g.startsWith(name)));
      // every route that takes a content id in its path is behind a ContentAccessGuard
      const contentRoutes = routes.filter((r) => /:(curriculumid|gradeid|levelid|lessonid|lessonlearningid|lessonplanid|lessonpracticeid|lessonquizid|curriculumbaselineid)\b/.test(r.path));
      const unguarded = contentRoutes.filter((r) => !r.guards.some((g) => g.startsWith("ContentAccessGuard(")) && !r.guards.includes("ReportScopeGuard"));
      expect(unguarded.map(key)).toEqual([]);
      // every route central proxies has the report scope in front of it
      expect(withGuard("ReportScopeGuard").length).toBe(
        routes.filter((r) => r.path.startsWith("/report/")).length + 2, // + /student/logintime and the baseline results
      );
    });
  });

  describe("what the inventory cannot see", () => {
    it("the bootstrap (src/server.ts) sets no global prefix and enables no versioning", () => {
      const source = ts.createSourceFile(SERVER_FILE, readFileSync(SERVER_FILE, "utf8"), ts.ScriptTarget.ES2020, true);
      const calls: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const name = node.expression.name.text;
          if (name === "setGlobalPrefix" || name === "enableVersioning") calls.push(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(calls).toEqual([]);
    });

    it("the policy definitions in the decorator's doc comment match the data the document uses", () => {
      const source = readFileSync(DECORATOR_FILE, "utf8");
      // Only the doc comment: the same text also sits in ORG_POLICY_DEFINITIONS further down, which would satisfy the check by itself.
      const comment = source
        .slice(source.indexOf("The policies."), source.indexOf("Put it on the handler method"))
        .replace(/\s*\n\s*\*\s*/g, " ")
        .replace(/\s+/g, " ");
      for (const policy of ORG_POLICIES) {
        expect(comment).toContain(ORG_POLICY_DEFINITIONS[policy]);
      }
      expect(comment).toContain(ORG_POLICY_TIE_BREAK);
    });
  });

  describe("committed inventory document", () => {
    it("is up to date (regenerate with `npm run routes:policy -- --write`)", () => {
      expect(readFileSync(DOC_FILE, "utf8")).toBe(renderInventoryMarkdown(routes));
    });
  });
});

describe("route inventory checks (synthetic routes, to prove they can fail)", () => {
  const route = (over: Partial<RouteRecord>): RouteRecord => ({
    method: "GET",
    path: "/x",
    controller: "C",
    handler: "h",
    policy: "learner",
    note: undefined,
    guards: [],
    auth: "token",
    admitsServerKey: false,
    rolesRequired: false,
    enforcedBy: undefined,
    enforcedByProven: false,
    ...over,
  });

  it("reports a route with no policy", () => {
    expect(routesWithoutPolicy([route({ policy: undefined })])).toHaveLength(1);
    expect(routesWithoutPolicy([route({})])).toHaveLength(0);
  });

  it("reports an unknown policy value", () => {
    expect(routesWithUnknownPolicy([route({ policy: "everyone" })])).toHaveLength(1);
    expect(routesWithUnknownPolicy([route({ policy: "teacher" })])).toHaveLength(0);
  });

  it("reports two routes with the same method and path, but not different methods", () => {
    expect(duplicateRoutes([route({ handler: "a" }), route({ handler: "b" })])).toHaveLength(1);
    expect(duplicateRoutes([route({}), route({ method: "POST" })])).toHaveLength(0);
  });

  it("reports a module that carries RouterModule module-path metadata, and no other", () => {
    class Plain {}
    class Prefixed {}
    Reflect.defineMetadata(`${MODULE_PATH}some-application-id`, "/api", Prefixed);
    expect(modulesWithModulePath([Plain])).toEqual([]);
    expect(modulesWithModulePath([Plain, Prefixed])).toEqual(["Prefixed"]);
  });

  it("shows `n/a` for public routes, `yes` for proved ones and `pending` for the rest", () => {
    expect(enforcementState(route({ policy: "public", auth: "none" }))).toBe("n/a");
    expect(enforcementState(route({ policy: "learner" }))).toBe("pending");
    expect(enforcementState(route({ policy: "learner", enforcedBy: "x.spec.ts", enforcedByProven: false }))).toBe("pending");
    expect(enforcementState(route({ policy: "learner", enforcedBy: "x.spec.ts", enforcedByProven: true }))).toBe("yes");
    expect(pendingEnforcementLines([route({ policy: "teacher", enforcedBy: "x.spec.ts", enforcedByProven: true })])).toEqual([]);
  });

  it("marks a server-key route in the snapshot line", () => {
    expect(pendingEnforcementLines([route({ path: "/k", admitsServerKey: true })])).toEqual(["GET /k  learner+key"]);
    expect(policyLabel(route({}))).toBe("learner");
  });

  it("lists pending routes sorted, and leaves proved and public ones out", () => {
    const lines = pendingEnforcementLines([
      route({ path: "/b", policy: "teacher" }),
      route({ path: "/a", policy: "server" }),
      route({ path: "/c", policy: "learner", enforcedByProven: true }),
      route({ path: "/e", policy: "public", auth: "none" }),
    ]);
    expect(lines).toEqual(["GET /a  server", "GET /b  teacher"]);
  });

  it("flags a policy that its guards contradict", () => {
    expect(policyGuardViolations([route({ policy: "public", auth: "token" })], [])).toHaveLength(1);
    expect(policyGuardViolations([route({ policy: "public", auth: "none" })], [])).toEqual([]);
    expect(policyGuardViolations([route({ policy: "learner", auth: "none" })], [])).toHaveLength(2); // wrong guard, and unguarded
    expect(policyGuardViolations([route({ policy: "learner", rolesRequired: true })], [])).toHaveLength(1);
    expect(policyGuardViolations([route({ policy: "teacher", rolesRequired: false })], [])).toHaveLength(1);
    expect(policyGuardViolations([route({ policy: "teacher", rolesRequired: true })], [])).toEqual([]);
    expect(policyGuardViolations([route({ policy: "server", auth: "token" })], [])).toHaveLength(1);
    expect(policyGuardViolations([route({ policy: "server", auth: "server-key-only" })], [])).toEqual([]);
    expect(policyGuardViolations([route({ policy: "pi-import", admitsServerKey: true, rolesRequired: false })], [])).toHaveLength(1);
    expect(policyGuardViolations([route({ policy: "pi-import", admitsServerKey: true, rolesRequired: true })], [])).toEqual([]);
    // an unguarded route that is not public is flagged unless it is a named handler-authenticated one (which is then judged by its policy)
    expect(policyGuardViolations([route({ policy: "learner", auth: "none" })], ["GET /x"])).toHaveLength(1);
  });

  it("refuses to describe a mixin guard that has no descriptor, and describes the ones that have", () => {
    const stranger = mixin(class SomeOtherGuard {});
    expect(() => describeGuard(stranger)).toThrow(/guard descriptor/);
    expect(describeGuard(AccessGuard(TokenType.ACCESS))).toBe("AccessGuard(ACCESS)");
    expect(describeGuard(AccessGuard(TokenType.ACCESS, SchoolRole.TEACHER))).toBe("AccessGuard(ACCESS, Role.TEACHER)");
    expect(describeGuard(withGuardInfo(mixin(class Another {}), { label: "Another()" }))).toBe("Another()");
  });
});

describe("specProvesRoute (what makes a route count as proved)", () => {
  let root: string;
  const write = (name: string, text: string) => {
    mkdirSync(join(root, "specs"), { recursive: true });
    writeFileSync(join(root, "specs", name), text);
    return `specs/${name}`;
  };
  const proves = (source: string, routeKey = "PUT /user/:id") => {
    const file = write(`case-${Math.random().toString(36).slice(2)}.spec.ts`, source);
    return specProvesRoute(file, routeKey, root);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "route-inventory-"));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts a running test that has the route in its title and calls expect", () => {
    expect(proves(`describe("x", () => { it("PUT /user/:id is limited", () => { expect(1).toBe(1); }); });`)).toBe(true);
    expect(proves(`it("PUT /user/:id is limited", async () => { expect(await Promise.resolve(1)).toBe(1); });`)).toBe(true);
  });

  it("takes the route from the describe titles too, and from a test written with `test`", () => {
    expect(proves(`describe("PUT /user/:id", () => { test("is limited", () => { expect(1).toBe(1); }); });`)).toBe(true);
  });

  it("refuses a test that does not call expect itself (a helper's expect is not seen)", () => {
    expect(proves(`it("PUT /user/:id is limited", () => helper());`)).toBe(false);
    expect(proves(`it("PUT /user/:id is limited", async () => { await helper(); });`)).toBe(false);
  });

  it("refuses skipped, todo, focused and failing tests, and tests inside a describe that is", () => {
    for (const source of [
      `it.skip("PUT /user/:id", () => { expect(1).toBe(1); });`,
      `xit("PUT /user/:id", () => { expect(1).toBe(1); });`,
      `it.todo("PUT /user/:id");`,
      `it.only("PUT /user/:id", () => { expect(1).toBe(1); });`,
      `fit("PUT /user/:id", () => { expect(1).toBe(1); });`,
      `it.failing("PUT /user/:id", () => { expect(1).toBe(1); });`,
      `describe.skip("x", () => { it("PUT /user/:id", () => { expect(1).toBe(1); }); });`,
      `xdescribe("x", () => { it("PUT /user/:id", () => { expect(1).toBe(1); }); });`,
    ]) {
      expect(proves(source)).toBe(false);
    }
  });

  it("refuses a route that appears only in a comment, a variable or a longer path", () => {
    expect(proves(`// PUT /user/:id\nit("something else", () => { expect(1).toBe(1); });`)).toBe(false);
    expect(proves(`const route = "PUT /user/:id";\nit(route, () => { expect(1).toBe(1); });`)).toBe(false);
    expect(proves(`it("PUT /user/:id/extra is limited", () => { expect(1).toBe(1); });`)).toBe(false);
    expect(proves(`it("PUT /user is limited", () => { expect(1).toBe(1); });`)).toBe(false);
    expect(proves(`it("GET /user/:id is limited", () => { expect(1).toBe(1); });`)).toBe(false);
  });

  it("refuses a missing file, a file that is not a spec, an absolute path and a path that leaves the repository", () => {
    expect(specProvesRoute("specs/not-there.spec.ts", "PUT /user/:id", root)).toBe(false);
    write("plain.ts", `it("PUT /user/:id", () => { expect(1).toBe(1); });`);
    expect(specProvesRoute("specs/plain.ts", "PUT /user/:id", root)).toBe(false);
    expect(specProvesRoute(join(root, "specs", "plain.ts"), "PUT /user/:id", root)).toBe(false);
    expect(specProvesRoute("../outside.spec.ts", "PUT /user/:id", root)).toBe(false);
    expect(specProvesRoute(undefined, "PUT /user/:id", root)).toBe(false);
  });

  it("reads titles and expect calls from the syntax tree", () => {
    expect(specTests(`describe("a", () => { it("b", () => { expect(1).toBe(1); }); it("c", () => {}); });`)).toEqual([
      { title: "a b", hasExpect: true },
      { title: "a c", hasExpect: false },
    ]);
  });
});
