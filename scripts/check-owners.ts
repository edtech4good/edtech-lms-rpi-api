/**
 * The operator's pre-flight for migration S4 (the owner and school columns become
 * required), in the database named by .env:
 *
 *   npm run db:check-owners             counts per column
 *   npm run db:check-owners -- --ids    also the primary key of every offending row
 *
 * It counts exactly what the migration's guard counts, from the same list
 * (src/db/required-columns.ts): the rows whose value is NULL in
 *
 *   schools.organisationid, students.schoolid, schoolusers.schoolid
 *   curriculums, questions, documents, subjects: organisationid
 *
 * Exits 1 when any column holds such a row or does not exist, 0 when every count
 * is zero, 2 when it could not read the database. Read-only. Prints counts and
 * ids, never names. A server whose counts are all zero migrates S4 without a
 * refusal.
 *
 * A column that does not exist yet (the earlier migration has not run) is reported
 * as "missing" and counts as a failure: the pre-flight is not finished until the
 * migrations before it have run.
 */
import { dbinstance } from "src/services/dbservice";
import { findViolations, REQUIRED_COLUMNS, RequiredColumn, Violation } from "src/db/required-columns";

async function columnExists(db: ReturnType<typeof dbinstance.getdbinstance>, target: RequiredColumn): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    { replacements: [target.table, target.column] },
  );
  return (rows as unknown[]).length > 0;
}

async function main() {
  const showIds = process.argv.includes("--ids");
  const db = dbinstance.getdbinstance();
  (db as unknown as { options: { logging: boolean } }).options.logging = false;
  const present: RequiredColumn[] = [];
  const missing: RequiredColumn[] = [];
  for (const target of REQUIRED_COLUMNS) {
    (await columnExists(db, target) ? present : missing).push(target);
  }
  const found: Violation[] = await findViolations(db, present, { limit: showIds ? Infinity : 0 });
  for (const v of found) {
    console.log(`${v.table}.${v.column}: null_rows=${v.count}`);
    if (showIds && v.count > 0) {
      console.log(`  ${v.pk}: ${v.ids.join(", ")}`);
    }
  }
  for (const m of missing) {
    console.log(`${m.table}.${m.column}: MISSING (the migration that adds it has not run)`);
  }
  const bad = found.filter((v) => v.count > 0).length + missing.length;
  console.log(
    bad === 0
      ? "OK: every required column holds a value in every row. S4 can be applied."
      : `FAILED: ${bad} column(s) are missing or hold rows with no value. S4 would refuse. ` +
          "Run with --ids to list the rows; give each its owner, then check again.",
  );
  await db.close();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
