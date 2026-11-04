/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * One-off: bring existing learners into line after an organisation switches `requireLessonQuizPass` on.
 *
 * Before the rule, a FAILED lesson quiz attempt was saved holding the quiz's full points, and those points sit in the
 * learner's lesson, level and grade rows, so a lesson can show completed with no pass. For one organisation this script
 *   - sets the points of the non-passing attempts of every lesson quiz to 0 (practice, level quiz and baseline rows are
 *     never read for this);
 *   - for a quiz with no pass, takes the credit the app currently counts (the newest attempt's points) off the lesson, as
 *     far as it counted there (a lesson holds at most its total_points), and takes what the lesson lost off its level and
 *     grade, never below 0;
 *   - recomputes progress and completed on the rows it changed with the app's own rules (build/business/progress-rules.js)
 *     and sets their lastupdated, as the app does for a change (the export to the central server sends rows by lastupdated);
 *   - leaves a pass row, an attempt's percentage, ispass, verified and stars (scores, added_completed_scores), the daily
 *     point history (studentpoints), other organisations and the content alone. A quiz whose only pass rows are not counted
 *     (see below), or whose lesson, level or grade is missing or has a total that gives no percentage, is left alone.
 * The organisation's setting must already be strictly true, and the build must contain the rule; otherwise it refuses
 * and changes nothing. The organisation code is matched exactly, and a deleted organisation is refused.
 *
 * Usage (counts only are printed; never a name, id, email or question):
 *   node scripts/recalc-lesson-quiz-points.js --org <code>                          dry run, writes nothing
 *   node scripts/recalc-lesson-quiz-points.js --org <code> --apply --api-stopped    writes
 * Exit code 0 done, 1 refused, 2 some learners failed or the connection was lost (each learner is one transaction; rerun
 * to retry). Running it twice with --apply changes nothing the second time, and says so.
 *
 * THE DRY RUN IS SAFE WITH THE STUDENT API RUNNING. --apply IS NOT: it is only for a stopped student API, and refuses
 * without --api-stopped. The API reads a learner's points and totals before it writes them, outside any lock this script
 * can take, so a submission that arrives while a learner is being rewritten can leave that learner's totals wrong, and
 * running the script again does not repair it (the attempts are already at 0, so it finds nothing to change).
 * On a server run from the deploy folder (the service is `student-api` in docker-compose.uat.yml and
 * docker-compose.prod.yml; `run` gives the one-off container the service's env_file and environment, so it reaches the
 * same database settings, which are never printed):
 *   docker compose -f <compose file> --env-file <env file> run --rm student-api node scripts/recalc-lesson-quiz-points.js --org <code>
 *   docker compose -f <compose file> --env-file <env file> stop student-api
 *   docker compose -f <compose file> --env-file <env file> run --rm student-api node scripts/recalc-lesson-quiz-points.js --org <code> --apply --api-stopped
 *   docker compose -f <compose file> --env-file <env file> start student-api
 * (the first line is the dry run, with the API still up; read it before stopping). Take a database backup before --apply.
 *
 * After a recalculation:
 *   - The central server holds its own copy of progress. Rows are replaced by id when the student API's export
 *     (last six months, by attempt start or by lastupdated) is uploaded to it again, so upload after running this.
 *     Attempts older than six months are not sent again and keep their old points there.
 *   - Sync Students and Sync Content carry no learner progress and are safe to use. The risk is only uploading a student
 *     export downloaded from the central server to PUT /import/students from before that upload: the import writes points,
 *     progress and completed exactly as the file holds them and puts the old values back. Running this script again is not a
 *     repair then (attempts older than six months come back holding their points, and the dry run cannot tell them apart):
 *     restore the database backup taken before --apply instead.
 *
 * "Counted" pass: ispass, and also verified when GRADING_MODE is enforce and REQUIRE_GRADED_ANSWERS is on (the same
 * rule as countedpassclause in src/business/result.business.ts, read from the same environment variables).
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { run } = require("./lib/lesson-quiz-recalc");

function parseArgs(argv) {
  const args = { org: null, apply: false, apiStopped: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") args.org = argv[++i];
    else if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--api-stopped") args.apiStopped = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (args.org !== null && (typeof args.org !== "string" || args.org === "" || args.org.startsWith("--"))) throw new Error("--org needs a code");
  return args;
}

/**
 * The connection settings, resolved the way the app resolves them (src/config.ts): FORTYKAPIRPICONFIG when it parses AND passes
 * the app's own validation, otherwise the RPI_DB_* variables with the app's defaults. `validator` is the app's config schema
 * (build/validators/config.validator.js). Nothing is printed.
 */
function dbSettings(env, validator) {
  let db = null;
  if (env.FORTYKAPIRPICONFIG) {
    try {
      const { value, error } = validator.schema.prefs({ errors: { label: "key" } }).validate(JSON.parse(env.FORTYKAPIRPICONFIG));
      if (!error) db = value.fortyk.api.rpi.database;
    } catch { db = null; }
  }
  if (db) return { host: db.host, port: Number(db.port), user: db.user, password: db.password, database: db.name };
  return {
    host: env.RPI_DB_HOST || "localhost",
    port: parseInt(env.RPI_DB_PORT || "3306", 10),
    user: env.RPI_DB_USER || "root",
    password: env.RPI_DB_PASSWORD,
    database: env.RPI_DB_NAME || "edtech_lms_rpi",
  };
}

/** Closes the connection without ever hanging or throwing: on a dead connection `end()` can fail or never settle. */
async function closeQuietly(conn, timeoutMs = 2000) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => conn.end()).catch(() => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); if (timer.unref) timer.unref(); }),
    ]);
  } catch { /* nothing to do */ }
  if (timer) clearTimeout(timer);
  try { if (typeof conn.destroy === "function") conn.destroy(); } catch { /* already gone */ }
}

