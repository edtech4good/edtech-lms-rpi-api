import "reflect-metadata";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join, normalize } from "path";
import * as ts from "typescript";
import { Module, RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, MODULE_PATH, PATH_METADATA, VERSION_METADATA } from "@nestjs/common/constants";
import { addLeadingSlash } from "@nestjs/common/utils/shared.utils";
import { ApplicationConfig, DiscoveryModule, DiscoveryService, MetadataScanner, ModulesContainer, NestFactory } from "@nestjs/core";
import { RoutePathFactory } from "@nestjs/core/router/route-path-factory";
import { AppModule } from "src/app.module";
import { getOrgPolicy, ORG_POLICIES, ORG_POLICY_DEFINITIONS, ORG_POLICY_TIE_BREAK, OrgPolicyName } from "src/decorators/orgPolicy.decorator";
import { GuardInfo, guardInfoOf } from "src/guards/guard-info";

/**
 * The route inventory: every route the application registers, with the
 * organisation policy it declares (src/decorators/orgPolicy.decorator.ts) and
 * the guards it runs today. Used by route-inventory.spec.ts and by
 * scripts/route-policy-inventory.ts, so the test and the committed document
 * (docs/route-policy-inventory.md) come from the same enumeration.
 *
 * Enumeration is from the real wiring, not from a file glob: the application
 * context is built from AppModule, and the controllers are the ones Nest's own
 * DiscoveryService finds in the module graph. Method and path come from the
 * same metadata and the same RoutePathFactory Nest uses to register the route
 * with Express.
 *
 * No server is started and no database is opened: the application context is
 * created, read and closed.
 */

/**
 * "none": no authentication guard on the route. "server-key-only": the only
 * authentication is central's server sync key (a user token is refused).
 * "token": a user token is accepted (and the key too, when `admitsServerKey`).
 */
export type AuthKind = "none" | "token" | "server-key-only";

export interface RouteRecord {
  method: string;
  path: string;
  controller: string;
  handler: string;
  /** The declared policy, exactly as stored (may be undefined or invalid). */
  policy: string | undefined;
  note: string | undefined;
  /** Guards in the order Nest runs them (controller level, then handler), by their label. */
  guards: string[];
  auth: AuthKind;
  /** True when EVERY authentication guard on the route lets central's server sync key through. */
  admitsServerKey: boolean;
  /** True when an authentication guard on the route lists school roles, so only school staff pass it. */
  rolesRequired: boolean;
  /** The spec file a route names as proof (`@OrgPolicy(policy, { enforcedBy })`), as declared. */
  enforcedBy: string | undefined;
  /** True when that spec file exists under the repository and has this route's `METHOD /path` in a test's title (specProvesRoute). */
  enforcedByProven: boolean;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.ALL]: "ALL",
  [RequestMethod.OPTIONS]: "OPTIONS",
  [RequestMethod.HEAD]: "HEAD",
};

// eslint-disable-next-line @typescript-eslint/ban-types
type GuardRef = Function | object;

const UUID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A guard's label. Nest's mixin() renames a class to a random UUID, so a guard
 * factory attaches its own descriptor (src/guards/guard-info.ts). A guard that
 * is a random-named class with no descriptor is one the inventory cannot read:
 * say so rather than print a name that changes on every run.
 */
export const describeGuard = (guard: GuardRef): string => {
  const info = guardInfoOf(guard);
  if (info) {
    return info.label;
  }
  const name = typeof guard === "function" ? guard.name : (guard as object).constructor.name;
  if (UUID_NAME.test(name)) {
    throw new Error(
      "A mixin guard on a route has no guard descriptor, so the route inventory cannot read it. " +
        "Wrap the guard factory's result in withGuardInfo (see src/guards/guard-info.ts).",
    );
  }
  return name;
};

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const pathsOf = (value: string | string[]): string[] => asArray(value).map((p) => addLeadingSlash(p));

/** Builds the application context from AppModule and the discovery service. */
@Module({ imports: [AppModule, DiscoveryModule] })
class RouteInventoryRootModule {}

/**
 * Modules that carry Nest's RouterModule module-path metadata. Nest prepends
 * that path to every route of the module, which the inventory does not model.
 */
export const modulesWithModulePath = (modules: Array<{ name: string }>): string[] =>
  modules.filter((m) => Reflect.getMetadataKeys(m).some((k) => String(k).startsWith(MODULE_PATH))).map((m) => m.name);

const REPO_ROOT = join(__dirname, "..", "..");

