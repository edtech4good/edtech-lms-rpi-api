import { QueryInterface, QueryTypes, Transaction } from "sequelize";
import bcryptjs from "bcryptjs";

/**
 * Rewrap stored unsalted-MD5 password hashes as `bcrypt(md5hash)` in THIS
 * database (`edtech_lms_rpi`). Mirror of the central API's migration — the two
 * APIs use separate databases with their own `schoolusers`/`lmsusers` tables
 * (bridged by the import/sync flow, which stores hashes verbatim), so each
 * database rewraps its own rows. Run only after this API is on the dual-mode
 * verify. Idempotent: MD5 hex is 32 chars, bcrypt is 60 starting `$2`; only the
 * 32-char rows are touched. See docs/password-hashing-bcrypt-plan.md.
 */
const BCRYPT_ROUNDS = 10;

const TARGETS = [
  { table: "lmsusers", pk: "lmsuserid", col: "lmsuserpasswordhash" },
  { table: "schoolusers", pk: "schooluserid", col: "schooluserpasswordhash" },
];

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      for (const { table, pk, col } of TARGETS) {
        const rows = await queryInterface.sequelize.query<Record<string, string>>(
          `SELECT ${pk} AS id, ${col} AS hash FROM ${table} ` +
            `WHERE ${col} IS NOT NULL AND CHAR_LENGTH(${col}) = 32 AND ${col} NOT LIKE '$2%'`,
          { type: QueryTypes.SELECT, transaction },
        );
        for (const row of rows) {
          const wrapped = bcryptjs.hashSync(row.hash, BCRYPT_ROUNDS);
          await queryInterface.sequelize.query(
            `UPDATE ${table} SET ${col} = :wrapped WHERE ${pk} = :id`,
            { replacements: { wrapped, id: row.id }, type: QueryTypes.UPDATE, transaction },
          );
        }
      }
    }),

  down: (): Promise<void> => Promise.resolve(),
};
