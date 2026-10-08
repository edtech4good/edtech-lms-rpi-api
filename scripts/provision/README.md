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
- the country, when there is no `--content` to carry it and the server has none of that name;
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

# 3. Bring up the database (see "A new database" below; on an empty database this is the one command)
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
| `--country <id or name>` | A country id, or its name as the `countries` table (or the payload) has it. With **no** `--content`, a name the server does not have yet is **created** (a fresh server's `countries` table is empty); an id that is not there is refused. |
| `--admin <username>` | The first admin login (3 to 45 letters, digits, `.`, `-`, `_`). |
| `--teacher <username>` | Optional: a teacher login. |
| `--class "<name>"` | Optional: one class (`standards` row) in the school. |
| `--content <file>` | Optional: a format-3 payload, as a `.zip` (its first file) or a raw `.json`. |
| `--credentials-file <path>` | Optional: write the new passwords here instead of printing them. |
| `--database <name>` | Optional check: refuse unless this is the database the server is configured for. |
| `--replace-school` | Allow a different `--school` for an organisation that already has one here: the old school is marked deleted (see "One school per server"). |
| `--reset-password <login>` | Lost password: set a new one for that login of the school, and change nothing else (see "A lost password"). Takes only `--organisation`, `--code`, `--school`, `--credentials-file`, `--database` and `--apply`. |
| `--apply` | Write it. Without it, nothing is written. |
| `--i-know-this-is-online` | For tests: run on a server without `RPI_OFFLINE`. |

It refuses, writes nothing and exits non-zero when:

- `RPI_OFFLINE` is not set (this is a classroom-server tool), or `--database` is not the configured database;
- the payload is not format 3, or its rows carry mixed owners, or any other problem the HTTP import also refuses;
- the code is already used by an organisation with a **different name**, or that organisation is deleted or
  suspended;
- a school of the same name already exists in **another organisation**;
- the organisation already has **another school** here and `--replace-school` is not given (see "One school per server");
- a login name is already taken for another school, or with another role, or is disabled or deleted;
- the payload names content that already belongs to another organisation on this server;
- `--code` is not 2 to 16 lower-case letters and digits, or the country is not found (and cannot be created: see `--country`).

After writing, and before committing, it checks in the same transaction that the organisation is there once and
active, that the school is live and owned by it and is the organisation's **only** live school (another school that
was live is only ever marked deleted with `--replace-school`), that every class the school had is still there, that
every login is in the school with the right role, and that no row of the payload is missing or has another owner. It
prints counts only. Any failure rolls everything back.

### Running it again

It is idempotent. The organisation is found by its code (same name: reused), the school by its name in that
organisation, the class by its name in the school, the logins by their names. Nothing new is created and **no
password is shown or changed** for a login that exists. A school or login that is found is never renamed: a name
that differs only in letter case finds the same one, and its stored name is the one used.

**Classes survive a re-run, with or without `--class`.** The content import replaces the classes of the school in the
payload, so the command puts every class the school already has (deleted ones too, with their ids and creation dates)
into the payload with it, plus the class you ask for if it is new. The content import also replaces the organisation's
content with the payload's, as it always does. So the plan prints, before anything is written, what the import would
take away: the organisation's questions, documents and subjects that the payload does not have are **deleted**, and its
curricula and schools that the payload does not have are **marked deleted**. If you give a smaller payload than last time, read that
list first. Rows it writes again keep their ids and values; the audit column `updated_at` of the `standards` and
`subjects` rows it re-creates is refreshed, and nothing else changes.

## One school per server

A classroom server holds one school. The content import marks every other school of the organisation as deleted, and
the logins of a deleted school can no longer sign in. So a second `--school` for an organisation that already has one
is **refused** (a typo in the name would otherwise lock out the first school's staff). To replace the school on purpose,
add `--replace-school`: the old school is marked deleted and the new one is created. **To bring a deleted school back,
run the command again with its name**: it is un-deleted (and, if another school is live, that one needs
`--replace-school` to be marked deleted in turn). No SQL is ever needed.

## A lost password

The passwords are shown once and kept nowhere, so if the admin's is lost:

```bash
npm run provision -- --organisation "<name>" --code <code> --school "<name>" --reset-password <login> [--credentials-file <path>] --apply
```

It sets a new random password for that login of this school (shown once, or written to the credentials file) and
ends that login's session; it changes nothing else, and it refuses a login that is not in this school. It works for
**any** login of the school, a learner's included, not only the staff logins this command made, and it checks that
exactly one row changed. Without
`--apply` it prints what it would do.

## A new database

Create the database empty. The character set `utf8mb4` and the collation `utf8mb4_unicode_ci` are recommended, to
match existing servers (`CREATE DATABASE <name> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`), but they are no
longer required: every migration names the collation of the tables it creates, so a database whose default is MySQL 8's
`utf8mb4_0900_ai_ci` migrates to the same tables. Then run `npm run db:migrate` once. It builds every table,
including the four that only the server's own start-up used to create (`studentprogressquestions`,
`lessonpracticequestions`, `lessonquizquestions`, `tokens`: migration
`20260818080000-create-sync-only-tables-baseline`), and finishes in that one run; there is nothing to start first.

```bash
npm run db:migrate
```

An existing server's database has those tables already: the migration notices, changes nothing and is only recorded.

## Signing in

`POST /auth/login` with `{"studentusername": "<login>", "studentpassword": "<its password>"}`. The token carries
the school and the organisation the command created, and the staff routes that take a staff token (the report,
curriculum and student lists, and `PUT /import/master` for the organisation's own content) accept it.

## Learners: not yet

Be clear about what a freshly provisioned classroom server has: one organisation, one school, its staff logins and its
content. **It has no learners.** Today they can only arrive through `PUT /import/students` (a roster file, in the
format central exports), and that route takes the server's sync key, not a login; there is no admin screen on a
classroom server, and `npm run provision` does not create learners. A `--learners <csv>` option, so that an offline
school can add its own learners with no roster from central, is a follow-up and is **not built yet**.

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

**Countries are re-homed by name.** A country name is unique on a server, so if the payload's country has the same name
as one this server already has under another id (the one a no-`--content` run created, say), the payload's row is
replaced by this server's, and every reference to the payload's id is rewritten to it. One row, no collision.
A country that is **deleted** here is brought back (with or without `--content`): a country is a shared reference row
and a classroom server has no screen that deletes one. The plan says "revive" and counts the countries it re-homed.

(`PUT /import/master` over HTTP has no such step: a payload whose country has the same name as a local country under
another id updates the local row, and a school pointing at the payload's id would dangle, because the import runs with
foreign-key checks off. That is a follow-up for the import itself.)

**Content ids are not changed**, so a later join to central can recognise the same curriculum, lesson or question.
The payload is checked before and after: every row of the re-homed payload must have the local owner.

## Videos and other media

The content payload names media files (`documents.documentname`, for a video `documenttypeid` 2) but carries no
file, and the question options that are pictures name image files too (`questions.questionoptions`, the shapes in the
sample such as `triangle.png`, `square.png`, `circle.png` and the story pictures): those need to be present at the
same resource base as the videos, or the picture questions show empty boxes. The app fetches each file by URL from the resource base the client was built with
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