/** A test found in a spec: its full title (enclosing describe titles, then its own) and whether its body calls `expect(`. */
export interface SpecTest {
  title: string;
  hasExpect: boolean;
}

type BlockKind = { block: "describe" | "test"; counts: boolean };

/**
 * What a call's callee is, in jest terms. `describe` and `it`/`test` count, with
 * their `.each(table)(...)` and `.concurrent` forms. Everything that stops a
 * test from running normally does not: `.skip`, `.todo`, `.only` (a focus
 * variant: it silences the other tests), `.failing`, and the `x` and `f`
 * prefixed names (`xit`, `xtest`, `xdescribe`, `fit`, `ftest`, `fdescribe`).
 */
const blockKind = (expr: ts.Expression): BlockKind | undefined => {
  if (ts.isIdentifier(expr)) {
    switch (expr.text) {
      case "describe":
        return { block: "describe", counts: true };
      case "it":
      case "test":
        return { block: "test", counts: true };
      case "xdescribe":
      case "fdescribe":
        return { block: "describe", counts: false };
      case "xit":
      case "xtest":
      case "fit":
      case "ftest":
        return { block: "test", counts: false };
      default:
        return undefined;
    }
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const base = blockKind(expr.expression);
    if (!base) return undefined;
    if (expr.name.text === "each" || expr.name.text === "concurrent") return base;
    if (["skip", "todo", "only", "failing"].includes(expr.name.text)) return { ...base, counts: false };
    return undefined;
  }
  if (ts.isCallExpression(expr)) {
    return blockKind(expr.expression); // describe.each(table)
  }
  return undefined;
};

/** Does this function body contain a call to `expect(` written in it (not one reached through a helper)? */
const callsExpect = (node: ts.Node): boolean => {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "expect") {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
};

/**
 * The tests in a spec's source that run normally, each with its full title and
 * whether its own body calls `expect(`. Read from the syntax tree, so a route
 * string in a comment, a variable or a describe title alone is not a test. A
 * test that is skipped, todo, focused or inside a describe that is, is left out.
 */
