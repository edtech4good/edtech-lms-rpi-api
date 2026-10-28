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
  A learning is a typed item (`lessonlearningtype`, `video` is the only type this server
  knows; `src/constants/learning-items.ts`) and the payload must carry `lessonlearningdocuments`
  (the item's further documents, empty today): a payload without that key, such as one exported
  before learning items, is refused.
  A `video` item must name a VIDEO document (`documenttypeid` 2) of the payload. A `documents` row may carry
  `documenttitle`, `documentlicence` (a closed list in `src/constants/media-library.ts`; never null; the
  default is `unspecified`) and `documentattribution` (a versioned object): each is checked when the row has
  the key, and an older export without them is still accepted. `documentname` stays the storage key.
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
- Translations of content text (bilingual content). `contenttranslations` holds one row per translated text of a content
  row: `(tablename, rowid)` names the row (polymorphic, no foreign key), `field` the text, `subkey` (up to 64 characters) the option, matching
  partner or distractor id or the feedback message key (`''`, never NULL, for a field with none: MySQL treats NULLs in a
  unique key as distinct), `language` (kept as its primary subtag in lower case: `KM` is stored `km`), `text`, `sourcehash` (the sha-256 hex of the UTF-8 base text it translated) and
  `lastupdated`; unique over table, row, field, subkey and language; hard-deleted. `organisations.contentlanguage` is the
  organisation's base language (null = no translations yet); the content columns keep that language's text. Allow-lists
  (`src/constants/content-translations.ts`): curriculums, grades, levels, lessons, lessonlearnings, lessonpractices,
  lessonquizzes, lessonplans (name and description), and questions (`questiontext`, `headingtext`, `questionoptiontext`,
  `questionassociatetext`, `questiondistractortext`, `feedback`; the last four need a subkey). The payload key
  `contenttranslations` is the LAST key, owned, with a polymorphic parent: the validator REFUSES a row whose parent is not
  a row of the payload, whose table or field is not on the list, whose language is the organisation's own, a row of any
  kind when the payload's organisation row has no `contentlanguage`, a row with a `lastupdated` that is not a date (it is
  required here; the other owned tables default it in the database, so central must send it), a row that repeats the
  table, row, field, subkey and language of another organisation's translation here (it would take that row over), and a
  field an answer is graded by (template 21's `questiontext` and `questionoptiontext`, and the `questiontext` of
  fill-in-the-blank (8) and of template 23); central DROPS a dangling row where this side refuses. Like `lessonlearningdocuments` the key is required, so a payload from
  before translations is refused: this API ships first and central straight after, with no Sync Content between.
  `organisations[0].contentlanguage` is optional (it is on the `organisation` row shared with `PUT /import/ownership`), but
  translations need it. Provisioning (`src/provisioning/`) carries the payload's `contentlanguage` to the local organisation
  (new or reused; a reused one keeps its own when the payload has none).
  Reads: only when the request carries `X-Content-Translations: 1` (`CONTENT_TRANSLATIONS_HEADER`, in `CORS_ALLOWED_HEADERS`),
  every content row of the routes the app reads gains `translations` and the response root `contentlanguage`
  (`src/business/content-translations.ts`, one query per table, the token's organisation only); a translation whose
  `sourcehash` is not the hash of the row's base text now is left out, and so is one in the organisation's own
  `contentlanguage` (it may have been changed after the row was stored). A token with no organisation gets an undecorated
  response (no `translations`, no `contentlanguage`), not `{}`. Without the header the answers are byte-identical
  (`content-routes.snapshot.spec.ts`, snapshots taken from `main`).
- Every route declares an `@OrgPolicy` (`public | learner | teacher | server |
  pi-import`). `npm run routes:policy -- --write` regenerates
  `docs/route-policy-inventory.md`; `route-inventory.spec.ts` fails on an
  undeclared route. All 83 routes are proved or public.
- Outward payloads keep their shape; a new column is kept out of every query by
  a default scope on its model and read only through a named scope.
- A request header a browser client sends to this API (the learner app's
  `X-Learning-Item-Types` and `X-Content-Translations`) must be listed in `src/cors-options.ts`, or the browser's
  preflight refuses every request that carries it; `src/cors-options.spec.ts` pins the list.

## Client address

The address a login stores (`rpiuseraccess.ipaddress`) is `req.ip` (`@Ip()`), the value the login throttler keys on. It is
the socket address unless the deployment sets `TRUST_PROXY` (`server.ts`); nothing else supplies it.
`login-ip.e2e.spec.ts` pins this with and without a trusted proxy.

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
- A migration-built database must be complete: the server's first boot (`sequelize.sync()`) must find
  nothing to alter. An index a model declares (`indexes:`) therefore needs a migration that creates it with
  the same name and columns (`20261008130000-indexes-sync-created`). The check: `SHOW CREATE TABLE` for every
  table after `db:migrate`, again after one boot; the two must be identical.
  The `schema-drift` CI job automates that: `scripts/ci/schema-drift.sh` migrates an empty database,
  boots the built server once and fails if the schema changed; it also runs
  `npm run db:check-indexes` and compares model columns with the database (sync never
  adds columns). A new table, column or index in a model needs a migration in the same
  PR. Run it against a scratch database: see the header of the script.
- Fifteen columns are foreign keys in the database (`20261026120000-foreign-keys-and-not-nulls`, list in
  `src/db/foreign-keys.ts`; ON DELETE RESTRICT, ON UPDATE CASCADE) and the six `studentpoints` totals are NOT NULL.
  The models declare only some of these references (`initModels` declares 25, and `setuprelationshipforreport`, called
  at every boot, adds 8 more `belongsTo`, six of them on this migration's columns); the list is the database's. A writer of one of those columns
  refuses first, with a message, before it writes (`PUT /import/students` checks the class of every learner and the
  content and learner of every progress row, `assertRosterClassesKnown` / `assertRosterProgressKnown` in
  `src/business/roster-refs.ts`; the first usage row checks its login), so the database's own refusal is never the
  answer. Content-path result routes already answer content that is not here with a 404 (`ContentAccessGuard`) before
  they write. While the keys exist, undoing `20261008130000-indexes-sync-created` on its own fails
  partway through with ERROR 1553 (its single-column indexes are the ones the keys use, and its down() runs table by
  table, so the tables before the failing one are already undone), leaving a half-undone schema; undo in order.

## Khmer text

Names are compared with trim + NFC + lower-case (`school-identity.ts`), never
by collation. Use a Khmer fixture in any spec about names and keep its marks.

## Sessions

One token per user: signing in anywhere evicts the previous session. Tests use
their own fixture accounts, never shared demo logins.

## Git

Branch from `origin/main`; `main` is protected (PR + CI). Squash merge; never
delete a branch that is the base of another PR.
