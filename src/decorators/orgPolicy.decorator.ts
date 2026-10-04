import { SetMetadata } from "@nestjs/common";

/**
 * The organisation policy of a route (docs/admin-organisations-schema.md §8,
 * "Filtering: explicit scoping plus a route inventory", in the platform's
 * workspace repository). Several organisations share this API, and a classroom
 * Pi runs the same code for one school, so every route handler states which of
 * these applies to it. Declaring a policy does not enforce it by itself: the
 * guards and query filters do, and the route inventory test (src/route-policy/
 * route-inventory.spec.ts) keeps the declarations complete.
 * docs/route-policy-inventory.md shows which routes are proved today.
 *
 * The policies. Each is a requirement on the routes that declare it:
 *
 *  - `public`    Has no AccessGuard; reachable without authentication (rate
 *                limiting is not authentication). Returns nothing
 *                organisation-owned except what the request itself proves or
 *                what is deliberately published before sign-in (school
 *                branding).
 *  - `learner`   Needs a signed-in school login. Acts only on the caller's own
 *                rows and on content in the learner's current enrolments that
 *                the token's organisation owns; other content answers as
 *                absent (404) and a submission writes nothing. A staff token
 *                that reaches the route is held to the school's curriculum
 *                list instead.
 *  - `teacher`   Needs a school staff token (teacher, admin or super admin).
 *                Returns only learners of the token's school and content in
 *                that school's curriculum list that the token's organisation
 *                owns. A route that central also calls with the server sync key
 *                is marked as such and is scoped by the organisation header
 *                central sends; the header `platform` is the unscoped view and
 *                no header is refused.
 *  - `server`    Authenticated only by central's server sync key. Carries no
 *                user; the organisation comes from the payload header, and a
 *                payload for another organisation's rows is refused.
 *  - `pi-import` The content import: central's server sync key online, and on a
 *                classroom Pi also a staff token. The organisation is the one
 *                in the payload header; on a Pi it must match the token's, and
 *                a token whose school has no organisation yet may send only
 *                content that gives that school its owner.
 *
 * A route used by both a user token and the server key is classified by its user path; the key path is recorded separately.
 *
 * Put it on the handler method, next to the other route decorators:
 *
 *     @OrgPolicy("teacher")
 *     @OrgPolicy("teacher", { note: "Lists only the token's school." })
 *     @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
 *
 * A `learner`, `teacher`, `server` or `pi-import` route counts as proved in the
 * inventory only when it names, with `enforcedBy`, a spec file (path from the
 * repository root) that exists and has a test that runs (not skipped, todo or
 * focused, and not inside a describe that is) with the route's `METHOD /path`
 * (as the inventory prints it, for example `GET /lesson/level/:levelid`) in its
 * full title (enclosing describe titles and its own) and a direct `expect(`
 * call in its body. A signpost, not proof. The spec is what proves the route
 * limits every read and write to the caller's organisation; a route without the
 * option, or naming a spec that does not mention it, stays pending.
 *
 * The optional `note` is a short reason where the choice is not obvious. State
 * what the route REQUIRES.
 */
export const ORG_POLICIES = ["public", "learner", "teacher", "server", "pi-import"] as const;

/**
 * The definitions above, as data, so the generated inventory document can
 * reuse them word for word. route-inventory.spec.ts checks that each one
 * still appears in the doc comment above, so the two cannot drift apart.
 */
export const ORG_POLICY_DEFINITIONS: Record<(typeof ORG_POLICIES)[number], string> = {
  public:
    "Has no AccessGuard; reachable without authentication (rate limiting is not authentication). Returns nothing organisation-owned except what the request itself proves or what is deliberately published before sign-in (school branding).",
  learner:
    "Needs a signed-in school login. Acts only on the caller's own rows and on content in the learner's current enrolments that the token's organisation owns; other content answers as absent (404) and a submission writes nothing. A staff token that reaches the route is held to the school's curriculum list instead.",
  teacher:
    "Needs a school staff token (teacher, admin or super admin). Returns only learners of the token's school and content in that school's curriculum list that the token's organisation owns. A route that central also calls with the server sync key is marked as such and is scoped by the organisation header central sends; the header `platform` is the unscoped view and no header is refused.",
  server:
    "Authenticated only by central's server sync key. Carries no user; the organisation comes from the payload header, and a payload for another organisation's rows is refused.",
  "pi-import":
    "The content import: central's server sync key online, and on a classroom Pi also a staff token. The organisation is the one in the payload header; on a Pi it must match the token's, and a token whose school has no organisation yet may send only content that gives that school its owner.",
};

export const ORG_POLICY_TIE_BREAK =
  "A route used by both a user token and the server key is classified by its user path; the key path is recorded separately.";

export type OrgPolicyName = (typeof ORG_POLICIES)[number];

export interface OrgPolicyOptions {
  note?: string;
  /** The spec file that proves the route is limited to the caller's organisation. */
  enforcedBy?: string;
}

export interface OrgPolicyMetadata {
  policy: OrgPolicyName;
  note?: string;
  enforcedBy?: string;
}

export const ORG_POLICY_KEY = "orgpolicy";

export const OrgPolicy = (policy: OrgPolicyName, options: OrgPolicyOptions = {}): MethodDecorator =>
  SetMetadata<string, OrgPolicyMetadata>(ORG_POLICY_KEY, {
    policy,
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.enforcedBy === undefined ? {} : { enforcedBy: options.enforcedBy }),
  });

/**
 * Reads the policy declared on a route handler. Takes the handler function
 * (`Controller.prototype.method`), so it works without a Nest execution
 * context. Returns `undefined` when the handler declares none. The value is
 * returned as stored, not validated: the inventory test checks it against
 * ORG_POLICIES.
 */
export const getOrgPolicy = (handler: (...args: never[]) => unknown): OrgPolicyMetadata | undefined =>
  Reflect.getMetadata(ORG_POLICY_KEY, handler) as OrgPolicyMetadata | undefined;
