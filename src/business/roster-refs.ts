import { Op, Transaction } from "sequelize";
import { standards } from "src/models/data-models/standards";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { curriculums, grades, lessons, levels, students } from "src/models/data-models/init-models";

/**
 * A roster (`PUT /import/students`) that names a class, a curriculum, a grade, a level, a lesson or a learner this
 * server does not hold. The database holds a foreign key from each of those columns (see `src/db/foreign-keys.ts`), so
 * such a roster is refused here, before anything is written, with a message that names the row, instead of surfacing
 * as the database's own refusal ("Invalid file").
 */
export class RosterRowsError extends ApiError {}

/** How many offending rows a refusal lists; the rest are counted. */
export const LISTED_ROWS = 10;
/** How many ids go into one `IN` lookup. */
const LOOKUP_CHUNK = 500;

type Row = Record<string, unknown>;
type Holder = { findAll: (options: object) => Promise<object[]> };

/**
 * An id as the database compares it: the columns' collation ignores letter case and pads with spaces, so trailing spaces
 * do not tell two ids apart. A missing or non-text value names nothing (so does one that is only spaces).
 */
const idOf = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const id = value.replace(/ +$/, "").toLowerCase();
  return id.length > 0 ? id : null;
};

const rowsOf = (list: unknown): Row[] => (Array.isArray(list) ? (list as Row[]).filter((r) => r !== null && typeof r === "object") : []);

/** The ids (lower case) among `ids` that `model` holds under `key`: soft-deleted rows count as held, as they do for the key. */
async function held(model: Holder, key: string, ids: Iterable<string>, transaction: Transaction): Promise<Set<string>> {
  const all = [...ids];
  const found = new Set<string>();
  for (let at = 0; at < all.length; at += LOOKUP_CHUNK) {
    const rows = (await model.findAll({
      attributes: [key],
      where: { [key]: { [Op.in]: all.slice(at, at + LOOKUP_CHUNK) } },
      transaction,
      raw: true,
    })) as Row[];
    for (const row of rows) {
      const id = idOf(row[key]);
      if (id !== null) found.add(id);
    }
  }
  return found;
}

/** "students row 3: class; students row 7: class, and 4 more" */
const listRows = (lines: string[]): string => {
  const shown = lines.slice(0, LISTED_ROWS).join("; ");
  return lines.length > LISTED_ROWS ? `${shown}, and ${lines.length - LISTED_ROWS} more` : shown;
};

const refuse = (what: string, field: string, lines: string[], hint: string): RosterRowsError => {
  const message = `That roster has ${what} this server doesn't have (${listRows(lines)}). Nothing was written.`;
  return new RosterRowsError(ErrorCode.INVALID_INPUT, { message, hint, fields: [{ field, message }] });
};

/**
 * The class (`students.standard`) of every learner row must be a class this server holds. A learner with no class
 * (absent or null) is fine; an empty string or a value that is not text names no class. Runs before any row is
 * written; asks the database nothing when no learner names a class. Rows are named by their position in the file
 * (1 is the first), never by an id or a name.
 */
export async function assertRosterClassesKnown(rosterRows: ReadonlyArray<{ student?: unknown } | null | undefined>, transaction: Transaction): Promise<void> {
  const named = new Set<string>();
  const given = rosterRows.map((row) => {
    const standard = (row?.student as Row | null | undefined)?.standard;
    if (standard === undefined || standard === null) return { given: false, id: null };
    const id = idOf(standard);
    if (id !== null) named.add(id);
    return { given: true, id };
  });
  if (!given.some((g) => g.given)) return;
  const known = named.size === 0 ? new Set<string>() : await held(standards, "standardid", named, transaction);
  const lines: string[] = [];
  given.forEach((g, at) => {
    if (g.given && (g.id === null || !known.has(g.id))) lines.push(`students row ${at + 1}: class`);
  });
  if (lines.length > 0) {
    throw refuse("learners in a class", "standard", lines, "Bring the school's classes to this server first (sync the content), then send the roster again.");
  }
}

/** A usable id of a curriculum list, as `content-access.ts` reads one: text, 1 to 64 long. */
const usableListId = (value: unknown): boolean => typeof value === "string" && value.length > 0 && value.length <= 64;

/**
 * The curriculum list of every learner row (`students.curriculumids`). The content guard reads only that list, so a
 * learner who arrives with it NULL, absent or empty is locked out of every route even though `curriculumid` is set. A
 * row with `curriculumid` and no usable list is therefore stored with `curriculumids = [curriculumid]`; a row with a
 * usable list is left as it is; a row with neither names no curriculum, and the roster is refused, by row position as
 * the other roster checks do, before anything is written. Returns the rows to write (copies; the input is not
 * changed) and how many were given their list from `curriculumid`, which the import report states.
 */
