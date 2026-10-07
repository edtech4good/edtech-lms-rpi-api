# Provisioning a classroom server, offline

A school can download this code, deploy it on a classroom server (a Raspberry Pi and a router), and run it
**without ever touching the online system**. This folder is the whole recipe: the command that sets the server up,
a sample content payload to try it with, and how to make your own.

What the command **never** does: it does not use the network, it does not call central, and it sends nothing
anywhere. It writes to this server's own database and prints (or saves) what it created. The ids it mints are
this server's own.

## What a fresh server needs

A fresh classroom server has no organisation, no school and no login. A login whose school has no organisation
cannot sign in (`src/business/token-claims.ts`), and a classroom server has no way to create the first one over
HTTP, so there would be no way in. `npm run provision` is that way in, run locally by whoever sets the server up.

It creates, in **one database transaction**:

- the organisation (a new UUID and the code you give);
- the school (a new UUID, owned by that organisation), and one class if you ask for one;
- the first staff logins: an **admin** (`schooluserrole` 2) and, if you ask, a **teacher** (3), each with a random
  password (the role numbers are `SchoolRole` in `src/models/enums/school.role.enum.ts`);
- and, with `--content`, the organisation's content, imported by the same code `PUT /import/master` runs.

## The recipe

You need Node 22, MySQL 8, and this code on the server (copy it on an SD card or USB stick; nothing here needs
the internet once `npm ci` has run).

```bash
# 1. Install and build (the build is what `npm start` runs, and what the command below uses)
npm ci
npm run build

# 2. Configure the server in .env (or FORTYKAPIRPICONFIG). A classroom server sets RPI_OFFLINE=true and its own
#    secrets; see env.example. The command reads the same configuration the server does.
#      RPI_OFFLINE=true
#      RPI_DB_NAME=…  RPI_DB_USER=…  RPI_DB_PASSWORD=…  RPI_DB_HOST=…
#      RPI_APPLICATION_SECRET=…  RPI_SERVER_SYNC_KEY=…

# 3. Bring up the database (see "A new database" below: on an empty database this takes three steps)
npm run db:migrate

# 4. Look first: with no --apply it prints the plan and writes nothing
npm run provision -- \
  --organisation "Riverside Learning Network" --code riverside \
  --school "Riverside Primary" --country Cambodia \
  --admin river.admin --teacher river.teacher --class "Class 3A" \
  --content scripts/provision/sample-content.json

# 5. Then do it
npm run provision -- (the same arguments) --apply
```

`--apply` shows each new login's password **once**, at the end. It is not stored anywhere and cannot be shown
again. To keep it out of the terminal, add `--credentials-file <path>`: the passwords are written there instead
(mode 0600, the file must not exist yet), one `role<TAB>username<TAB>password` line each, and are not printed.

### Arguments

| Argument | |
|---|---|
| `--organisation "<name>"` | The organisation's name. |
| `--code <code>` | Its code: 2 to 16 lower-case letters and digits (the rule `src/modules/import/ownership.request.validator.ts` applies, which is central's rule). |
| `--school "<name>"` | The school's name (at most 45 characters). |
| `--country <id or name>` | A country id, or its name as the `countries` table (or the payload) has it. |
| `--admin <username>` | The first admin login (3 to 45 letters, digits, `.`, `-`, `_`). |
| `--teacher <username>` | Optional: a teacher login. |
| `--class "<name>"` | Optional: one class (`standards` row) in the school. |
| `--content <file>` | Optional: a format-3 payload, as a `.zip` (its first file) or a raw `.json`. |
| `--credentials-file <path>` | Optional: write the new passwords here instead of printing them. |
| `--database <name>` | Optional check: refuse unless this is the database the server is configured for. |
| `--apply` | Write it. Without it, nothing is written. |
| `--i-know-this-is-online` | For tests: run on a server without `RPI_OFFLINE`. |

It refuses, writes nothing and exits non-zero when:

- `RPI_OFFLINE` is not set (this is a classroom-server tool), or `--database` is not the configured database;
- the payload is not format 3, or its rows carry mixed owners, or any other problem the HTTP import also refuses;
- the code is already used by an organisation with a **different name**, or that organisation is deleted or
  suspended;
- a school of the same name already exists in **another organisation**;
- a login name is already taken for another school, or with another role, or is disabled or deleted;
- the payload names content that already belongs to another organisation on this server;
- `--code` is not 2 to 16 lower-case letters and digits, or the country is not found.

After writing, and before committing, it checks in the same transaction that the organisation is there once and
active, that the school is live and owned by it, that every login is in the school with the right role, and that
no row of the payload is missing or has another owner. It prints counts only. Any failure rolls everything back.

### Running it again

It is idempotent. The organisation is found by its code (same name: reused), the school by its name in that
organisation, the class by its name in the school, the logins by their names. Nothing new is created and **no
password is shown or changed** for a login that exists. The content import replaces the organisation's content with
the payload's, as it always does, so the rows it writes again keep their ids and values; the two audit columns
(`created_at`, `updated_at`) of the rows of `standards` and `subjects` it re-creates are refreshed, and nothing else
changes.

## A new database

On an **empty** database, `npm run db:migrate` stops at
`20260818090000-unique-studentprogress-submission` with `Table '…studentprogressquestions' doesn't exist`: that
table is created by the server's own start-up (`sequelize.sync()`), not by a migration. So:

```bash
npm run db:migrate      # stops at that migration on a new database
npm start               # run once, wait for "Application is running", then stop it (Ctrl-C)
npm run db:migrate      # finishes
```

An existing server's database has the table already and migrates in one go.

## Signing in

`POST /auth/login` with `{"studentusername": "<login>", "studentpassword": "<its password>"}`. The token carries
the school and the organisation the command created. Staff tools (the teacher app, the import and export routes)
use that token.

## What the content payload is, and what the command does to it

A format-3 payload is **one organisation's content** as central exports it (`GET /sync/content`): its curricula,
questions, documents and subjects with their owners, and the rows that hang from them. It carries central's
organisation id and code. A classroom server has its own organisation, so before importing, the command
**re-homes** the payload:

- rewrites the header's `organisationid` and `organisationcode`, and the one `organisations` row, to the local
  organisation's;
- rewrites the `organisationid` of every owned row (`curriculums`, `questions`, `documents`, `subjects`);
- **replaces the payload's `schools` by the local school**, which lists every curriculum of the payload (that is how
  a teacher reaches them), and **drops the payload's `standards`** (they hang from schools that are no longer
  there; the local class, if you gave one, is the only class). A classroom server holds one school, and the
  import replaces an organisation's schools as a whole (a school the payload does not have is marked deleted), so
  the school and class go into the payload rather than beside it;
