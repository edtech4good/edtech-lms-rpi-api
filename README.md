# EdTech LMS RPI API

This is the classroom half of the LMS. It runs on a Raspberry Pi, or any Linux box, on the school's own network, so students keep learning when the internet is down or was never there. Lessons, quizzes, student logins and progress all live here in a local MySQL database. Content arrives from the central API as a zip. Logs go back the same way.

Same stack as the central API: NestJS, Sequelize, MySQL, JWT.

For where this project came from, see [HISTORY.md](HISTORY.md).

## How it fits with the other repos

- [edtech-lms-api](https://github.com/edtech4good/edtech-lms-api) is the central, cloud-side API. It authors the content this one serves and ingests the logs this one exports.
- [edtech-expo](https://github.com/edtech4good/edtech-expo) is the student app. Its `EXPO_PUBLIC_BASE_URL` points here.
- [edtech-lms-rpi-report](https://github.com/edtech4good/edtech-lms-rpi-report) is an optional reporting API that can sit next to this one on the same network.

The routes that matter for sync:

- `PUT /import/master` takes the curriculum zip that the central API builds at `/sync/content`. It needs a token with the admin, superadmin or teacher role.
- `GET /export/log` returns a zip of the student log plus this server's log files, for upload to the central API at `/log/import`.
- `GET /export/report-data` does the same for the reporting API.

Students log in with `POST /auth/login`. One access token per user: a second login, including one from `curl`, ends the first session.

## What you need

- Node 20. The deploy image is `node:20-alpine`. Node 20 reached end of life in April 2026, so expect this to move to Node 22.
- MySQL 8.0
- A Raspberry Pi is optional. Development happens on a laptop.

## Running it locally

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

## Scripts

- `npm run start:dev` runs Nest in watch mode.
- `npm run build` then `npm start` (or `npm run start:prod`, same thing) is the production path. The build lands in `build/` and both run `build/server.js`.
- `npm run db:migrate` runs the Sequelize migrations.
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
├── services/
└── validators/
scripts/            # Seed scripts
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This repo and edtech-lms-api share a lot of code by copy rather than by package. Fixes to the central API often never make it here. If you fix something in one, check the other.

## License and support

MIT, see [LICENSE](LICENSE). Questions and bugs go to [GitHub Issues](https://github.com/edtech4good/edtech-lms-rpi-api/issues).
