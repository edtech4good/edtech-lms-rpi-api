/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Loads RPI_DB_* from ../.env and runs scripts/seed-demo-users.sql.
 * Usage: npm run seed:demo (requires ALLOW_DEMO_SEED=true)
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");
const md5 = require("crypto-js/md5");
const bcryptjs = require("bcryptjs");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    console.error("Refusing to run: set ALLOW_DEMO_SEED=true to seed demo data. This replaces the old NODE_ENV check so UAT re-seeds are explicit and prod can never be seeded by accident.");
    process.exit(1);
  }

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
  // SQL can't compute bcrypt, so the .sql carries a __PASSWORD_HASH__
  // placeholder and this script fills it in — same scheme as
  // src/services/password.service.ts: bcrypt(md5(password)), same
  // crypto-js/md5 + bcryptjs libraries, same BCRYPT_ROUNDS (10). Note
  // INSERT IGNORE means this only sets the hash on a first insert; it will
  // NOT repair an existing row already seeded with a raw MD5 hash — that
  // needs the rewrap migration (20260719160000-rewrap-md5-passwords-bcrypt).
  // Published default — override for any non-local target. See
  // seed-local-dev.js, which takes SUPERADMIN_PASSWORD the same way.
  const plaintext = process.env.SEED_DEMO_PASSWORD || "demo";
  const passwordHash = bcryptjs.hashSync(md5(plaintext).toString(), 10);
  // Replacer is a function, not the hash string directly: a bcrypt hash
  // contains "$" sequences (e.g. "$2b$10$..."), and String.replace()
  // special-cases "$"-patterns (`$&`, `$1`, `$$`, ...) in a string
  // replacement. A function return value is inserted verbatim.
  const sql = fs
    .readFileSync(sqlPath, "utf8")
    .replace(/__PASSWORD_HASH__/g, () => passwordHash);

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
    console.log(`  demo.student / ${plaintext}  (student)`);
    console.log(`  demo.teacher / ${plaintext}  (teacher — import/sync guards)`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
