#!/usr/bin/env bash
# Schema drift check: a database built only by the migrations must be left exactly as it
# is by one boot of the server, and must satisfy what the models declare.
#
# This server calls sequelize.sync() at boot (src/server.ts; no alter, no force). On a
# database the migrations built, sync() should find nothing to do. If a model declares a
# table or an index that no migration creates, sync() quietly creates it at boot, on
# every server that is ever started, and nothing else would notice. This check makes
# that loud.
#
#   1. refuse a database that already has tables
#   2. npm run db:migrate on the empty database
#   3. dump SHOW CREATE TABLE for every table (sorted, AUTO_INCREMENT removed)
#   4. npm run db:check-indexes: a declared index no migration created (sync() would add
#      it), or one with other columns than declared (sync() would ignore it). Recorded,
#      not fatal yet, so the diff below also prints.
#   5. boot the built server once (node build/server.js, RPI_OFFLINE=true: no network),
#      wait for GET /, stop it
#   6. dump again; any difference means boot changed the schema (a table or index no
#      migration creates)
#   7. node scripts/ci/schema-drift.js columns: a column a model declares that is absent
#      (sync() never adds columns to an existing table, so the diff cannot see this)
#   8. npm run db:check-owners (trivially clean on an empty database)
#
# Exits 1 if any step failed. Needs a built tree (npm ci && npm run build) and a reachable
# MySQL 8. Run locally with the variables set explicitly. Do NOT point RPI_DB_NAME at a
# database you care about: step 1 refuses one that has tables, but the migrations and the
# server would write to it. Create the database as CI does, with the default collation
# of a stock MySQL 8 server (a local server may default to
# another one, e.g. utf8mb4_unicode_ci, and would hide a gap a stock server shows):
#   CREATE DATABASE scratch_db COLLATE utf8mb4_0900_ai_ci;
#
#   RPI_DB_HOST=127.0.0.1 RPI_DB_PORT=3306 RPI_DB_USER=... RPI_DB_PASSWORD=... \
#   RPI_DB_NAME=scratch_db RPI_PORT=3013 scripts/ci/schema-drift.sh
#
# Variables: RPI_DB_NAME, RPI_DB_USER, RPI_DB_PASSWORD (required); RPI_DB_HOST (127.0.0.1),
# RPI_DB_PORT (3306), RPI_PORT (3000), NODE_ENV (development: the production
# placeholder-secret guard is not the thing under test), BOOT_TIMEOUT seconds (60).
# Variables already in the environment win over a .env file.
set -euo pipefail

: "${RPI_DB_NAME:?RPI_DB_NAME is required}"
: "${RPI_DB_USER:?RPI_DB_USER is required}"
: "${RPI_DB_PASSWORD:?RPI_DB_PASSWORD is required}"
export RPI_DB_HOST="${RPI_DB_HOST:-127.0.0.1}" RPI_DB_PORT="${RPI_DB_PORT:-3306}"
export RPI_PORT="${RPI_PORT:-3000}" NODE_ENV="${NODE_ENV:-development}"
export RPI_OFFLINE=true
BOOT_TIMEOUT="${BOOT_TIMEOUT:-60}"
export RPI_DB_NAME RPI_DB_USER RPI_DB_PASSWORD

cd "$(dirname "$0")/../.."
# The app takes its database from FORTYKAPIRPICONFIG when that is set, which would bypass RPI_DB_NAME.
if [ -n "${FORTYKAPIRPICONFIG:-}" ] || { [ -f .env ] && grep -q '^FORTYKAPIRPICONFIG=' .env; }; then
  echo "FORTYKAPIRPICONFIG is set (environment or .env); it would override RPI_DB_NAME. Unset it for this check." >&2
  exit 2
fi
[ -f build/server.js ] || { echo "build/server.js is missing: run npm run build first" >&2; exit 2; }
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$RPI_PORT/"; then
  echo "something already answers on port $RPI_PORT; a stale server would be read as this boot. Free the port or set RPI_PORT." >&2
  exit 2
fi

WORK="$(mktemp -d)"
SERVER_PID=""
FAILED=0
stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    # This server's SIGTERM handler calls app.close() but never process.exit(), so the
    # process normally stays up; give it a grace period, then SIGKILL.
    for _ in $(seq 1 5); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 1; done
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "server (pid $SERVER_PID) still up 5s after SIGTERM; sending SIGKILL"
      kill -KILL "$SERVER_PID" 2>/dev/null || true
    fi
  fi
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}
trap 'stop_server; rm -rf "$WORK"' EXIT

echo "== checking $RPI_DB_NAME is empty"
node scripts/ci/schema-drift.js is-empty

echo "== migrating"
npm run db:migrate >"$WORK/migrate.log" 2>&1 || { tail -n 40 "$WORK/migrate.log"; echo "FAIL: db:migrate failed" >&2; exit 1; }
tail -n 3 "$WORK/migrate.log"
node scripts/ci/schema-drift.js dump "$WORK/before.sql"

echo "== npm run db:check-indexes (before the server's sync() can add anything)"
rc=0
npm run db:check-indexes >"$WORK/indexes.log" 2>&1 || rc=$?
if [ "$rc" -gt 1 ]; then
  # exit 1 is "drift"; anything else is a crash (connection, ts-node, ...): show the trace
  tail -n 40 "$WORK/indexes.log"
  echo "FAIL: db:check-indexes crashed (exit $rc)" >&2
  exit 1
elif [ "$rc" -eq 1 ]; then
  awk '/^(MISSING|COVERED|PRESENT WITH OTHER COLUMNS)/{p=1} /^$/{p=0} p' "$WORK/indexes.log"
  echo "FAIL: db:check-indexes reported drift (continuing so the boot diff prints too)" >&2
  FAILED=1
else
  grep -E '^(declared|MISSING|COVERED|PRESENT WITH OTHER COLUMNS)' "$WORK/indexes.log"
fi

echo "== booting the built server on port $RPI_PORT (RPI_OFFLINE=true)"
node build/server.js >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
ready=""
for _ in $(seq 1 "$BOOT_TIMEOUT"); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -n 40 "$WORK/server.log"; echo "FAIL: the server exited during boot" >&2; exit 1
  fi
  if curl -fs --max-time 2 -o /dev/null "http://127.0.0.1:$RPI_PORT/"; then ready=1; break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  tail -n 40 "$WORK/server.log"; echo "FAIL: GET / did not answer within ${BOOT_TIMEOUT}s" >&2; exit 1
fi
echo "server answered GET /"
stop_server

node scripts/ci/schema-drift.js dump "$WORK/after.sql"
echo "== diffing the schema before and after boot"
if ! diff -u "$WORK/before.sql" "$WORK/after.sql"; then
  echo "FAIL: booting the server changed the schema (diff above): a model declares a table or index no migration creates" >&2
  FAILED=1
fi

echo "== comparing the models' columns with the database"
node scripts/ci/schema-drift.js columns || { echo "FAIL: a model declares a column no migration creates" >&2; FAILED=1; }

echo "== npm run db:check-owners"
npm run db:check-owners || { echo "FAIL: db:check-owners reported rows without an owner" >&2; FAILED=1; }

if [ "$FAILED" -ne 0 ]; then
  echo "FAIL: schema-drift ($RPI_DB_NAME)" >&2
  exit 1
fi
echo "PASS: schema-drift: migrate, boot, empty diff, model columns present, no index missing ($RPI_DB_NAME)"
