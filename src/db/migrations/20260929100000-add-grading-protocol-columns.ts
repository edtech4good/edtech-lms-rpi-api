import { QueryInterface, DataTypes, Transaction } from "sequelize";
import { addColumnIfMissing } from "../migration-helpers";

/**
 * workspace#79 step 1b: storage for the server-grading protocol.
 *
 * studentprogressquestions gets three new columns per submitted item:
 *  - answer: the raw AnswerV1 JSON the client sent (null if it sent none —
 *    every pre-protocol client, and any item an app still doesn't cover).
 *  - clientiscorrect: the client's own claimed verdict, preserved as-is
 *    regardless of GRADING_MODE (the existing `iscorrect` column becomes the
 *    mode-dependent "used for scoring" value once this ships).
 *  - servergrade: 'correct' | 'incorrect' | 'ungradable', null only when
 *    there was no active question to grade against at all.
 *
 * studentprogress gets `verified`: true only when every active, renderable
 * question in the activity got a gradable server grade. Defaults to false;
 * existing rows are NOT backfilled (there is nothing to grade them against
 * retroactively — see the PR description).
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await addColumnIfMissing(
        queryInterface,
        "studentprogressquestions",
        "answer",
        {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "studentprogressquestions",
        "clientiscorrect",
        {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "studentprogressquestions",
        "servergrade",
        {
          type: DataTypes.ENUM("correct", "incorrect", "ungradable"),
          allowNull: true,
          defaultValue: null,
        },
        transaction,
      );
      await addColumnIfMissing(
        queryInterface,
        "studentprogress",
        "verified",
        {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        transaction,
      );
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn("studentprogress", "verified", { transaction });
      await queryInterface.removeColumn("studentprogressquestions", "servergrade", { transaction });
      await queryInterface.removeColumn("studentprogressquestions", "clientiscorrect", { transaction });
      await queryInterface.removeColumn("studentprogressquestions", "answer", { transaction });
      // MySQL leaves the servergrade ENUM type attached to nothing once the
      // column is dropped (no separate type object to clean up, unlike
      // Postgres) — nothing further to do here.
    }),
};