- gives a curriculum baseline that named schools the local school;
- adds the school's country to the payload if it does not carry it.

**Content ids are not changed**, so a later join to central can recognise the same curriculum, lesson or question.
The payload is checked before and after: every row of the re-homed payload must have the local owner.

## Videos and other media

The content payload names media files (`documents.documentname`, for a video `documenttypeid` 2) but carries no
file. The app fetches each file by URL from the resource base the client was built with
(`EXPO_PUBLIC_RESOURCE_URL` plus the file name) and caches it; see the project's storage notes ("Making object
storage optional": the local option is a media folder that a web server serves at the resource base) and the Pi
section of its runbook, which still marks the classroom network and media host as open. So: copy the videos onto
the SD card (or the disk), serve that folder at the resource base the classroom devices are built with, and use the
file names the payload's `documents` rows give. The sample's two documents name `demo/counting-to-ten.mp4` and
`demo/reading-simple-words.mp4`, and say `"media": "absent"`: they play nothing until those files exist.

## The sample payload

`sample-content.json` is the demo organisation's content (one curriculum, two lessons, eight questions, two
documents, one subject) with demo names only: a try-out for a fresh server. It is **generated, not hand-written**:
it is what a local central exports for the demo organisation, saved as JSON.

To regenerate it (this is the only step that touches central, once, on your machine, not on the classroom server):

```bash
# in a checkout of the central API (edtech-lms-api), with a scratch database
npm ci && npm run build
npm run db:migrate
ALLOW_LOCAL_DEV_SEED=true npm run seed:local     # the local platform account and the organisations
ALLOW_DEMO_SEED=true npm run seed:demo           # the demo content
PORT=3011 npm start &                            # a local central

# then, in this repository
CENTRAL_URL=http://127.0.0.1:3011 CENTRAL_USER=<the local platform account> CENTRAL_PASSWORD=<its password> \
  node scripts/provision/export-from-central.js a0000000-0000-4000-8000-000000000001 \
  scripts/provision/sample-content.json
```

`export-from-central.js` signs in, switches to the organisation (`POST /auth/organisation`), downloads
`GET /sync/content`, takes the file out of the zip and writes it pretty-printed. (`a0000000-…-0001` is the
`edtech4good` demo organisation of the local seeds; the local account and its password are in the central
repository's `scripts/seed-local-dev.js`.) The payload's audit timestamps are from the run that made it.
`src/provisioning/payload.spec.ts` checks that the sample is a valid format-3 payload and that it holds demo names
only.

## Where the code is

- `scripts/provision.js` is the entry point (`npm run provision`); it runs the compiled `build/provisioning/`.
- `src/provisioning/` is the logic: `args.ts` (the arguments), `payload.ts` (reading and re-homing),
  `provision.ts` (the plan, the transaction, the checks), `cli.ts` (the output). It uses the server's own models,
  its password hashing (`src/services/password.service.ts`) and `OrganisationContentImport`.
