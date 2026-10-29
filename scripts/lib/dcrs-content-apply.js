/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The database half of `seed:dcrs -- --content <dir>`: runs a plan from
 * dcrs-content-plan.js on a mysql2/promise connection, in one transaction, counts what
 * each table gained, changed and hid, and checks the result by count.
 *
 * Verbatim twin: edtech-lms-api/scripts/lib/dcrs-content-apply.js and
 * edtech-lms-rpi-api/scripts/lib/dcrs-content-apply.js stay byte-identical (a spec in each
 * repo pins the hash).
 *
 * The connection must be opened with the FOUND_ROWS flag removed (`flags: ["-FOUND_ROWS"]`),
 * so that `affectedRows` of an INSERT ... ON DUPLICATE KEY UPDATE is 1 for a new row, 2 for
 * a row whose values changed and 0 for one that already had them, and of an UPDATE is the
 * number of rows it actually changed. That is what makes a second run report all zeros.
 *
 * Before it writes anything `preflight` checks, read-only, that the database has the translations table and the
 * organisation's `contentlanguage` column, that the organisation's content language is `en` or still unset, and that
 * the seed rows the translations hang from belong to that organisation (or to nobody yet). Inside the transaction
 * `applyPlan` then sets `contentlanguage` to `en` when it is unset (a different language stops the run), writes the
 * plan, and checks every translation row by its key, text and hash.
 *
 * A module after the first attaches to the curriculum and the grade Module 1 made: `preflight` refuses the run, naming which is
 * missing, when the plan's `requires` rows are not in the database. `curriculumNameLengths` is how the seed says, without
 * printing the client's text, whether the run changes the curriculum's name.
 *
 * `readExisting` is what the seed reads, read-only, BEFORE it plans (and before its placeholder pass): the grade's levels (whether
 * each is switched on, its points, whether it has a level quiz) and the module's lesson slots as they are, so that the plan can keep an existing level's switch,
 * require one for a new level, compute the grade's points over the live levels, and refuse a lesson slot that would change meaning.
 */
const { statementOf, slotsOf, ContentRefused } = require("./dcrs-content-plan");

const blank = () => ({ inserted: 0, updated: 0, unchanged: 0, hidden: 0 });

const base = (plan) => plan.baseLanguage;

/** The organisation's content language, locked for the rest of the transaction when `lock` is set; throws ContentRefused when it is another language than the plan's base. */
async function organisationLanguage(conn, plan, lock) {
  const [rows] = await conn.execute(`SELECT contentlanguage FROM organisations WHERE organisationid = ?${lock ? " FOR UPDATE" : ""}`, [plan.organisationid]);
  if (rows.length === 0) throw new ContentRefused(["the organisation these rows belong to is not in the database"]);
  const language = rows[0].contentlanguage;
  if (language !== null && language !== undefined && String(language).toLowerCase() !== base(plan)) {
    throw new ContentRefused([
      `the organisation's content language is "${language}", and this import writes ${base(plan)} as the base text with the ${plan.translationLanguage} text as translations; ` +
        "change the organisation's content language by hand first if that is what you want, or use a different organisation",
    ]);
  }
  return language ?? null;
}

/**
 * What the plan needs to know of the database (see planContent's `existing`): every level of the grade, and the module's lesson slots
 * that exist. Read-only; nothing is written. A grade that is not there yet simply has no levels.
 */
async function readExisting(conn, content, ID) {
  const slots = slotsOf(ID, content.module.number);
  // `levelquizrows`: the level's active level-quiz questions (the same "active" the student API reports as level_has_quiz); its quiz_points count only when there is one.
  const [levels] = await conn.execute(
    "SELECT l.levelid, l.levelstatus, l.isdeleted, l.points, l.quiz_points, " +
      "(SELECT COUNT(*) FROM `levelquizquestions` q WHERE q.`levelid` = l.`levelid` AND q.`levelquizquestionstatus` = 1) AS levelquizrows " +
      "FROM `levels` l WHERE l.`gradeid` = ?",
    [ID.grade],
  );
  const lessonids = slots.lessons.map((l) => l.id);
  const [lessons] = await conn.execute(
    `SELECT lessonid, lessonname, isdeleted, total_points FROM \`lessons\` WHERE \`lessonid\` IN (${lessonids.map(() => "?").join(", ")})`,
    lessonids,
  );
  return { levels, lessons };
}