/**
 * options (all but argv optional; the defaults are the real ones): { argv, env, connect(settings), rules, ruleDeployed, validator, closeTimeoutMs, out }
 * Returns the exit code, which is also set on process.exitCode BEFORE the connection is closed.
 */
async function main(options = {}) {
  const env = options.env || process.env;
  let args;
  try {
    args = parseArgs(options.argv || process.argv.slice(2));
  } catch (err) {
    console.error(`Refusing to run: ${err.message}. Nothing was written.`);
    return 1;
  }
  const build = path.join(__dirname, "..", "build");
  const ruleDeployed = options.ruleDeployed !== undefined
    ? options.ruleDeployed
    : fs.existsSync(path.join(build, "business", "lesson-quiz-pass.js")) && fs.existsSync(path.join(build, "business", "progress-rules.js")) && fs.existsSync(path.join(build, "validators", "config.validator.js"));
  if (!ruleDeployed) {
    console.error("Refusing to run: the compiled build does not contain the lesson quiz pass rule. Nothing was written.");
    return 1;
  }
  const rules = options.rules || require(path.join(build, "business", "progress-rules.js"));
  const validator = options.validator || require(path.join(build, "validators", "config.validator.js"));
  const settings = dbSettings(env, validator);
  if (!settings.user || !settings.password) {
    console.error("Refusing to run: the database user or password is not set in the environment. Nothing was written.");
    return 1;
  }
  const conn = await (options.connect || ((s) => mysql.createConnection({ ...s, charset: "utf8mb4" })))(settings);
  let code = 2;
  try {
    const countedPassNeedsVerified = env.GRADING_MODE === "enforce" && (env.REQUIRE_GRADED_ANSWERS === "true" || env.REQUIRE_GRADED_ANSWERS === "1");
    const result = await run({ conn, organisationcode: args.org, apply: args.apply, apiStopped: args.apiStopped, rules, countedPassNeedsVerified, ruleDeployed, dbname: settings.database, out: options.out });
    code = result.exitCode;
  } finally {
    // Set before closing: closing a dead connection can leave the process to end by itself, and then this is the exit code.
    process.exitCode = code;
    await closeQuietly(conn, options.closeTimeoutMs);
  }
  return code;
}

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
  main().then((code) => process.exit(code), (err) => {
    console.error(`recalc-lesson-quiz-points failed (${err && err.code ? err.code : "error"})`);
    process.exit(2);
  });
}

module.exports = { parseArgs, dbSettings, closeQuietly, main };
