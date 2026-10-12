import { DataTypes, QueryInterface, QueryTypes, Transaction } from "sequelize";
import { addColumnIfMissing, removeColumnIfPresent } from "../migration-helpers";

/**
 * S-ML1 (media library phase 0, design note sections 6, 8 and 12): a document gets a display title, a licence
 * and an attribution, beside its storage key.
 *
 *  - `documenttitle` STRING(255) NULL: what to show for the file; null means "show `documentname`", which stays
 *    the storage key and keeps its meaning.
 *  - `documentlicence` STRING(64) NOT NULL DEFAULT 'unspecified': one id of a closed list in code
 *    (src/constants/media-library.ts). MySQL fills every existing row with the default as part of the ALTER, so no
 *    statement updates a row (as S-LI1 did for `lessonlearningtype`).
 *  - `documentattribution` JSON NULL: a versioned object, `{ "v": 1, "author": ..., "sourceurl": ..., "adaptedfrom": ... }`.
 *
 * Added with the table's own character set and collation (`addColumn` names none), no index (a title search is
 * `LIKE %..%`), and not an owner column, so `REQUIRED_COLUMNS` and `db:check-owners` are untouched.
 *
 * ## Reports, changes nothing
 *
 * `up()` prints, as counts only: the documents per `documenttypeid`, and the documents whose `documentname` does not
 * fit the old upload rule (letters, digits and underscores, at most 25, then one extension) that a key made from the
 * original name had to follow. Both are for the operator; no row is touched because of them.
 *
 * ## Idempotence
 *
 * Each step checks before it acts, so a re-run is a no-op and one that stopped halfway finishes. MySQL DDL commits
 * implicitly, so the transaction cannot undo a half-applied run; the guards make a re-run safe.
 *
 * ## down() is guarded
 *
 * It throws, listing ids (at most 50 per rule), and changes nothing, while any document has a title, an attribution,
 * or a licence other than 'unspecified' (dropping the columns would destroy it). Otherwise it drops the three columns.
 */
const TABLE = "documents";
const TITLE = "documenttitle";
const LICENCE = "documentlicence";
const ATTRIBUTION = "documentattribution";
const UNSPECIFIED = "unspecified";

/** How many offending ids a refusal lists. The count is always exact. */
const LISTED_IDS = 50;

const count = async (queryInterface: QueryInterface, sql: string, transaction: Transaction): Promise<number> => {
  const rows = (await queryInterface.sequelize.query(sql, { type: QueryTypes.SELECT, transaction })) as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0);
};

async function columnExists(queryInterface: QueryInterface, column: string, transaction: Transaction): Promise<boolean> {
  const rows = (await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [TABLE, column], type: QueryTypes.SELECT, transaction },
  )) as Array<{ n: number | string }>;
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Counts only, never names or ids. */
async function report(queryInterface: QueryInterface, transaction: Transaction): Promise<void> {
  const perType = (await queryInterface.sequelize.query(
    `SELECT documenttypeid AS type, COUNT(*) AS n FROM \`${TABLE}\` GROUP BY documenttypeid ORDER BY documenttypeid`,
    { type: QueryTypes.SELECT, transaction },
  )) as Array<{ type: number | string; n: number | string }>;
  const byType = perType.length === 0 ? "none" : perType.map((r) => `${r.type}:${Number(r.n)}`).join(",");
  const failing = await count(
    queryInterface,
    `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE NOT REGEXP_LIKE(documentname, '^[a-zA-Z0-9_]{1,25}[.][^.]*$', 'c')`,
    transaction,
  );
  console.log(`S-ML1 ${TABLE}: documents_by_documenttypeid=${byType} names_failing_the_old_upload_rule=${failing} (reported, nothing changed)`);
}

/** The ids that make `down()` refuse, per rule. Reads only. */
async function offenders(queryInterface: QueryInterface, transaction: Transaction): Promise<Array<{ rule: string; count: number; ids: string[] }>> {
  const checks: Array<{ rule: string; column: string; where: string }> = [
    { rule: "a title", column: TITLE, where: `\`${TITLE}\` IS NOT NULL` },
    { rule: `a licence other than '${UNSPECIFIED}'`, column: LICENCE, where: `\`${LICENCE}\` <> '${UNSPECIFIED}'` },
    { rule: "an attribution", column: ATTRIBUTION, where: `\`${ATTRIBUTION}\` IS NOT NULL` },
  ];
  const out: Array<{ rule: string; count: number; ids: string[] }> = [];
  for (const check of checks) {
    if (!(await columnExists(queryInterface, check.column, transaction))) continue;
    const n = await count(queryInterface, `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE ${check.where}`, transaction);
    if (n === 0) continue;
    const rows = (await queryInterface.sequelize.query(
      `SELECT documentid AS id FROM \`${TABLE}\` WHERE ${check.where} ORDER BY documentid LIMIT ${LISTED_IDS}`,
      { type: QueryTypes.SELECT, transaction },
    )) as Array<{ id: string }>;
    out.push({ rule: check.rule, count: n, ids: rows.map((r) => String(r.id)) });
  }
  return out;
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(queryInterface, TABLE, TITLE, { type: DataTypes.STRING(255), allowNull: true, defaultValue: null }, transaction);
      await addColumnIfMissing(queryInterface, TABLE, LICENCE, { type: DataTypes.STRING(64), allowNull: false, defaultValue: UNSPECIFIED }, transaction);
      await addColumnIfMissing(queryInterface, TABLE, ATTRIBUTION, { type: DataTypes.JSON, allowNull: true, defaultValue: null }, transaction);
      await report(queryInterface, transaction);
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const broken = await offenders(queryInterface, transaction);
      if (broken.length > 0) {
        const lines = broken.map((b) => `${TABLE}: ${b.count} document(s) with ${b.rule} (${b.ids.length < b.count ? `first ${b.ids.length}` : "all"}): ${b.ids.join(", ")}`);
        throw new Error(
          `S-ML1 down() refused: ${broken.length} rule(s) are broken by documents that the old schema cannot hold, so nothing was changed.\n` +
            `${lines.join("\n")}\n` +
            "Clear those values (a person's decision), then run this migration's down again.",
        );
      }
      await removeColumnIfPresent(queryInterface, TABLE, ATTRIBUTION, transaction);
      await removeColumnIfPresent(queryInterface, TABLE, LICENCE, transaction);
      await removeColumnIfPresent(queryInterface, TABLE, TITLE, transaction);
    }),
};