export const specTests = (source: string): SpecTest[] => {
  const file = ts.createSourceFile("spec.ts", source, ts.ScriptTarget.ES2020, true);
  const tests: SpecTest[] = [];
  const visit = (node: ts.Node, describes: string[], live: boolean) => {
    if (ts.isCallExpression(node)) {
      const kind = blockKind(node.expression);
      if (kind) {
        const first = node.arguments[0];
        const title = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : undefined;
        const fn = node.arguments.find((a): a is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        const stillLive = live && kind.counts;
        if (kind.block === "describe") {
          if (fn) visit(fn.body, title === undefined ? describes : [...describes, title], stillLive);
          return;
        }
        if (stillLive && title !== undefined) {
          tests.push({ title: [...describes, title].join(" "), hasExpect: fn ? callsExpect(fn.body) : false });
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, describes, live));
  };
  visit(file, [], true);
  return tests;
};

/**
 * Does the spec at `enforcedBy` (path from the repository root) exist, and does
 * a test in it that runs normally have `routeKey` in its full title (enclosing
 * describe titles plus its own) and call `expect(` in its own body?
 *
 * This is a signpost, not proof: it shows that a test naming the route exists
 * and asserts something. Whether those assertions are enough is shown by
 * mutation (break the scoping and watch the spec fail), which the inventory
 * cannot check.
 */
export const specProvesRoute = (enforcedBy: string | undefined, routeKey: string, root = REPO_ROOT): boolean => {
  if (!enforcedBy || isAbsolute(enforcedBy) || normalize(enforcedBy).startsWith("..") || !enforcedBy.endsWith(".spec.ts")) {
    return false;
  }
  const path = join(root, enforcedBy);
  if (!existsSync(path)) {
    return false;
  }
  // The route string must stand alone in the title: `POST /user` is not
  // mentioned by a title about `POST /user/create`.
  const mention = new RegExp(`(^|[^\\w/:.-])${routeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/:.-])`);
  return specTests(readFileSync(path, "utf8")).some((test) => test.hasExpect && mention.test(test.title));
};

export async function enumerateRoutes(): Promise<RouteRecord[]> {
  const app = await NestFactory.createApplicationContext(RouteInventoryRootModule, { logger: false });
  try {
    // The inventory rebuilds each path from the metadata alone, which is only
    // right with no global prefix and no versioning (src/server.ts is checked by the spec).
    const prefixed = modulesWithModulePath([...app.get(ModulesContainer).values()].map((m) => m.metatype as { name: string }));
    if (prefixed.length > 0) {
      throw new Error(`Module-path metadata (RouterModule) is set on ${prefixed.join(", ")}; its paths are prefixed, which the route inventory does not model.`);
    }

    const discovery = app.get(DiscoveryService);
    const scanner = new MetadataScanner();
    const pathFactory = new RoutePathFactory(new ApplicationConfig());
    const routes: RouteRecord[] = [];

    for (const wrapper of discovery.getControllers()) {
      const metatype = wrapper.metatype as { name: string; prototype: object };
      if (!metatype || !wrapper.instance) {
        throw new Error(
          `Controller ${wrapper.name ?? "(unnamed)"} has no ${metatype ? "instance (request-scoped or transient?)" : "class"}; the route inventory would skip its routes.`,
        );
      }
      if (Reflect.getMetadata(VERSION_METADATA, metatype) !== undefined) {
        throw new Error(`${metatype.name} uses versioning; the route inventory does not model it.`);
      }
      const controllerPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, metatype));
      const classGuards: GuardRef[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];

      scanner.scanFromPrototype(wrapper.instance as never, metatype.prototype, (name) => {
        const handlerFn = (metatype.prototype as Record<string, unknown>)[name] as (...args: never[]) => unknown;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handlerFn);
        if (methodPath === undefined) {
          return null; // a plain method, not a route
        }
        if (Reflect.getMetadata(VERSION_METADATA, handlerFn) !== undefined) {
          throw new Error(`${metatype.name}.${name} uses versioning; the route inventory does not model it.`);
        }
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handlerFn);
        const handlerGuards: GuardRef[] = Reflect.getMetadata(GUARDS_METADATA, handlerFn) ?? [];
        const guards = [...classGuards, ...handlerGuards];
        const infos: GuardInfo[] = guards.map((g) => guardInfoOf(g)).filter((i): i is GuardInfo => i !== undefined);
        const authGuards = infos.filter((i) => /^(AccessGuard|AccessOrServerSyncGuard|ServerSyncGuard)\(/.test(i.label));
        const keyOnly =
          authGuards.length > 0 && authGuards.every((i) => i.label.startsWith("ServerSyncGuard(") && (i.roles?.length ?? 0) === 0);
        const policy = getOrgPolicy(handlerFn);

        for (const ctrlPath of controllerPaths) {
          for (const mPath of pathsOf(methodPath)) {
            const paths = pathFactory.create(
              { ctrlPath, methodPath: mPath, methodVersion: undefined, controllerVersion: undefined } as never,
              requestMethod,
            );
            for (const path of paths) {
              const method = METHOD_NAMES[requestMethod] ?? String(requestMethod);
              routes.push({
                method,
                path,
                controller: metatype.name,
                handler: name,
                policy: policy?.policy,
                note: policy?.note,
                guards: guards.map(describeGuard),
                auth: authGuards.length === 0 ? "none" : keyOnly ? "server-key-only" : "token",
                admitsServerKey: authGuards.length > 0 && authGuards.every((i) => i.admitsServerKey === true),
                rolesRequired: authGuards.some((i) => (i.roles?.length ?? 0) > 0),
                enforcedBy: policy?.enforcedBy,
                enforcedByProven: policy?.policy !== "public" && specProvesRoute(policy?.enforcedBy, `${method} ${path}`),
              });
            }
          }
        }
        return null;
      });
    }
    return routes.sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.controller.localeCompare(b.controller) || a.handler.localeCompare(b.handler),
    );
  } finally {
    await app.close();
  }
}

export const POLICY_NAMES: readonly string[] = ORG_POLICIES;

export const isKnownPolicy = (policy: unknown): policy is OrgPolicyName => typeof policy === "string" && POLICY_NAMES.includes(policy);