/** Read-only checks before anything of the content is written; throws ContentRefused with the reason. */
async function preflight(conn, plan) {
  const [[tables]] = await conn.execute(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND ((table_name = 'contenttranslations' AND column_name = 'sourcehash') OR (table_name = 'organisations' AND column_name = 'contentlanguage'))",
  );
  if (Number(tables.n) !== 2) {
    throw new ContentRefused(["this database has no contenttranslations table or no organisations.contentlanguage column; run the migrations first"]);
  }
  await organisationLanguage(conn, plan, false);
  // A module after the first attaches to the curriculum and the grade that are already there; it never creates them.
  const missing = [];
  for (const { what, table, pk, ids } of plan.requires ?? []) {
    const [[row]] = await conn.execute(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${pk}\` IN (${ids.map(() => "?").join(", ")})`, ids);
    if (Number(row.n) !== ids.length) missing.push(what);
  }
  if (missing.length > 0) {
    throw new ContentRefused([
      `this file is module ${plan.module.number}, which attaches to the programme's existing ${missing.join(" and ")}, and this database has no such row; seed Module 1 first`,
    ]);
  }
  for (const { table, pk, ids } of plan.owned) {
    const [[row]] = await conn.execute(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${pk}\` IN (${ids.map(() => "?").join(", ")}) AND \`organisationid\` IS NOT NULL AND \`organisationid\` <> ?`,
      [...ids, plan.organisationid],
    );
    if (Number(row.n) !== 0) throw new ContentRefused([`${row.n} ${table} row(s) of this seed belong to another organisation, so their translations cannot be this organisation's`]);
  }
}

/**
 * The curriculum's name before this run and after it, as lengths in characters (the names are the client's text, so the text is never
 * returned): `{ before: number | null, after: number, same: boolean }`, `before` null when the curriculum is not in the database yet. Read-only.
 */
async function curriculumNameLengths(conn, plan) {
  const [rows] = await conn.execute("SELECT curriculumname FROM curriculums WHERE curriculumid = ?", [plan.curriculumid]);
  const length = (text) => [...String(text)].length;
  return {
    before: rows.length === 0 ? null : length(rows[0].curriculumname),
    after: length(plan.curriculumName),
    same: rows.length > 0 && rows[0].curriculumname === plan.curriculumName,
  };
}

/** One line saying what the run does to the curriculum's name, by length only. */
function formatCurriculumName({ before, after, same }) {
  if (before === null) return `  curriculum name: new, ${after} characters`;
  if (same) return `  curriculum name: unchanged, ${after} characters`;
  return `  curriculum name: renamed, ${before} characters before, ${after} after`;
}

