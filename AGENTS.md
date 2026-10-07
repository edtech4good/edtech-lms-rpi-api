# Working in this repository

The student API of an open-source learning platform (NestJS, Sequelize, MySQL,
TypeScript). It serves learners and teachers online, and the same code runs
offline on a classroom Raspberry Pi (`RPI_OFFLINE=true`). The central API
(edtech-lms-api) owns the data model and pushes content and rosters here.
**This repository is public.** Read this file before changing anything.

## What may never be committed here

- Credentials, keys, tokens, real hostnames, or `.env` contents.
- The name of any customer, school, organisation or person, including in
  fixtures, seed data, comments and commit messages. Invent names.
- A description of how a check could be got around. State the requirement,
  never the mechanism. Security findings go to the private tracker.

## Organisations: the boundary this code enforces

Several organisations' learners share one online server. A classroom server
holds one school. The rules, in `src/business/`:

- `token-claims.ts` — a learner or teacher token must carry `schoolid` and
  `organisationid`; a missing claim, a suspended or deleted organisation, a
  deleted school, or a school whose owner no longer matches → 401. There is no
  exception: a classroom server refuses a token with no organisation exactly as
  the online one does, and a login whose school has no organisation cannot
  sign in.
- `content-access.ts` — every content id resolves to its curriculum; a learner
  reaches only curricula they are currently enrolled in within their
  organisation, a teacher only their school's. Anything else answers exactly
  as a nonexistent id (404), and a result for it writes nothing.
- `report-scope.ts` — a server-key report call must carry `X-Organisation-Id`:
  an organisation id confines every learner query, the exact value `platform`
  is the unscoped view, anything else is 400. Learner filters in a body must
  be one id inside the scope.
- `organisation-content.business.ts` — `PUT /import/master` accepts a format-3
  payload (one organisation's content, with owners) as a scoped replace that
  never touches another organisation's or unowned rows. Anything that is not a
  format-3 payload (format 2 is retired) is a 400. A staff token with no
  organisation claim is a 403 there, on a classroom server as much as online.
  `PUT /import/ownership` fills empty owners only.
- Every route declares an `@OrgPolicy` (`public | learner | teacher | server |
  pi-import`). `npm run routes:policy -- --write` regenerates
  `docs/route-policy-inventory.md`; `route-inventory.spec.ts` fails on an
  undeclared route. All 83 routes are proved or public.
- Outward payloads keep their shape; a new column is kept out of every query by
  a default scope on its model and read only through a named scope.

## Tests and verification

- `npx jest --maxWorkers=2` (never the default). `npx tsc --noEmit -p
  tsconfig.build.json`. `npm run build`.
- **Prove a new assertion can fail** before trusting it.
- Compare whole bodies, assert id sets not counts, never a bare `toThrow()`,
  never mock the helper under test.
- Specs run on an in-memory fake of the models; a change to a join or a
  collation-sensitive comparison needs a note that it was not run on MySQL
  unless it was.
- Migrations: `up`/`down` in a transaction, idempotent, collation read from a
  real column (`src/db/migration-helpers.ts`). Deploy order and who must sign
  in again go in the PR.

## Khmer text

Names are compared with trim + NFC + lower-case (`school-identity.ts`), never
by collation. Use a Khmer fixture in any spec about names and keep its marks.

## Sessions

One token per user: signing in anywhere evicts the previous session. Tests use
their own fixture accounts, never shared demo logins.

## Git

Branch from `origin/main`; `main` is protected (PR + CI). Squash merge; never
delete a branch that is the base of another PR.
