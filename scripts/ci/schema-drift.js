/**
 * Helper for scripts/ci/schema-drift.sh. Reads the same RPI_DB_* variables the app and
 * the Sequelize CLI read (a .env is loaded too, but variables already in the
 * environment win).
 *
 *   node scripts/ci/schema-drift.js is-empty          exit 1 if the database already has tables
 *   node scripts/ci/schema-drift.js dump <file>       SHOW CREATE TABLE for every table, sorted by
 *                                                     table name, AUTO_INCREMENT=n removed
 *   node scripts/ci/schema-drift.js columns           compare the compiled models with the database:
 *                                                     a non-virtual attribute whose column does not
 *                                                     exist is MISSING (exit 1)
 *
 * sync() creates a missing table and adds a missing declared index, but it never adds a
 * column to a table that exists, so a column a model declares and no migration creates
 * is invisible to the before/after dump; `columns` is what catches it. Tables and
 * columns are read from the compiled models (build/) and information_schema, never from
 * a regex over source. Run `npm run build` first.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const opts = () => ({
  host: process.env.RPI_DB_HOST || "127.0.0.1",
  port: parseInt(process.env.RPI_DB_PORT || "3306", 10),
  user: process.env.RPI_DB_USER || "root",
  password: process.env.RPI_DB_PASSWORD || "",
  database: process.env.RPI_DB_NAME,
});
const connect = () => mysql.createConnection(opts());

async function tableNames(conn) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  );
  return rows.map((r) => r.t ?? r.T);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!process.env.RPI_DB_NAME) throw new Error("RPI_DB_NAME is not set");
  const conn = await connect();
  try {
    if (cmd === "is-empty") {
      const tables = await tableNames(conn);
      if (tables.length > 0) {
        console.error(`database ${process.env.RPI_DB_NAME} already has ${tables.length} table(s); this check needs an empty database`);
        process.exit(1);
      }
    } else if (cmd === "dump") {
      const out = [];
      for (const t of await tableNames(conn)) {
        const [rows] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
        const ddl = String(rows[0]["Create Table"]).replace(/ AUTO_INCREMENT=\d+/g, "");
        out.push(`-- ${t}\n${ddl};\n`);
      }
      fs.writeFileSync(arg, out.join("\n"));
      console.log(`dumped ${out.length} tables to ${arg}`);
    } else if (cmd === "columns") {
      const { Sequelize } = require("sequelize");
      const { initModels } = require(path.resolve("build/models/data-models/init-models"));
      const o = opts();
      const sequelize = new Sequelize(o.database, o.user, o.password, { host: o.host, port: o.port, dialect: "mysql", logging: false });
      initModels(sequelize);
      const [colRows] = await conn.query(
        "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE()",
      );
      const dbColumns = new Map();
      for (const r of colRows) {
        const t = r.t ?? r.T;
        if (!dbColumns.has(t)) dbColumns.set(t, new Set());
        dbColumns.get(t).add(String(r.c ?? r.C).toLowerCase());
      }
      const missingTables = [];
      const missingColumns = [];
      let modelCount = 0;
      for (const model of Object.values(sequelize.models)) {
        modelCount++;
        const table = String(model.getTableName());
        if (!dbColumns.has(table)) {
          missingTables.push(`${model.name} -> ${table}`);
          continue;
        }
        for (const attr of Object.values(model.rawAttributes)) {
          if (attr.type && attr.type.key === "VIRTUAL") continue;
          const field = String(attr.field ?? attr.fieldName);
          if (!dbColumns.get(table).has(field.toLowerCase())) missingColumns.push(`${table}.${field}`);
        }
      }
      console.log(`columns: ${modelCount} models checked against ${dbColumns.size} tables`);
      console.log(`MODEL TABLE ABSENT (${missingTables.length})`);
      missingTables.forEach((m) => console.log(`  ${m}`));
      console.log(`MODEL COLUMN ABSENT (${missingColumns.length})`);
      missingColumns.forEach((m) => console.log(`  ${m}`));
      await sequelize.close();
      if (missingTables.length > 0 || missingColumns.length > 0) process.exit(1);
    } else {
      throw new Error("usage: schema-drift.js is-empty | dump <file> | columns");
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
