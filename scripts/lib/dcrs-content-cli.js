/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The command-line half of `seed:dcrs -- --content <dir>`, shared by both seed scripts:
 * reads the arguments, loads and checks `<dir>/content.json`, and prints a dry run. The
 * folder is only read.
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

/** `--content <dir>` and `--dry-run`; `--lang` (retired) and anything else are refused. */
function parseArgs(argv) {
  const args = { content: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--content") args.content = argv[++i];
    else if (argv[i] === "--lang" || String(argv[i]).startsWith("--lang=")) throw new ContentRefused([LANG_RETIRED]);
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else throw new ContentRefused([`unknown argument ${argv[i]}`]);
  }
  if (args.content !== null && (typeof args.content !== "string" || args.content === "" || args.content.startsWith("--"))) {
    throw new ContentRefused(["--content needs a folder"]);
  }
  if (args.content === null && args.dryRun) throw new ContentRefused(["--dry-run only applies with --content"]);
  return args;
}

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
    for (const [i, id] of LESSON_IDS.entries()) {
      if (id !== ID[`lesson${i + 1}`]) throw new ContentRefused(["the lesson ids of the plan and of this seed disagree"]);
    }
    return { args, content: args.content === null ? null : readContent(args.content, ID) };
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

/** The plan as table names and counts; no content, no database. */
function printDryRun(content, ID) {
  const plan = planContent(content, ID, { organisationid: "dry-run", now: new Date(0) });
  console.log(`DCRS content plan (dry run, base language ${plan.baseLanguage}, translations ${plan.translationLanguage}): ${plan.steps.length} steps, no database used.`);
  const translated = {};
  for (const step of plan.steps) {
    if (step.kind === "translate") translated[step.values.tablename] = (translated[step.values.tablename] ?? 0) + 1;
    else console.log(`  ${step.kind === "upsert" ? "upsert" : "hide  "} ${step.table} ${step.kind === "upsert" ? 1 : step.ids.length}`);
  }
  for (const [table, n] of Object.entries(translated)) console.log(`  translate ${table} ${n}`);
  for (const m of plan.media) console.log(`  media: copy ${m.source ?? "the lesson video"} to <media folder>/${m.filename}`);
}

module.exports = { parseArgs, readContent, prepare, refuse, printDryRun };
