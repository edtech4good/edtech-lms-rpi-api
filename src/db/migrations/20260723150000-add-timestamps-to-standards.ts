import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

/**
 * Sync-path schema drift, attribute-complete.
 *
 * `server.ts` only ever runs a plain `sequelize.sync()` at boot (never an
 * ALTER), so any Pi model attribute added after a table was first created
 * never lands on disk for aged Pis. PUT /import/master (full content sync)
 * walks every content table and fails on the first column a given Pi is
 * missing, so bugs here surface one at a time as each is fixed — this
 * migration accumulates every drift found so far rather than one per bug.
 *
 * Audited EVERY table imported by completesync — model's initModel column
 * list (src/models/data-models/*.ts) vs. the live table's SHOW COLUMNS —
 * not just timestamp attributes. Two drifts found:
 *
 * 1. `standards.created_at` (and `updated_at`, added preemptively — see
 *    below) — "Unknown column 'created_at' in 'field list'" on bulk-insert.
 * 2. `countries.expectedusage` — model declares
 *    `DataTypes.DOUBLE.UNSIGNED, allowNull: true` (same shape as
 *    `schools.expectedusage`, which IS present on disk) but aged `countries`
 *    tables predate the attribute. Shadowed until now because the
 *    unfixed import order (see import.controller.ts) died on the standards
 *    FK/column errors before countries.bulkCreate ever ran.
 *
 * `standards.updated_at` is added alongside created_at even though the
 * model does not reference it yet, to match the column set already applied
 * by hand on local dev (TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP) and avoid
 * a second drift the next time the model picks it up.
 *
 * Every other content-table model used by the sync import path
 * (curriculums, curriculumbaseline, baselinequestion, grades, levels,
 * lessons, lessonlearnings, lessonquizzes, lessonpractices,
 * lessonpracticequestions, lessonquizquestions, levelquizquestions,
 * questions, documents, schools, lessonplans, subjects) was compared
 * column-by-column against its live table and found to already match the
 * model — no further drift as of this audit.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const now = queryInterface.sequelize.Sequelize.fn("NOW");

      await addColumnIfMissing(
        queryInterface,
        "standards",
        "created_at",
        {
          type: "TIMESTAMP",
          defaultValue: now,
          allowNull: true,
        },
        transaction,
      );

      await addColumnIfMissing(
        queryInterface,
        "standards",
        "updated_at",
        {
          type: "TIMESTAMP",
          defaultValue: now,
          allowNull: true,
        },
        transaction,
      );

      await addColumnIfMissing(
        queryInterface,
        "countries",
        "expectedusage",
        {
          // Mirrors the countries model's initModel definition exactly
          // (src/models/data-models/countries.ts), and matches the
          // already-present schools.expectedusage column shape.
          type: DataTypes.DOUBLE.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      for (const column of ["created_at", "updated_at"]) {
        await queryInterface.removeColumn("standards", column, { transaction });
      }
      await queryInterface.removeColumn("countries", "expectedusage", {
        transaction,
      });
    }),
};
