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
  organisation claim is refused on a classroom server as much as online: 401
  over HTTP (the strategy refuses the token before the controller runs); the
  controller's own 403 is defence in depth.
  `PUT /import/ownership` fills empty owners only (since S4 there are none; it
  remains for databases that have not reached S4).
- Seven columns are required (NOT NULL): `organisationid` on `schools`,
  `curriculums`, `questions`, `documents`, `subjects`, and `schoolid` on `students`
  and `schoolusers` (`src/db/required-columns.ts` is the one list, and the models
  say the same). The migration refuses, changing nothing, while any row has none;
  `npm run db:check-owners` is the operator's pre-flight. A writer refuses first:
  a roster row that names no school this server has is a 400 before anything is
  written (`withRequiredSchoolIds`), so a school must be here before its roster.
- `src/provisioning/` (run as `npm run provision`, recipe in
  `scripts/provision/README.md`) is how a fresh classroom server gets its first
  organisation, school and logins with no network and no central: one
  transaction, a dry run unless `--apply`, passwords shown once, a content
  payload re-homed to the local organisation (content ids kept) and imported by
  `OrganisationContentImport`. It refuses to run without `RPI_OFFLINE`, never
  reuses a code under another name, and never reads or writes anything online.
  The seeds (`scripts/seed-*.js`) put every school, content row, login and
  learner under an organisation (`scripts/lib/seed-organisations.js`).
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
- Every table a migration creates names `charset: "utf8mb4"` and `collate:
  "utf8mb4_unicode_ci"`, like the baseline tables: a table that takes the database
  default (`utf8mb4_0900_ai_ci` on a stock MySQL 8) cannot be the target of a
  foreign key to a baseline table. `src/db/migrations-name-their-collation.spec.ts`
  loads every migration and fails on one that forgets. A new database should still
  be created as `utf8mb4_unicode_ci` for consistency with existing servers; it is
  no longer required.
- A fresh database must migrate end to end with `npm run db:migrate` alone. A table
  that only `sequelize.sync()` creates gets a baseline migration (idempotent; see
  `20260818080000-create-sync-only-tables-baseline`), because a later migration may read it.

## Khmer text

Names are compared with trim + NFC + lower-case (`school-identity.ts`), never
by collation. Use a Khmer fixture in any spec about names and keep its marks.

## Sessions

One token per user: signing in anywhere evicts the previous session. Tests use
their own fixture accounts, never shared demo logins.

## Git

Branch from `origin/main`; `main` is protected (PR + CI). Squash merge; never
delete a branch that is the base of another PR.
