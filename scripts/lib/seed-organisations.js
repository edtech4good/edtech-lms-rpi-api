/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The two organisations the local development seeds (`seed:demo`, `seed:content`, `seed:dcrs`) put their rows
 * in, and the one place that creates them. Mirrors edtech-lms-api/scripts/lib/seed-organisations.js (same
 * codes, same ids), so a local central and a local student API agree on who owns what.
 *
 * Every school and every piece of content belongs to an organisation, and a login whose school has none cannot
 * sign in (src/business/token-claims.ts). So each seed makes sure the organisation it writes into exists before
 * it inserts anything, whichever seed runs first:
 *
 *  - `edtech4good`: the demo content, its demo school and its demo logins;
 *  - `miv`: the DCRS content, its school and its logins (a corporate-themed organisation).
 *
 * `ensureOrganisation` looks the organisation up by its CODE first and uses the id it finds, so a database that
 * already has the organisation (a backfill, or the provisioning command, gives its own ids) is reused, never
 * duplicated. Only when the code is not there is a row inserted, with the fixed id below. Nothing is ever
 * overwritten. An organisation of that code that has been deleted is refused: a code is never reissued.
 *
 * (A classroom server is not provisioned with these: `npm run provision` mints its own organisation. These are
 * for development databases.)
 */
const ORGANISATIONS = {
  edtech4good: {
    id: "a0000000-0000-4000-8000-000000000001",
    code: "edtech4good",
    name: "EdTech for Good",
    uitheme: "kids",
  },
  miv: {
    id: "a0000000-0000-4000-8000-000000000002",
    code: "miv",
    name: "Mekong Inclusive Ventures",
    uitheme: "corporate",
  },
};

/** `conn` is a mysql2/promise connection. Returns the organisation's id. */
async function ensureOrganisation(conn, code) {
  const org = ORGANISATIONS[code];
  if (!org) {
    throw new Error(`Unknown seed organisation: ${code}`);
  }
  let [rows] = await conn.execute(`SELECT organisationid, isdeleted FROM organisations WHERE organisationcode = ? LIMIT 1`, [code]);
  if (rows.length > 0 && Number(rows[0].isdeleted) !== 0) {
    throw new Error(
      `The organisation with code "${code}" has been deleted, and a code is never reissued, so this seed cannot use it. ` +
        "Restore it, or seed a database that does not have it.",
    );
  }
  if (rows.length === 0) {
    await conn.execute(
      `INSERT INTO organisations (organisationid, organisationname, organisationcode, organisationstatus, uitheme, isdeleted)
       VALUES (?,?,?,1,?,0)`,
      [org.id, org.name, org.code, org.uitheme],
    );
    [rows] = await conn.execute(`SELECT organisationid, isdeleted FROM organisations WHERE organisationcode = ? LIMIT 1`, [code]);
  }
  return rows[0].organisationid;
}

/**
 * Seeds insert with INSERT IGNORE, which turns a refused row (a missing parent, a NULL in a required column)
 * into a silent skip. So after inserting, each seed fills an owner or school that is still NULL on its own rows
 * (never overwriting one: a server whose rows already belong to another organisation keeps them) and then
 * checks that every row it meant to write is there and has the column set. Throws, naming the table, when not.
 *
 * `expected`: [{ table, key, ids, column, value }]: `ids` are the seeded primary keys, `value` what a NULL
 * `column` is filled with (the organisation's id for `organisationid`, the school's id for `schoolid`).
 */
async function fillAndVerify(conn, expected) {
  for (const { table, key, ids, column, value } of expected) {
    for (const id of ids) {
      await conn.execute(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${key}\` = ? AND \`${column}\` IS NULL`, [value, id]);
    }
    const marks = ids.map(() => "?").join(",");
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${key}\` IN (${marks}) AND \`${column}\` IS NOT NULL`,
      ids,
    );
    if (Number(rows[0].n) !== ids.length) {
      throw new Error(`Seed check failed: ${table} should hold ${ids.length} seeded row(s) with ${column} set, found ${rows[0].n}.`);
    }
  }
}

module.exports = { ORGANISATIONS, ensureOrganisation, fillAndVerify };
