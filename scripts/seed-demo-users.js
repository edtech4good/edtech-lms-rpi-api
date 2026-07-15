/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Loads RPI_DB_* from ../.env and runs scripts/seed-demo-users.sql.
 * Usage: npm run seed:demo
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const host = process.env.RPI_DB_HOST || "127.0.0.1";
  const port = parseInt(String(process.env.RPI_DB_PORT || "3306"), 10);
  const user = process.env.RPI_DB_USER;
  const password = process.env.RPI_DB_PASSWORD;
  const database = process.env.RPI_DB_NAME || "edtech_lms_rpi";

  if (!user || password === undefined) {
    console.error(
      "Missing RPI_DB_USER or RPI_DB_PASSWORD in edtech-lms-rpi-api/.env",
    );
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "seed-demo-users.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  try {
    await conn.query(sql);
    console.log("Demo users seeded OK.");
    console.log("  demo.student / demo  (student)");
    console.log("  demo.teacher / demo  (teacher — import/sync guards)");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