/** Total routes and routes per policy, with undeclared ones under "(none)". */
export const countByPolicy = (routes: RouteRecord[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const name of POLICY_NAMES) {
    counts[name] = 0;
  }
  for (const route of routes) {
    const key = route.policy ?? "(none)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

/**
 * A `public` route has nothing to enforce here. Every other route is "pending" until it names, with
 * `enforcedBy`, a spec that has a running test with its `METHOD /path` in the title (see specProvesRoute).
 */
export const isPendingEnforcement = (route: RouteRecord): boolean => route.policy !== "public" && !route.enforcedByProven;

/**
 * `yes`: the route names a spec that proves it (`enforcedBy`). `n/a`: public routes, which nothing backs and
 * none is needed. `pending`: everything else.
 */
export type EnforcementState = "yes" | "n/a" | "pending";
export const enforcementState = (r: RouteRecord): EnforcementState => (isPendingEnforcement(r) ? "pending" : r.policy === "public" ? "n/a" : "yes");

/** Said in the generated document and in the snapshot header. */
export const PENDING_MEANING =
  "Pending refers only to the organisation boundary; every route keeps the authentication and role guards shown in the Guards column.";

const byCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The policy as written in the snapshot: `teacher`, or `teacher+key`. */
export const policyLabel = (r: RouteRecord): string => `${r.policy ?? "(none)"}${r.admitsServerKey ? "+key" : ""}`;

export const PENDING_SNAPSHOT_HEADER = [
  "# Routes whose organisation policy is declared but not yet proved by a spec.",
  "# Entries are removed as a route gets one (`enforcedBy` in its @OrgPolicy).",
  `# ${PENDING_MEANING}`,
  "# One route per line, sorted by path then method: METHOD /path  policy",
  "# `+key` marks a route whose guards also admit central's server sync key.",
  "# Generated: `npm run routes:policy -- --write`. Checked by route-inventory.spec.ts.",
];

/** The snapshot body, sorted, one `METHOD /path  policy` per line. */
export const pendingEnforcementLines = (routes: RouteRecord[]): string[] =>
  routes
    .filter(isPendingEnforcement)
    .map((r) => ({ key: `${r.path}\u0000${r.method}`, line: `${r.method} ${r.path}  ${policyLabel(r)}` }))
    .sort((a, b) => byCodeUnits(a.key, b.key))
    .map((x) => x.line);

export const renderPendingSnapshot = (routes: RouteRecord[]): string => [...PENDING_SNAPSHOT_HEADER, ...pendingEnforcementLines(routes)].join("\n") + "\n";

/** Parses a snapshot file back to its lines, ignoring comments and blanks. */
export const parsePendingSnapshot = (text: string): string[] => text.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"));

const cell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

export const INVENTORY_DOC_PATH = "docs/route-policy-inventory.md";

/**
 * The committed inventory document. Deterministic (no dates, no counts that
 * are not derived from the routes), so route-inventory.spec.ts can compare it
 * byte for byte with what is committed.
 */
export const renderInventoryMarkdown = (routes: RouteRecord[]): string => {
  const pending = routes.filter(isPendingEnforcement).length;
  const notApplicable = routes.filter((r) => enforcementState(r) === "n/a").length;
  const enforced = routes.length - pending - notApplicable;
  const withKey = routes.filter((r) => r.admitsServerKey);
  const ordered = [...routes].sort(
    (a, b) => byCodeUnits(a.controller, b.controller) || byCodeUnits(a.path, b.path) || byCodeUnits(a.method, b.method),
  );
  const lines: string[] = [
    "# Route policy inventory",
    "",
    "<!-- GENERATED FILE. Do not edit by hand. -->",
    "",
    "**Generated file.** It lists every route the application registers and the",
    "organisation policy each one declares with `@OrgPolicy`",
    "(`src/decorators/orgPolicy.decorator.ts`). Regenerate it with:",
    "",
    "```",
    "npm run routes:policy -- --write",
    "```",
    "",
    "`src/route-policy/route-inventory.spec.ts` fails when this file is out of",
    "date, and when a route has no policy.",
    "",
    "## Proved and pending",
    "",
    "A policy is a requirement on the routes that declare it. A route counts as",
    "proved (`yes`) only when it names, with `@OrgPolicy(policy, { enforcedBy })`, a",
    "spec file that exists and has the route's `METHOD /path` in the title of a test",
    "that runs and calls `expect(` (the **Proved by** column); `public` routes show",
    "`n/a`, because there is nothing to prove. That is a signpost: it shows that a",
    "test naming the route exists and asserts something; whether its assertions are",
    "sufficient is shown by mutation, not by the inventory. The pending routes are",
    "pinned in `src/route-policy/pending-enforcement.snapshot.txt`.",
    "",
    PENDING_MEANING,
    "",
    `Of **${routes.length}** routes, **${enforced}** are proved by a spec, **${notApplicable}** are not applicable (public) and **${pending}** are pending.`,
    "",
    "| Policy | Routes | Proved | Not applicable | Pending |",
    "|---|---|---|---|---|",
    ...POLICY_NAMES.map((p) => {
      const n = routes.filter((r) => r.policy === p);
      const count = (s: EnforcementState) => n.filter((r) => enforcementState(r) === s).length;
      return `| ${p} | ${n.length} | ${count("yes")} | ${count("n/a")} | ${count("pending")} |`;
    }),
    `| **all** | **${routes.length}** | **${enforced}** | **${notApplicable}** | **${pending}** |`,
    "",
    "## Policies",
    "",
    "Each policy states what a route that declares it must satisfy.",
    "",
    ...POLICY_NAMES.map((p) => `- \`${p}\`: ${ORG_POLICY_DEFINITIONS[p as OrgPolicyName]}`),
    "",
    ORG_POLICY_TIE_BREAK,
    "",
    "## Columns",
    "",
    "- **Proved**: `yes` when the route names a spec that proves it; `n/a` for `public` routes; `pending` otherwise.",
    "- **Proved by**: for a route that is proved, the spec file named by `enforcedBy`.",
    "- **Server key**: `yes` when every authentication guard on the route lets central's server sync key through, so a caller with no user gets in.",
    "- **Staff only**: `yes` when an authentication guard lists school roles (teacher, admin, super admin), so a learner's token is refused.",
    "",
    `Routes admitting the server key: ${withKey.length}.`,
    "",
    "## Routes",
    "",
    "| Method | Path | Handler | Policy | Proved | Proved by | Server key | Staff only | Guards | Note |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...ordered.map(
      (r) =>
        `| ${r.method} | \`${cell(r.path)}\` | ${r.controller}.${r.handler} | ${r.policy ?? "(none)"} | ${enforcementState(r)} | ${r.enforcedByProven ? `\`${r.enforcedBy}\`` : ""} | ${r.admitsServerKey ? "yes" : ""} | ${r.rolesRequired ? "yes" : ""} | ${cell(r.guards.join(", ") || "none")} | ${cell(r.note ?? "")} |`,
    ),
    "",
  ];
  return lines.join("\n");
};

const label = (r: RouteRecord): string => `${r.method} ${r.path} (${r.controller}.${r.handler})`;

/** Routes with no @OrgPolicy at all. */
export const routesWithoutPolicy = (routes: RouteRecord[]): string[] => routes.filter((r) => r.policy === undefined).map(label);

/** Routes whose declared policy is not one of ORG_POLICIES. */
export const routesWithUnknownPolicy = (routes: RouteRecord[]): string[] =>
  routes.filter((r) => r.policy !== undefined && !isKnownPolicy(r.policy)).map((r) => `${label(r)} declares ${JSON.stringify(r.policy)}`);

/** Method + path pairs that more than one handler resolves to. */
export const duplicateRoutes = (routes: RouteRecord[]): string[] => {
  const seen = new Map<string, RouteRecord[]>();
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    seen.set(key, [...(seen.get(key) ?? []), r]);
  }
  return [...seen.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => `${key}: ${list.map((r) => `${r.controller}.${r.handler}`).join(", ")}`);
};

const key = (r: RouteRecord): string => `${r.method} ${r.path}`;

/**
 * A policy against the guards the route really has:
 *  - `public`: no authentication guard (and no other route lacks one, but for the named
 *    handler-authenticated exceptions);
 *  - `server`: central's server sync key and nothing else;
 *  - `pi-import`: the sync key, plus staff tokens (roles listed) for the Pi;
 *  - `teacher`: a user token, and school staff roles required;
 *  - `learner`: a user token, no role required.
 */
export const policyGuardViolations = (routes: RouteRecord[], authenticatedInHandler: readonly string[]): string[] =>
  routes.flatMap((r) => {
    const why: string[] = [];
    switch (r.policy) {
      case "public":
        if (r.auth !== "none") why.push("is public but has an authentication guard");
        break;
      case "server":
        if (r.auth !== "server-key-only") why.push("is `server` but its guards are not the server key alone");
        break;
      case "pi-import":
        if (!(r.auth === "token" && r.admitsServerKey && r.rolesRequired)) why.push("is `pi-import` but does not admit both the server key and staff roles");
        break;
      case "teacher":
        if (!(r.auth === "token" && r.rolesRequired)) why.push("is `teacher` but does not require a school staff token");
        break;
      case "learner":
        if (!(r.auth === "token" && !r.rolesRequired)) why.push("is `learner` but requires a staff role, or no token");
        break;
      default:
        break;
    }
    if (r.auth === "none" && r.policy !== "public" && !authenticatedInHandler.includes(key(r))) {
      why.push("has no authentication guard and is not `public`");
    }
    return why.map((w) => `${key(r)}: ${w}`);
  });
