/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The command-line half of `seed:dcrs -- --content <dir>`, shared by both seed scripts:
 * reads the arguments (`--content <dir>`, `--draft`, `--live`, `--rename-lessons`, `--dry-run`, `--help`), loads and checks
 * `<dir>/content.json`, and prints a dry run. The folder is only read.
 *
 * Verbatim twin: edtech-lms-api/scripts/lib/dcrs-content-cli.js and
 * edtech-lms-rpi-api/scripts/lib/dcrs-content-cli.js stay byte-identical (a spec in each
 * repo pins the hash).
 */
const fs = require("fs");
const path = require("path");
const { ContentRefused, LESSON_IDS, validateContent, planContent } = require("./dcrs-content-plan");

const LANG_RETIRED =
  "--lang is retired: the English text is the base text of every row and the Khmer text is stored as translations (bilingual content design, section 6.4), so there is no language to choose";

/** The help line: what the options are, and what the level switch does. */
const USAGE =
  "usage: seed:dcrs -- --content <dir> [--draft | --live] [--rename-lessons] [--dry-run]  " +
  "(--draft writes the module's level switched off, levelstatus 0: built but not shown to learners; --live writes it switched on, levelstatus 1; " +
  "not both. With neither, a level already in the database keeps its switch and a new level is refused. --draft is refused for module 1. " +
  "--rename-lessons lets a later module's lesson slot take another name; without it a slot holding a different lesson is refused)";

/** `--content <dir>`, `--draft`, `--live`, `--rename-lessons`, `--dry-run` and `--help`; `--lang` (retired) and anything else are refused. */
function parseArgs(argv) {
  const args = { content: null, dryRun: false, draft: false, live: false, renameLessons: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--content") args.content = argv[++i];
    else if (argv[i] === "--lang" || String(argv[i]).startsWith("--lang=")) throw new ContentRefused([LANG_RETIRED]);
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--draft") args.draft = true;
    else if (argv[i] === "--live") args.live = true;
    else if (argv[i] === "--rename-lessons") args.renameLessons = true;
    else if (argv[i] === "--help") args.help = true;
    else throw new ContentRefused([`unknown argument ${argv[i]}`]);
  }
  if (args.help) return args;
  if (args.content !== null && (typeof args.content !== "string" || args.content === "" || args.content.startsWith("--"))) {
    throw new ContentRefused(["--content needs a folder"]);
  }
  if (args.content === null && args.dryRun) throw new ContentRefused(["--dry-run only applies with --content"]);
  if (args.draft && args.live) throw new ContentRefused(["--draft and --live cannot be used together: a module's level is either switched off or switched on"]);
  for (const flag of ["draft", "live", "renameLessons"]) {
    if (args.content === null && args[flag]) throw new ContentRefused([`--${flag === "renameLessons" ? "rename-lessons" : flag} only applies with --content`]);
  }
  return args;
}

/** The level switch the arguments ask for: "draft", "live", or null when neither flag was given. */
const levelSwitchOf = (args) => (args.draft ? "draft" : args.live ? "live" : null);

/** Reads and checks `<dir>/content.json`; nothing is written anywhere. */
function readContent(dir, ID) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, "content.json"), "utf8");
  } catch (err) {
    throw new ContentRefused([`cannot read content.json in the folder (${err.code || "error"})`]);
  }
  let content;
  try {
    content = JSON.parse(raw);
  } catch {
    throw new ContentRefused(["content.json is not valid JSON"]);
  }
  return validateContent(content, ID);
}

/**
 * Arguments and content, or exit 1 with the reasons (nothing has been written by then).
 * `args.content` is null in the seed's ordinary mode, and then `content` is null too.
 */
function prepare(argv, ID) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(USAGE);
      process.exit(0);
    }
    for (const [i, id] of LESSON_IDS.entries()) {
      if (id !== ID[`lesson${i + 1}`]) throw new ContentRefused(["the lesson ids of the plan and of this seed disagree"]);
    }
    const content = args.content === null ? null : readContent(args.content, ID);
    // Everything that needs no database is checked now (the flags against the module, the content against the rules), so a refusal comes before a connection is opened.
    if (content) planContent(content, ID, { organisationid: "check", now: new Date(0), levelSwitch: levelSwitchOf(args), renameLessons: args.renameLessons, existing: null });
    return { args, content };
  } catch (err) {
    if (!(err instanceof ContentRefused)) throw err;
    console.error(`Refusing to run: ${err.problems.join("; ")}. Nothing was written.`);
    process.exit(1);
  }
}

/** Prints the reasons for a refusal and exits 1; anything that is not a refusal is thrown on. Used while nothing of the content has been written. */
function refuse(err) {
  if (!(err instanceof ContentRefused)) throw err;
  console.error(`Refusing to run: ${err.problems.join("; ")}. Nothing of the content was written.`);
  process.exit(1);
}

/** The switch a plan's level has, in words (the status is null when neither flag was given and the database was not asked). */
const describeSwitch = (status, levelSwitch) =>
  status === 1
    ? `on (levelstatus 1${levelSwitch === "live" ? ", --live" : ", as it is"})`
    : status === 0
      ? `switched off (levelstatus 0${levelSwitch === "draft" ? ", --draft" : ", as it is"}): built, not shown to learners`
      : "left as it is if it exists (neither --draft nor --live; a new level would be refused)";

/** The plan as table names and counts; no content, no database. */
function printDryRun(content, ID, { levelSwitch = null, renameLessons = false } = {}) {
  const plan = planContent(content, ID, { organisationid: "dry-run", now: new Date(0), levelSwitch, renameLessons, existing: null });
  console.log(`DCRS content plan (dry run, base language ${plan.baseLanguage}, translations ${plan.translationLanguage}): ${plan.steps.length} steps, no database used.`);
  console.log(`  module ${plan.module.number}: its level is order ${plan.module.levelorder}, ${describeSwitch(plan.module.levelstatus, levelSwitch)}`);
  console.log(`  points: the level ${plan.module.levelpoints}; the grade ${plan.module.gradepoints} counting only this level (a real run adds the other live levels)`);
  const translated = {};
  for (const step of plan.steps) {
    if (step.kind === "translate") translated[step.values.tablename] = (translated[step.values.tablename] ?? 0) + 1;
    else console.log(`  ${step.kind === "upsert" ? "upsert" : "hide  "} ${step.table} ${step.kind === "upsert" ? 1 : step.ids.length}`);
  }
  for (const [table, n] of Object.entries(translated)) console.log(`  translate ${table} ${n}`);
  for (const m of plan.media) console.log(`  media: copy ${m.source ?? "the lesson video"} to <media folder>/${m.filename}`);
}

module.exports = { USAGE, parseArgs, levelSwitchOf, describeSwitch, readContent, prepare, refuse, printDryRun };
