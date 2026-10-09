import { DataTypes, QueryInterface, QueryTypes, Transaction } from "sequelize";
import { addColumnIfMissing, removeColumnIfPresent } from "../migration-helpers";
import { assertNoViolations, RequiredColumn, relaxColumns, requireColumns } from "../required-columns";

/**
 * S-LI1 (learning items, design note section 5 and 11): the `lessonlearnings` row becomes a typed item.
 *
 *  - `lessonlearningtype` STRING(16) NOT NULL DEFAULT 'video': MySQL fills every existing row with the
 *    default as part of the ALTER, so every learning becomes a `video` item with the same id and no row
 *    is written by a statement (progress, sync and the app's routes key on the id and are untouched).
 *  - `lessonlearningbody` JSON NULL: the type's own body; null for `video`.
 *  - `documentid` becomes NULLable, keeping its type, collation and foreign key (an item of a later type
 *    may have no primary document; the API still requires one for every type whose rule says so).
 *
 * The nullability flip is driven by a LOCAL one-column list, not by `REQUIRED_COLUMNS`, so
 * `npm run db:check-owners` is untouched (this is not an owner column).
 *
 * ## Reports, changes nothing (decision 12 and decision 4's input)
 *
 * `up()` prints, as counts only: the lessons whose learnings tie on `lessonlearningorder` (the admin takes
 * the order as a typed number, so ties are possible; they are reported and NOT renumbered) and the
 * learnings that point at a document which is not a VIDEO document.
 *
 * ## Idempotence
 *
 * Each step checks before it acts, so a re-run is a no-op and one that stopped halfway finishes. MySQL DDL
 * commits implicitly, so the transaction cannot undo a half-applied run; the guards make a re-run safe.
 *
 * ## down() is guarded
 *
 * It throws, listing ids, and changes nothing, while any item has a type other than `video`, a body, or no
 * document (dropping the columns, or making `documentid` required again, would destroy or refuse it).
 * Otherwise it restores `documentid` NOT NULL and drops both columns. The link table (S-LI2) must be
 * undone first; undoing in migration order does that.
 */
const TABLE = "lessonlearnings";
const TYPE = "lessonlearningtype";
const BODY = "lessonlearningbody";
/** `documents.documenttypeid` of a VIDEO document. */
const VIDEO_DOCUMENT_TYPE_ID = 2;

/** How many offending ids a refusal lists. The count is always exact. */
const LISTED_IDS = 50;

const DOCUMENT_ID: readonly RequiredColumn[] = [{ table: TABLE, column: "documentid", pk: "lessonlearningid" }];

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
  const ties = await count(
    queryInterface,
    `SELECT COUNT(*) AS n FROM (SELECT 1 FROM \`${TABLE}\` GROUP BY lessonid, lessonlearningorder HAVING COUNT(*) > 1) t`,
    transaction,
  );
  const notVideo = await count(
    queryInterface,
    `SELECT COUNT(*) AS n FROM \`${TABLE}\` l JOIN documents d ON d.documentid = l.documentid WHERE d.documenttypeid <> ${VIDEO_DOCUMENT_TYPE_ID}`,
    transaction,
  );
  console.log(`S-LI1 ${TABLE}: lessons_with_order_ties=${ties} learnings_on_a_non_video_document=${notVideo} (reported, nothing changed)`);
}

/** The ids that make `down()` refuse, per rule. Reads only. */
async function offenders(queryInterface: QueryInterface, transaction: Transaction): Promise<Array<{ rule: string; count: number; ids: string[] }>> {
  const checks: Array<{ rule: string; column: string; where: string }> = [
    { rule: `a type other than 'video'`, column: TYPE, where: `\`${TYPE}\` <> 'video'` },
    { rule: "a body", column: BODY, where: `\`${BODY}\` IS NOT NULL` },
    { rule: "no document", column: "documentid", where: "`documentid` IS NULL" },
  ];
  const out: Array<{ rule: string; count: number; ids: string[] }> = [];
  for (const check of checks) {
    if (!(await columnExists(queryInterface, check.column, transaction))) continue;
    const n = await count(queryInterface, `SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE ${check.where}`, transaction);
    if (n === 0) continue;
    const rows = (await queryInterface.sequelize.query(
      `SELECT lessonlearningid AS id FROM \`${TABLE}\` WHERE ${check.where} ORDER BY lessonlearningid LIMIT ${LISTED_IDS}`,
      { type: QueryTypes.SELECT, transaction },
    )) as Array<{ id: string }>;
    out.push({ rule: check.rule, count: n, ids: rows.map((r) => String(r.id)) });
  }
  return out;
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(
        queryInterface,
        TABLE,
        TYPE,
        { type: DataTypes.STRING(16), allowNull: false, defaultValue: "video" },
        transaction,
      );
      await addColumnIfMissing(queryInterface, TABLE, BODY, { type: DataTypes.JSON, allowNull: true }, transaction);
      await relaxColumns(queryInterface, DOCUMENT_ID, transaction);
      await report(queryInterface, transaction);
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const broken = await offenders(queryInterface, transaction);
      if (broken.length > 0) {
        const lines = broken.map((b) => `${TABLE}: ${b.count} item(s) with ${b.rule} (${b.ids.length < b.count ? `first ${b.ids.length}` : "all"}): ${b.ids.join(", ")}`);
        throw new Error(
          `S-LI1 down() refused: ${broken.length} rule(s) are broken by items that the old schema cannot hold, so nothing was changed.\n` +
            `${lines.join("\n")}\n` +
            "Remove or convert those items (a person's decision), then run this migration's down again.",
        );
      }
      // The guard above holds, but the helpers check again and leave the column untouched on a violation.
      await assertNoViolations(queryInterface, "S-LI1 down()", DOCUMENT_ID, transaction);
      await requireColumns(queryInterface, DOCUMENT_ID, transaction);
      await removeColumnIfPresent(queryInterface, TABLE, BODY, transaction);
      await removeColumnIfPresent(queryInterface, TABLE, TYPE, transaction);
    }),
};
