/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * One-off: bring existing learners into line after an organisation switches `requireLessonQuizPass` on.
 *
 * Before the rule, a FAILED lesson quiz attempt was saved holding the quiz's full points, and those points sit in the
 * learner's lesson, level and grade rows, so a lesson can show completed with no pass. For one organisation this script
 *   - sets the points of the non-passing attempts of every lesson quiz to 0 (practice, level quiz and baseline rows are
 *     never read for this);
 *   - for a quiz with no pass, takes the points the app currently counts as credited (the newest attempt's) off the
 *     lesson, level and grade rows, never below 0;
 *   - recomputes progress and completed on the rows it changed with the app's own rules (build/business/progress-rules.js)
 *     and sets their lastupdated, as the app does for a change (the export to the central server sends rows by lastupdated);
 *   - leaves a pass row, an attempt's percentage, ispass, verified and stars, the daily point history (studentpoints),
 *     other organisations and the content alone. A quiz whose only pass rows are not counted (see below) is left alone.
 * The organisation's setting must already be strictly true, and the build must contain the rule; otherwise it refuses
 * and changes nothing.
 *
 * Usage (counts only are printed; never a name, id, email or question):
 *   node scripts/recalc-lesson-quiz-points.js --org <organisation code>            dry run, writes nothing
 *   node scripts/recalc-lesson-quiz-points.js --org <organisation code> --apply    writes
 * Exit code 0 done, 1 refused, 2 some learners failed (each learner is one transaction; rerun to retry them).
 * Running it twice with --apply changes nothing the second time, and says so.
 *
 * On a server, from the student API's own container (the image holds scripts/ and the compiled build/; there is no ts
 * tooling and the database settings come from the container's environment, never printed), for example:
 *   docker compose --env-file <env file> exec <student api service> node scripts/recalc-lesson-quiz-points.js --org <code>
 * Run the dry run first, read it, then run with --apply. Run it when few learners are submitting: a learner's rows are
 * locked while that learner is handled, a submission that lands before or after is correct under the rule, but one that
 * overlaps the few milliseconds of that learner's transaction can have a total overwritten by the submission's own
 * write; the line "lessons whose stored points differ" in a later dry run shows any such lesson.
 *
 * After a recalculation:
 *   - The central server holds its own copy of progress. Rows are replaced by id when the student API's export
 *     (last six months, by attempt start or by lastupdated) is uploaded to it again, so upload after running this.
 *     Attempts older than six months are not sent again and keep their old points there.
 *   - Do not import a student export taken from the central server (PUT /import/students) from before that upload:
 *     the import writes points, progress and completed exactly as the file holds them and would put the old values back.
 *     Upload this server's export to central first, then take a new export from central.
 *
 * "Counted" pass: ispass, and also verified when GRADING_MODE is enforce and REQUIRE_GRADED_ANSWERS is on (the same
 * rule as countedpassclause in src/business/result.business.ts, read from the same environment variables).
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { run } = require("./lib/lesson-quiz-recalc");

function parseArgs(argv) {
  const args = { org: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") args.org = argv[++i];
    else if (argv[i] === "--apply") args.apply = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (args.org !== null && (typeof args.org !== "string" || args.org === "" || args.org.startsWith("--"))) throw new Error("--org needs a code");
  return args;
}

/** The connection settings, from the same places the app reads them (FORTYKAPIRPICONFIG, else RPI_DB_*). Nothing is printed. */
function dbSettings(env) {
  let db = null;
  if (env.FORTYKAPIRPICONFIG) {
    try { db = JSON.parse(env.FORTYKAPIRPICONFIG).fortyk.api.rpi.database; } catch { db = null; }
  }
  return {
    host: (db && db.host) || env.RPI_DB_HOST || "localhost",
    port: parseInt(String((db && db.port) || env.RPI_DB_PORT || "3306"), 10),
    user: (db && db.user) || env.RPI_DB_USER,
    password: (db && db.password) || env.RPI_DB_PASSWORD,
    database: (db && db.name) || env.RPI_DB_NAME || "edtech_lms_rpi",
  };
}

async function main() {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Refusing to run: ${err.message}. Nothing was written.`);
    return 1;
  }
  const build = path.join(__dirname, "..", "build", "business");
  const ruleDeployed = fs.existsSync(path.join(build, "lesson-quiz-pass.js")) && fs.existsSync(path.join(build, "progress-rules.js"));
  if (!ruleDeployed) {
    console.error("Refusing to run: the compiled build (build/business) does not contain the lesson quiz pass rule. Nothing was written.");
    return 1;
  }
  const rules = require(path.join(build, "progress-rules.js"));
  const settings = dbSettings(process.env);
  if (!settings.user || !settings.password) {
    console.error("Refusing to run: the database user or password is not set in the environment. Nothing was written.");
    return 1;
  }
  const conn = await mysql.createConnection({ ...settings, charset: "utf8mb4" });
  try {
    const countedPassNeedsVerified = process.env.GRADING_MODE === "enforce" && (process.env.REQUIRE_GRADED_ANSWERS === "true" || process.env.REQUIRE_GRADED_ANSWERS === "1");
    const result = await run({ conn, organisationcode: args.org, apply: args.apply, rules, countedPassNeedsVerified, ruleDeployed, dbname: settings.database });
    return result.exitCode;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`recalc-lesson-quiz-points failed (${err && err.code ? err.code : "error"})`);
    process.exit(2);
  });
}

module.exports = { parseArgs, dbSettings, main };
