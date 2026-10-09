/**
 * Compares the indexes the models declare (`indexes:` in each model's options) with
 * the indexes the database has, in the database named by .env:
 *
 *   npm run db:check-indexes
 *
 * This server calls `sequelize.sync()` at boot, which adds a declared index that is
 * missing (never changes one that exists under the same name). On a migration-built
 * database a migration should already have created every declared index, so this lists,
 * from the models and from
 * information_schema.statistics (never a regex over source):
 *
 *   MISSING   declared, no index of that name on the table, and no other index there that
 *             already starts with the same columns (so the declared one would add nothing)
 *   COVERED   declared, no index of that name, but another index on the table starts with
 *             the same whole columns, BTREE, no prefix length (e.g. (studentid, gradeid) covers an index on studentid; a
 *             foreign key's own index covers its column). sync() matches by name, so it would
 *             still add the declared one at boot: counted as drift here (central, which never
 *             syncs, does not count it).
 *   PRESENT   declared, and an index of that name is there (columns compared too)
 *   UNIQUE    any declared unique index (a unique needs a duplicate guard before it is added)
 *   DB-ONLY   count of indexes the database has that no model declares (migrations made them)
 *
 * Exits 1 when anything is MISSING or COVERED, or a PRESENT name has other columns. Read-only.
 */
import { QueryTypes } from "sequelize";
import { dbinstance } from "src/services/dbservice";
import { initModels } from "src/models/data-models/init-models";
import { ActualIndex, covers, sameAsDeclared } from "src/db/model-index-check";

interface Declared {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
}

async function main(): Promise<void> {
  const sequelize = dbinstance.getdbinstance();
  initModels(sequelize);

  const declared: Declared[] = [];
  let primaries = 0;
  for (const model of Object.values(sequelize.models)) {
    const table = String((model as any).getTableName());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const ix of ((model as any)._indexes ?? []) as any[]) {
      const columns = (ix.fields as Array<string | { name?: string; attribute?: string }>).map((f) =>
        typeof f === "string" ? f : String(f.name ?? f.attribute),
      );
      if (ix.name === "PRIMARY") {
        // The primary key is made by createTable from the model's primaryKey attribute, never by an ALTER.
        primaries++;
        continue;
      }
      declared.push({ table, name: String(ix.name), columns, unique: Boolean(ix.unique) });
    }
  }

  const rows = (await sequelize.query(
    `SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS nonunique, SEQ_IN_INDEX AS seq, COLUMN_NAME AS col, SUB_PART AS subpart, INDEX_TYPE AS itype
     FROM information_schema.statistics WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    { type: QueryTypes.SELECT },
  )) as Array<{ tbl?: string; TBL?: string; name?: string; NAME?: string; nonunique?: number; NONUNIQUE?: number; col?: string; COL?: string; subpart?: number | null; SUBPART?: number | null; itype?: string; ITYPE?: string }>;
  const actual = new Map<string, ActualIndex>();
  for (const r of rows) {
    const key = `${r.tbl ?? r.TBL}.${r.name ?? r.NAME}`;
    const e = actual.get(key) ?? { columns: [], unique: Number(r.nonunique ?? r.NONUNIQUE) === 0, subParts: [], type: String(r.itype ?? r.ITYPE) };
    e.columns.push(String(r.col ?? r.COL));
    const sub = r.subpart ?? r.SUBPART;
    e.subParts.push(sub === null || sub === undefined ? null : Number(sub));
    actual.set(key, e);
  }
  const tables = new Set(
    ((await sequelize.query("SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()", { type: QueryTypes.SELECT })) as Array<{ t?: string; T?: string }>).map((r) => String(r.t ?? r.T)),
  );

  const fmt = (d: Declared) => `${d.table}.${d.name} (${d.columns.join(", ")})${d.unique ? " UNIQUE" : ""}`;
  const missing: Declared[] = [];
  const covered: Array<Declared & { by: string }> = [];
  const present: Declared[] = [];
  const mismatched: string[] = [];
  const noTable: Declared[] = [];
  for (const d of declared) {
    if (!tables.has(d.table)) {
      noTable.push(d);
      continue;
    }
    const a = actual.get(`${d.table}.${d.name}`);
    if (!a) {
      const by = [...actual.entries()].find(
        ([k, v]) => k.startsWith(`${d.table}.`) && !d.unique && covers(v, d.columns),
      );
      if (by) {
        covered.push({ ...d, by: by[0] });
      } else {
        missing.push(d);
      }
      continue;
    }
    present.push(d);
    if (!sameAsDeclared(a, d.columns, d.unique)) {
      mismatched.push(`${fmt(d)}  database has (${a.columns.map((c, i) => c + (a.subParts[i] === null ? "" : `(${a.subParts[i]})`)).join(", ")})${a.unique ? " UNIQUE" : ""} ${a.type}`);
    }
  }
  const declaredKeys = new Set(declared.map((d) => `${d.table}.${d.name}`));
  const dbOnly = [...actual.keys()].filter((k) => !declaredKeys.has(k) && !k.endsWith(".PRIMARY"));

  console.log(`declared (PRIMARY excluded, ${primaries} of them): ${declared.length} indexes on ${new Set(declared.map((d) => d.table)).size} tables`);
  console.log(`\nMISSING (${missing.length})`);
  missing.forEach((d) => console.log(`  ${fmt(d)}`));
  console.log(`\nCOVERED by another index's leading columns (${covered.length})`);
  covered.forEach((d) => console.log(`  ${fmt(d)}  <- ${d.by}`));
  console.log(`\nPRESENT (${present.length})`);
  present.forEach((d) => console.log(`  ${fmt(d)}`));
  console.log(`\nPRESENT WITH OTHER COLUMNS (${mismatched.length})`);
  mismatched.forEach((m) => console.log(`  ${m}`));
  console.log(`\nTABLE ABSENT (${noTable.length})`);
  noTable.forEach((d) => console.log(`  ${fmt(d)}`));
  console.log(`\nUNIQUE declared (${declared.filter((d) => d.unique).length})`);
  declared.filter((d) => d.unique).forEach((d) => console.log(`  ${fmt(d)}`));
  console.log(`\nDB-ONLY (indexes no model declares, PRIMARY excluded): ${dbOnly.length}`);
  await sequelize.close();
  process.exit(missing.length > 0 || covered.length > 0 || mismatched.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
