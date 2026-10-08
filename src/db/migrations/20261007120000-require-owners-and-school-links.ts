import { QueryInterface, Transaction } from "sequelize";
import { assertNoViolations, relaxColumns, REQUIRED_COLUMNS, requireColumns } from "../required-columns";

/**
 * S4 of the multi-organisation model on the student API: the owner and school
 * columns become NOT NULL. A school always belongs to an organisation, a piece
 * of content always has an owner, and a learner and a school login always belong
 * to a school:
 *
 *  - `organisationid` on `schools`, `curriculums`, `questions`, `documents` and
 *    `subjects`;
 *  - `schoolid` on `students` and `schoolusers`.
 *
 * The columns, their indexes and their foreign keys (S2) already exist; this
 * only tightens them. NO DATA IS WRITTEN: whatever gives a row its owner (a
 * format-3 content import, the ownership import, the provisioning of a
 * classroom server) has to have run first.
 *
 * ## The guard
 *
 * Before any DDL, `up()` counts the rows of the seven columns that are NULL
 * (soft-deleted rows included: an id is identity, not liveness). If there are
 * any it throws, with the count per column and the primary keys of the
 * offending rows (ids only, never names, at most 50 per column), and changes
 * nothing. `npm run db:check-owners` prints the same counts without migrating:
 * the pre-flight an operator runs before deploying.
 *
 * ## The change
 *
 * `MODIFY COLUMN ... NOT NULL`, with the type, charset and collation the column
 * really has (information_schema), so each foreign key keeps agreeing with
 * `organisations.organisationid` / `schools.schoolid`. The connection is put in
 * strict SQL mode for the MODIFYs and restored afterwards, so a row inserted
 * between the guard and a MODIFY makes MySQL refuse that MODIFY instead of
 * turning its NULL into ''. Each column is skipped when it is already required:
 * a re-run on tightened tables is a no-op and a run that stopped halfway
 * finishes. Each MODIFY rebuilds its table in place (no blocked reads).
 *
 * ## down()
 *
 * Makes the seven columns nullable again, in reverse order. It writes no data.
 * Roll the code back after it, not before: older code that inserts a row with
 * no owner fails while the columns are still required.
 */
module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await assertNoViolations(queryInterface, "S4 (require owners and school links)", REQUIRED_COLUMNS, transaction);
      await requireColumns(queryInterface, REQUIRED_COLUMNS, transaction);
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      await relaxColumns(queryInterface, REQUIRED_COLUMNS, transaction);
    }),
};
