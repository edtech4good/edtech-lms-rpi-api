import { QueryInterface, QueryTypes, Transaction } from "sequelize";

/**
 * The per-tier recognition setting on `curriculums`: what a learner receives for completing a level, a grade and the
 * whole curriculum. Central decides it and sends it in the content payload (`PUT /import/master`); this server stores it.
 *
 *   levelrecognition       none | award | certificate   default 'award'
 *   graderecognition       none | certificate           default 'certificate'
 *   curriculumrecognition  none | certificate           default 'none'
 *
 * VARCHAR(16) NOT NULL, with the charset and collation of the table's own text columns. Every existing curriculum takes
 * the defaults; no row is updated here (the next content sync from central sets the real values).
 *
 * Idempotent: a column that already exists is left alone, so a re-run, or one that stopped after some of the ALTERs
 * (MySQL commits each on its own), finishes the rest. Every read goes through this migration's own transaction
 * connection: a read on the pool while the transaction holds the only connection would wait for it forever.
 *
 * `down` drops the three columns that are there.
 */
const TABLE = "curriculums";

const COLUMNS: Array<{ name: string; defaultValue: string }> = [
  { name: "levelrecognition", defaultValue: "award" },
  { name: "graderecognition", defaultValue: "certificate" },
  { name: "curriculumrecognition", defaultValue: "none" },
];

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const described = await queryInterface.describeTable(TABLE, { transaction } as never);
      const [found] = (await queryInterface.sequelize.query(
        `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'curriculumname' LIMIT 1`,
        { replacements: [TABLE], type: QueryTypes.SELECT, transaction },
      )) as Array<{ cs?: string; coll?: string } | undefined>;
      const charset = found?.cs ?? "utf8mb4";
      const collate = found?.coll ?? "utf8mb4_unicode_ci";
      let added = 0;
      for (const { name, defaultValue } of COLUMNS) {
        if (described[name]) continue;
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${name}\` VARCHAR(16) CHARACTER SET ${charset} COLLATE ${collate} NOT NULL DEFAULT '${defaultValue}'`,
          { transaction },
        );
        added += 1;
      }
      console.log(`curriculum-recognition: ${added} column(s) added`);
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const described = await queryInterface.describeTable(TABLE, { transaction } as never);
      for (const { name } of COLUMNS) {
        if (described[name]) await queryInterface.removeColumn(TABLE, name, { transaction });
      }
    }),
};
