import { QueryInterface, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

/**
 * `standards` has declared a `created_at` attribute in the model for a
 * while, but `server.ts` only ever runs a plain `sequelize.sync()` at boot
 * (never an ALTER), so any Pi provisioned before that model change is
 * missing the column on disk. The sync endpoint (PUT /import/master) then
 * fails bulk-inserting standards with "Unknown column 'created_at' in
 * 'field list'".
 *
 * `updated_at` is added alongside it even though the model does not
 * reference it yet, to match the column set already applied by hand on
 * local dev (TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP) and avoid a second
 * drift the next time the model picks it up.
 *
 * Every other content-table model used by the sync import path
 * (curriculums, curriculumbaseline, baselinequestion, grades, levels,
 * lessons, lessonlearnings, lessonquizzes, lessonpractices,
 * lessonpracticequestions, lessonquizquestions, levelquizquestions,
 * questions, documents, schools, countries, lessonplans, subjects) has
 * `timestamps: false` and no explicit created_at/updated_at attribute, so
 * none of them are exposed to this same drift.
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
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      for (const column of ["created_at", "updated_at"]) {
        await queryInterface.removeColumn("standards", column, { transaction });
      }
    }),
};
