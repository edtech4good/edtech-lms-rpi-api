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
 */
const { statementOf } = require("./dcrs-content-plan");

const blank = () => ({ inserted: 0, updated: 0, unchanged: 0, hidden: 0 });

/** Runs `plan`. Returns `{ tables: { table: {inserted, updated, unchanged, hidden} } }`; rolls back and throws on any failure. */
async function applyPlan(conn, plan) {
  const tables = {};
  const count = (table) => (tables[table] ??= blank());
  await conn.beginTransaction();
  try {
    for (const step of plan.steps) {
      const { sql, params } = statementOf(step);
      const [result] = await conn.execute(sql, params);
      const c = count(step.table);
      if (step.kind === "upsert") {
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
  const byTable = new Map();
  for (const step of plan.steps) {
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

module.exports = { applyPlan, verifyPlan, formatReport };
