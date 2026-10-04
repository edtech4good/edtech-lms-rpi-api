/**
 * Ownership columns (`organisationid` on schools and content, `schoolid` on
 * students and schoolusers) are stored here but not yet sent anywhere: every
 * route, export and report that returns these models' rows must stay exactly
 * as it was, and a model returns every column it selects.
 *
 * So each of those models leaves the column out of EVERY query by default, in
 * addition to what a caller asks for. A caller that genuinely needs it (token
 * claims, the ownership import) reads it explicitly with
 * `Model.scope('withOwnership')`. Sequelize scopes REPLACE the default scope
 * rather than merging with it, and `withOwnership` is empty, so that scope
 * selects every column.
 *
 * Writes are unaffected: a scope only changes what is selected. Raw SQL that
 * selects `*` is not covered by this and is handled where it is written.
 */
import type { FindOptions } from "sequelize";

export const OWNERSHIP_COLUMNS = ["organisationid", "schoolid"] as const;

export const ownershipDefaultScope = (column: (typeof OWNERSHIP_COLUMNS)[number]): FindOptions => ({
  attributes: { exclude: [column] },
});
