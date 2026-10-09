# EdTech LMS RPI API

This is the classroom half of the LMS. It runs on a Raspberry Pi, or any Linux box, on the school's own network, so students keep learning when the internet is down or was never there. Lessons, quizzes, student logins and progress all live here in a local MySQL database. Content arrives from the central API as a zip. Logs go back the same way.

Same stack as the central API: NestJS, Sequelize, MySQL, JWT.

For where this project came from, see [HISTORY.md](HISTORY.md).

## How it fits with the other repos

- [edtech-lms-api](https://github.com/edtech4good/edtech-lms-api) is the central, cloud-side API. It authors the content this one serves and ingests the logs this one exports.
- [edtech-expo](https://github.com/edtech4good/edtech-expo) is the student app. Its `EXPO_PUBLIC_BASE_URL` points here.
- [edtech-lms-rpi-report](https://github.com/edtech4good/edtech-lms-rpi-report) is an optional reporting API that can sit next to this one on the same network.

The routes that matter for sync:

- `PUT /import/master` takes the curriculum zip that the central API builds at `/sync/content` (one organisation's content). Online it accepts only the server sync key, which central's Sync Content sends as the raw `Authorization` header. On a classroom Pi (`RPI_OFFLINE=true`, or `"offline": true` in `FORTYKAPIRPICONFIG`) it also accepts an admin, superadmin or teacher token, so a teacher can carry the zip in on a tablet; that token must carry the organisation the zip is for. It takes one organisation's content (format 3) only: the old whole-content payload (format 2) is refused with a 400.
- `PUT /import/students` and `PUT /import/teachers` accept only the server sync key, online or on a Pi. Every learner and login in a roster must name a school this server has (by id, or by a name that resolves to one); a roster with a row that does not is refused with a 400 and nothing is written, so a school must be here (provisioned, or pushed with its organisation's content) before its roster.
- `PUT /import/ownership` takes a JSON map of which organisation owns each school and each curriculum, question, document and subject, plus the organisation rows. It accepts only the server sync key, online or on a Pi, and writes only `organisationid` and the `organisations` table: no deletes and no logins. A row that already has a different owner is reported, not changed. Since migration S4 every owner is required, so this route has nothing left to fill; it remains for databases that have not reached S4.
- `GET /export/log` returns a zip of the student log plus this server's log files, for upload to the central API at `/log/import`. That central route is off by default; it only runs when the central API is deployed with `LOG_IMPORT_ENABLED` set to `true` or `1`.
- `GET /export/report-data` does the same for the reporting API.

Students log in with `POST /auth/login`. One access token per user: a second login, including one from `curl`, ends the first session.

### Server-grading protocol

Practice, lesson-quiz, level-quiz and baseline submissions may carry an optional `answer: {v: 1, type, ...}` per item. The server grades it against the question (`src/business/grading`) and stores the raw answer, the client's own claimed verdict (`clientiscorrect`) and the server's grade (`servergrade`) alongside the existing `iscorrect`. A submission is `verified` only when every active, renderable question in the activity got a gradable server grade. A submission with no `answer` fields at all (an old client) is always accepted and stored unverified — never rejected.

Two env vars control behaviour, both optional and off by default:

| Setting | Default | Effect |
|---|---|---|
| `GRADING_MODE` | `shadow` | `shadow`: scoring uses the client's claimed `iscorrect` exactly as before; server grades are only recorded for comparison. `enforce`: a gradable server grade replaces the client's `iscorrect` for scoring (marks, percentage, pass, points). An ungradable item still falls back to the client's claim. |
| `REQUIRE_GRADED_ANSWERS` | off (`false`) | When on, an unverified quiz/level-quiz/baseline result can never count as a pass (`ispass=false`). Practice is never affected. Old-format results are still accepted, just unverified. |

Each submission logs one info-level line (no learner identifiers) with the count of client/server disagreements by template type, so the disagreement rate can be measured before flipping `GRADING_MODE` to `enforce`.

## What you need

- Node 20. The deploy image is `node:20-alpine`. Node 20 reached end of life in April 2026, so expect this to move to Node 22.
- MySQL 8.0
- A Raspberry Pi is optional. Development happens on a laptop.

## Running it locally

Create the database empty first. `utf8mb4` / `utf8mb4_unicode_ci` is recommended, for consistency with existing servers, but not required: every migration names the collation of the tables it creates, so a MySQL 8 default (`utf8mb4_0900_ai_ci`) migrates cleanly too.

```bash
npm install
cp env.example .env
npm run db:migrate
npm run start:dev
```

The API listens on port 3000 by default. Swagger is at `/docs`.

Configuration lives in `src/config.ts`. The deployed containers pass one JSON value in `FORTYKAPIRPICONFIG`. For local work the flat variables are enough:

```env
RPI_PORT=3001
RPI_DB_HOST=localhost
RPI_DB_PORT=3306
RPI_DB_NAME=edtech_lms_rpi
RPI_DB_USER=your-db-user
RPI_DB_PASSWORD=your-db-password
```

If the central API is already on 3000 on the same machine, run this one on 3001. The end-to-end tests in edtech-lms-ui expect it there.

## Seeding

Three scripts, each guarded by `ALLOW_DEMO_SEED=true` so nothing seeds production by accident:

```bash
# Demo student and teacher accounts
ALLOW_DEMO_SEED=true npm run seed:demo

# Synthetic demo content, same fixture IDs as the central API's seed:demo
ALLOW_DEMO_SEED=true npm run seed:content

# A real client curriculum, same fixture IDs as the central API's seed:dcrs
ALLOW_DEMO_SEED=true npm run seed:dcrs
```

The student app reads lessons from this API, not from the central one, so a local stack needs content in both databases. The seeds short-circuit the sync for development. They are not a substitute for it.

Every seeded school, piece of content, login and learner belongs to an organisation: the demo seeds to `edtech4good`, the DCRS seed to `miv` (the same codes and ids the central API's seeds use). Each seed creates the organisation it needs, so they run in any order, and a re-run fills an owner or school id that an older seed left empty.

## Setting up a classroom server (offline)

A school can run this code on a classroom server without ever touching the online system. `npm run build`, then `npm run provision -- --organisation "<name>" --code <code> --school "<name>" --country <country> --admin <username> [--content <payload>] [--apply]` creates the organisation, the school, the first logins and the content in one transaction, on this server's own database. It prints a plan and writes nothing until you add `--apply`, shows each new password once, and never uses the network. `scripts/provision/README.md` is the whole recipe, including a sample content payload and where the videos go.

## Scripts

- `npm run start:dev` runs Nest in watch mode.
- `npm run build` then `npm start` (or `npm run start:prod`, same thing) is the production path. The build lands in `build/` and both run `build/server.js`.
- `npm run db:migrate` runs the Sequelize migrations, which build the whole schema: tables, columns and indexes, so the server's first boot changes nothing. S4 makes the owner and school columns required and **refuses, changing nothing, while any row has none**.
- `npm run db:check-owners [-- --ids]` is the pre-flight for S4: it prints, per column, how many rows have no owner or school (with `--ids`, which), and exits 1 when any do. Run it before `db:migrate`.
- `scripts/ci/schema-drift.sh` is the schema-drift check (the `schema-drift` CI job). This server calls `sequelize.sync()` at boot, so a model that declares a table or index no migration creates would be created silently, on every server, at its first start. The script migrates an empty database, dumps `SHOW CREATE TABLE` for every table, boots the built server once (`RPI_OFFLINE=true`), dumps again and fails on any difference; it also runs `npm run db:check-indexes` and compares the models' columns with the database (sync never adds columns). Run it locally against a scratch database: `RPI_DB_NAME=scratch RPI_DB_USER=... RPI_DB_PASSWORD=... RPI_PORT=3013 scripts/ci/schema-drift.sh` (needs `npm run build` first and an empty database; create it with the server's default collation).
- `npm run provision -- …` provisions a classroom server (see above and `scripts/provision/README.md`).
- `npm run lint` and `npm run format` run ESLint and Prettier.

`npm test` prints "no test specified". There are no unit tests here. The Playwright suites in [edtech-lms-ui](https://github.com/edtech4good/edtech-lms-ui) cover this API, including a SQL injection suite that targets it directly.

## Layout

```
src/
├── business/       # Business logic
├── config/         # Config validation
├── db/             # Sequelize models and migrations
├── decorators/
├── filters/
├── guards/
├── interceptors/
├── middlewares/
├── models/
├── modules/        # Feature modules (auth, import, export, student, ...)
├── pipes/
├── provisioning/   # npm run provision: the first organisation, school and logins on a classroom server
├── services/
└── validators/
scripts/            # Seed scripts
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This repo and edtech-lms-api share a lot of code by copy rather than by package. Fixes to the central API often never make it here. If you fix something in one, check the other.

## License and support

AGPL-3.0-only, see [LICENSE](LICENSE) and [NOTICE.txt](NOTICE.txt) for the copyright history. In short: you may run, study, change and share this software, and if you run a modified version for others over a network you must offer them your modified source under the same licence. It was MIT-licensed before 22 September 2026; see NOTICE.txt. Questions and bugs go to [GitHub Issues](https://github.com/edtech4good/edtech-lms-rpi-api/issues).