/** Runs `plan`. Returns `{ tables: { table: {inserted, updated, unchanged, hidden} } }`; rolls back and throws on any failure. */
async function applyPlan(conn, plan) {
  const tables = {};
  const count = (table) => (tables[table] ??= blank());
  await conn.beginTransaction();
  try {
    // The base language comes first: nothing below means anything under another one.
    const was = await organisationLanguage(conn, plan, true);
    let setNow = 0;
    if (was === null) {
      const [result] = await conn.execute("UPDATE organisations SET contentlanguage = ? WHERE organisationid = ? AND contentlanguage IS NULL", [base(plan), plan.organisationid]);
      setNow = result.affectedRows;
    }
    const org = count("organisations");
    if (setNow === 1) org.updated += 1;
    else org.unchanged += 1;
    for (const step of plan.steps) {
      const { sql, params } = statementOf(step);
      const [result] = await conn.execute(sql, params);
      const c = count(step.table);
      if (step.kind === "upsert" || step.kind === "translate") {
        if (result.affectedRows === 1) c.inserted += 1;
        else if (result.affectedRows === 2) c.updated += 1;
        else c.unchanged += 1;
      } else {
        c.hidden += result.affectedRows;
      }
    }
    await verifyPlan(conn, plan);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
  return { tables };
}

/**
 * Every row the plan upserts is there, and every row of it that exists and should be hidden is hidden:
 * counted, not assumed. (A join-row slot the plan hides may never have been created; that is not a failure.)
 */
async function verifyPlan(conn, plan) {
  const [[org]] = await conn.execute("SELECT COUNT(*) AS n FROM organisations WHERE organisationid = ? AND contentlanguage = ?", [plan.organisationid, base(plan)]);
  if (Number(org.n) !== 1) throw new Error("content check failed: the organisation does not have the base content language after the run");
  const byTable = new Map();
  for (const step of plan.steps) {
    if (step.kind === "translate") {
      // A translation is found by its key (an older row keeps its own id), and must be this organisation's, with this text and this hash.
      const v = step.values;
      const [[row]] = await conn.execute(
        "SELECT COUNT(*) AS n FROM `contenttranslations` WHERE `tablename` = ? AND `rowid` = ? AND `field` = ? AND `subkey` = ? AND `language` = ? AND `organisationid` = ? AND `sourcehash` = ? AND BINARY `text` = BINARY ?",
        [v.tablename, v.rowid, v.field, v.subkey, v.language, v.organisationid, v.sourcehash, v.text],
      );
      if (Number(row.n) !== 1) throw new Error(`content check failed: the ${v.language} translation of ${v.tablename}.${v.field} is not there as the plan wrote it`);
      continue;
    }
    const key = `${step.kind}:${step.table}:${step.pk}`;
    const entry = byTable.get(key) ?? { step, ids: [] };
    entry.ids.push(...(step.kind === "upsert" ? [step.id] : step.ids));
    byTable.set(key, entry);
  }
  const count = async (table, pk, ids, conditions) => {
    let where = `\`${pk}\` IN (${ids.map(() => "?").join(", ")})`;
    const params = [...ids];
    for (const [col, value] of conditions) {
      where += ` AND \`${col}\` = ?`;
      params.push(value);
    }
    const [[row]] = await conn.execute(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE ${where}`, params);
    return Number(row.n);
  };
  for (const { step, ids } of byTable.values()) {
    if (step.kind === "hide") {
      const there = await count(step.table, step.pk, ids, []);
      const done = await count(step.table, step.pk, ids, Object.entries(step.set));
      if (done !== there) throw new Error(`content check failed: ${step.table} has ${there - done} of ${there} rows the plan hid still showing`);
    } else {
      // A live row: each of the step's own switch columns (isdeleted / status) is the value the plan wrote.
      const switches = step.update.filter((c) => /^(isdeleted|\w+status)$/.test(c)).map((c) => [c, step.values[c]]);
      const n = await count(step.table, step.pk, ids, switches);
      if (n !== ids.length) throw new Error(`content check failed: ${step.table} has ${n} of the ${ids.length} rows the plan wrote`);
    }
  }
}

/** The per-table table, as text (table names only; no content). */
function formatReport(report) {
  const rows = Object.entries(report.tables);
  const width = Math.max(5, ...rows.map(([t]) => t.length));
  const line = (t, c) => `  ${t.padEnd(width)}  ${String(c.inserted).padStart(8)} ${String(c.updated).padStart(7)} ${String(c.unchanged).padStart(9)} ${String(c.hidden).padStart(6)}`;
  return [
    `  ${"table".padEnd(width)}  ${"inserted".padStart(8)} ${"updated".padStart(7)} ${"unchanged".padStart(9)} ${"hidden".padStart(6)}`,
    ...rows.map(([t, c]) => line(t, c)),
  ].join("\n");
}

module.exports = { applyPlan, verifyPlan, preflight, readExisting, formatReport, curriculumNameLengths, formatCurriculumName };
