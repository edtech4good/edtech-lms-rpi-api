/** What `information_schema.statistics` says about one index (columns in SEQ_IN_INDEX order). */
export interface ActualIndex {
  columns: string[];
  unique: boolean;
  /** SUB_PART per column: null for a whole-column entry, a number for a prefix index. */
  subParts: Array<number | null>;
  /** INDEX_TYPE: BTREE, FULLTEXT, SPATIAL, HASH. */
  type: string;
}

/** A plain index entry: BTREE, and the first `n` columns are whole columns (no prefix length). */
const plainFor = (a: ActualIndex, n: number): boolean => a.type.toUpperCase() === "BTREE" && a.subParts.slice(0, n).every((p) => p === null);

/**
 * Whether `existing` makes an index on `columns` redundant: it leads with the same columns, is BTREE, and none of those
 * columns is a prefix (SUB_PART) entry. A prefix-length, FULLTEXT, SPATIAL or HASH index does not cover.
 */
export function covers(existing: ActualIndex, columns: readonly string[]): boolean {
  return columns.every((c, i) => existing.columns[i] === c) && plainFor(existing, columns.length);
}

/** Whether a same-named index in the database is the declared one: same columns, uniqueness, BTREE, no prefix lengths. */
export function sameAsDeclared(actual: ActualIndex, columns: readonly string[], unique: boolean): boolean {
  return actual.columns.join(",") === columns.join(",") && actual.unique === unique && plainFor(actual, actual.columns.length);
}