export function withCurriculumLists<T extends { student?: unknown } | null | undefined>(rosterRows: ReadonlyArray<T>): { rows: T[]; filled: number } {
  let filled = 0;
  const lines: string[] = [];
  const rows = rosterRows.map((row, at) => {
    const student = (row as { student?: unknown } | null | undefined)?.student as Row | null | undefined;
    const list = student?.curriculumids;
    if (Array.isArray(list) && list.some(usableListId)) return row;
    const curriculumid = student?.curriculumid;
    if (typeof curriculumid !== "string" || curriculumid.trim().length === 0) {
      lines.push(`students row ${at + 1}: curriculum`);
      return row;
    }
    filled += 1;
    return { ...row, student: { ...student, curriculumids: [curriculumid] } } as T;
  });
  if (lines.length > 0) {
    const message = `That roster has learners with no curriculum (${listRows(lines)}). Nothing was written.`;
    throw new RosterRowsError(ErrorCode.INVALID_INPUT, {
      message,
      hint: "Give each learner a curriculumid or a curriculumids list, then send the roster again.",
      fields: [{ field: "curriculumid", message }],
    });
  }
  return { rows, filled };
}

interface ProgressTable {
  table: "studentgradesprogress" | "studentlevelsprogress" | "studentlessonsprogress";
  /** column -> what a person calls what it points at */
  refs: Array<{ column: string; word: string; model: Holder; key: string }>;
}
const CURRICULUM = (column: string) => ({ column, word: "curriculum", model: curriculums as Holder, key: "curriculumid" });
const GRADE = { column: "gradeid", word: "grade", model: grades as Holder, key: "gradeid" };
const LEVEL = { column: "levelid", word: "level", model: levels as Holder, key: "levelid" };
const LESSON = { column: "lessonid", word: "lesson", model: lessons as Holder, key: "lessonid" };

/** The progress tables a roster carries that point at content (and at a learner). Each column is a foreign key in the database. */
const PROGRESS_TABLES: ProgressTable[] = [
  { table: "studentgradesprogress", refs: [CURRICULUM("curriculumid"), GRADE] },
  { table: "studentlevelsprogress", refs: [CURRICULUM("curid"), GRADE, LEVEL] },
  { table: "studentlessonsprogress", refs: [CURRICULUM("curid"), GRADE, LEVEL, LESSON] },
];

/**
 * Every grade, level and lesson progress row of a roster must name a curriculum, grade, level and lesson this server
 * holds, and a learner that is either one of the roster's own learner rows or already here. Runs before any row is
 * written; asks the database nothing for a table the roster carries no rows of. Content that was deleted here but is
 * still stored counts as held: a learner's history of it is kept. A missing or non-text value names nothing. Rows are
 * named by table and position in that table's list (1 is the first) with the word for what is missing, never an id.
 */
export async function assertRosterProgressKnown(
  rosterRows: ReadonlyArray<{ student?: unknown } | null | undefined>,
  progresses: unknown,
  transaction: Transaction,
): Promise<void> {
  const lists = PROGRESS_TABLES.map((t) => ({ ...t, rows: rowsOf((progresses as Record<string, unknown> | null | undefined)?.[t.table]) }));
  if (lists.every((l) => l.rows.length === 0)) return;

  // what the roster names, per content table
  const named = new Map<Holder, { key: string; ids: Set<string> }>();
  const learners = new Set<string>();
  for (const list of lists) {
    for (const row of list.rows) {
      for (const ref of list.refs) {
        const id = idOf(row[ref.column]);
        if (id === null) continue;
        const entry = named.get(ref.model) ?? { key: ref.key, ids: new Set<string>() };
        entry.ids.add(id);
        named.set(ref.model, entry);
      }
      const learner = idOf(row.studentid);
      if (learner !== null) learners.add(learner);
    }
  }
  // the ones this server holds (the roster's own learner rows are written by the same request)
  const heldBy = new Map<Holder, Set<string>>();
  for (const [model, { key, ids }] of named) heldBy.set(model, await held(model, key, ids, transaction));
  const own = new Set(rosterRows.map((r) => idOf((r?.student as Row | null | undefined)?.studentid)).filter((id): id is string => id !== null));
  const elsewhere = [...learners].filter((id) => !own.has(id));
  const knownLearners = new Set([...own, ...(elsewhere.length === 0 ? [] : await held(students, "studentid", elsewhere, transaction))]);

  const lines: string[] = [];
  for (const list of lists) {
    list.rows.forEach((row, at) => {
      const words = list.refs
        .filter((ref) => {
          const id = idOf(row[ref.column]);
          return id === null || !heldBy.get(ref.model)?.has(id);
        })
        .map((ref) => ref.word);
      const learner = idOf(row.studentid);
      if (learner === null || !knownLearners.has(learner)) words.push("learner");
      if (words.length > 0) lines.push(`${list.table} row ${at + 1}: ${[...new Set(words)].join(", ")}`);
    });
  }
  if (lines.length > 0) {
    throw refuse(
      "progress for content or learners",
      "studentprogresses",
      lines,
      "Bring the content to this server first (sync the content), then send the roster again.",
    );
  }
}
