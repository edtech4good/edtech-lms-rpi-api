import { col, fn, literal, Op, Transaction, where as sqlWhere, WhereOptions } from "sequelize";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";

/**
 * Learners (`students`) and school logins (`schoolusers`) carry both their
 * school's NAME and its ID. Every reader here works with the ID, because the id
 * is the identity: two organisations can later have a school of the same name.
 * A client that still sends a name (a query parameter, a path segment, a token
 * from before the id claim) is understood: the name is resolved to an id ONCE,
 * here, at the boundary, and nothing below it looks a school up by name.
 *
 * ## When is a given name a school's name?
 *
 * Two names are the same when they are the same text after trimming surrounding
 * whitespace, Unicode NFC normalisation and lower-casing, applied to the given
 * AND the stored name (the rule the central API's writers use). A name that
 * differs by a Khmer mark, an accent or anything else is a different school.
 *
 * `schools.schoolname`'s own collation is NOT the judge: it ignores trailing
 * spaces and gives several Khmer marks no weight, so two different names can
 * compare equal. The database only narrows the candidates
 * (`WHERE TRIM(schoolname) = ?`); the answer is the candidate that passes the
 * comparison above.
 *
 * ## Namesakes
 *
 * A READ asks for what is there to look at: when more than one school matches
 * and exactly one of them is live, that one is the answer (a soft-deleted
 * namesake stays reachable by its id). Two live matches are ambiguous: a 400.
 * A WRITE (the roster imports) never guesses: any second match fails.
 * Names are unique today, so neither is reachable; both are pinned by specs.
 */
export const normaliseSchoolName = (name: string): string => name.trim().normalize("NFC").toLowerCase();

export const isSameSchoolName = (stored: unknown, given: unknown): boolean => {
  if (typeof stored !== "string" || typeof given !== "string") {
    return false;
  }
  const a = normaliseSchoolName(stored);
  return a.length > 0 && a === normaliseSchoolName(given);
};

/** A school reference counts as given only when it is a real, non-blank string. */
export const isGiven = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const ambiguousName = (field: string) =>
  new ApiError(ErrorCode.INVALID_INPUT, {
    message: "That school name matches more than one school.",
    fields: [{ field, message: "That school name matches more than one school." }],
  });

type Candidate = { schoolid: string; schoolname: string; isdeleted: boolean };

/** The schools whose stored name is `schoolname` under the text rule above (live or soft-deleted). */
async function sameNameCandidates(schoolname: string, transaction?: Transaction): Promise<Candidate[]> {
  const found = await schools.findAll({
    where: sqlWhere(fn("TRIM", col("schoolname")), schoolname.trim().normalize("NFC")),
    attributes: ["schoolid", "schoolname", "isdeleted"],
    transaction,
  });
  return found
    .filter((s) => isSameSchoolName(s.schoolname, schoolname))
    .map((s) => ({ schoolid: s.schoolid, schoolname: s.schoolname, isdeleted: Boolean(s.isdeleted) }));
}

export interface FindByNameOptions {
  /** Only live schools can be the answer (a soft-deleted school is "not found"). */
  liveOnly?: boolean;
  /** The request field named in a 400, when the name is ambiguous. */
  field?: string;
  /** A writer: any second match is ambiguous, live or not. */
  strict?: boolean;
  transaction?: Transaction;
}

/**
 * The id of the school a given name refers to, or null when it names no school
 * (or is not a real, non-blank string). Throws a 400 when it refers to more than
 * one.
 */
export async function findSchoolIdByName(name: unknown, options: FindByNameOptions = {}): Promise<string | null> {
  if (!isGiven(name)) {
    return null;
  }
  let same = await sameNameCandidates(name, options.transaction);
  if (options.liveOnly) {
    same = same.filter((s) => !s.isdeleted);
  }
  if (same.length > 1 && !options.strict) {
    same = same.filter((s) => !s.isdeleted);
  }
  if (same.length > 1) {
    throw ambiguousName(options.field ?? "schoolname");
  }
  return same.length === 1 ? same[0].schoolid : null;
}

/**
 * What a route that is handed a school reference makes of it:
 *  - a `schoolid` given: that id (whether or not a school has it; an id that
 *    names nothing matches no rows, as an unknown name always did) — it wins when
 *    both are sent;
 *  - else a `schoolname` given: the id of the school it names, or `null` when it
 *    names none; ambiguous: 400;
 *  - neither given (absent, blank, or not a string): `undefined`, meaning no
 *    school filter.
 */
export async function resolveSchoolRef(
  ref: { schoolid?: unknown; schoolname?: unknown },
  options: FindByNameOptions = {},
): Promise<string | null | undefined> {
  if (isGiven(ref.schoolid)) {
    return ref.schoolid.trim();
  }
  if (isGiven(ref.schoolname)) {
    return findSchoolIdByName(ref.schoolname, options);
  }
  return undefined;
}

/**
 * The school a reader scopes its rows by. Normally an id. When the caller's
 * school resolves to NO school row (a learner whose school has not reached this
 * server yet: rosters arrive before the master sync that brings the schools), the
 * reader uses the school NAME exactly as it did before ids existed, so the
 * window behaves as it always did. When the name DOES resolve to a school, the
 * id alone is used: never both (a name-or-id filter would merge two schools that
 * share a name).
 */
export type SchoolScope = { schoolid: string } | { schoolname: string | null };

/** What a token with no school at all matched before ids: learners whose name is the empty string. */
export const NO_SCHOOL_NAME: SchoolScope = { schoolname: "" };

/**
 * The `where` for a scope, on `students` or `standards` (both carry `schoolid` and `schoolname`).
 * The name fallback only ever reads rows that have NO school id: those are exactly the rows of a
 * school that has not arrived yet, and a row that has an id belongs to a school by id, so it can
 * never be reached through a name (the column collation calls some different names equal).
 */
export const schoolPredicate = (scope: SchoolScope): WhereOptions =>
  "schoolid" in scope ? { schoolid: scope.schoolid } : { schoolid: null, schoolname: scope.schoolname };

/**
 * A school named by a request (query parameter, filter) as a scope:
 *  - a `schoolid` given: that id, which wins when both are sent;
 *  - else a `schoolname` given: the id of the school it names, or, when it names
 *    no school, the name itself (the legacy predicate); ambiguous: 400;
 *  - neither given (absent, blank, or not a string): `undefined`, no school filter.
 */
export async function resolveSchoolScope(
  ref: { schoolid?: unknown; schoolname?: unknown },
  options: FindByNameOptions = {},
): Promise<SchoolScope | undefined> {
  if (isGiven(ref.schoolid)) {
    return { schoolid: ref.schoolid.trim() };
  }
  if (isGiven(ref.schoolname)) {
    const schoolid = await findSchoolIdByName(ref.schoolname, options);
    return schoolid ? { schoolid } : { schoolname: ref.schoolname };
  }
  return undefined;
}

/**
 * The school a learner or teacher token belongs to. A token issued since the id
 * claim carries `schoolid`, and that is used as it stands. An older token has
 * only `schoolname`, which is resolved to an id here (or, if no school has it
 * yet, used as the name). `undefined` when the token names no school at all.
 */
export const schoolScopeFromToken = (user: Pick<Token, "schoolid" | "schoolname"> | undefined): Promise<SchoolScope | undefined> =>
  resolveSchoolScope({ schoolid: user?.schoolid, schoolname: user?.schoolname });

/**
 * The school a school login belongs to, for a reader that has the login's id
 * and name but not a token: the school id stored on the login row, then on the
 * learner row; only when neither is filled is the login's name resolved (and,
 * if no school has it yet, used as the name).
 */
export async function schoolScopeOfLogin(schooluserid: string, schoolname?: string | null): Promise<SchoolScope> {
  const login = await schoolusers.scope("withOwnership").findOne({ where: { schooluserid }, attributes: ["schoolid"] });
  if (login?.schoolid) {
    return { schoolid: login.schoolid };
  }
  const learner = await students.scope("withOwnership").findOne({ where: { schooluserid }, attributes: ["schoolid"] });
  if (learner?.schoolid) {
    return { schoolid: learner.schoolid };
  }
  const schoolid = await findSchoolIdByName(schoolname);
  return schoolid ? { schoolid } : { schoolname: schoolname ?? null };
}

/** The `where` that limits `students` to a school (see `SchoolScope`). */
export const studentsOfSchool = (scope: SchoolScope): WhereOptions => schoolPredicate(scope);

/**
 * The `where` that limits `schools` to the school a learner is in, by the
 * learner's stored `schoolid`. The id is read inside the same statement (a
 * learner's row does not carry it to the code: it is left out of every default
 * read), so no extra query is made and nothing new reaches the response. A
 * learner with no school, or no learner, matches no school.
 */
export const schoolOfStudent = (studentid: unknown): WhereOptions =>
  isGiven(studentid)
    ? {
        schoolid: {
          [Op.eq]: literal(
            `(SELECT s.schoolid FROM students AS s WHERE s.studentid = ${dbinstance.getdbinstance().escape(studentid)} LIMIT 1)`,
          ),
        },
      }
    : { schoolid: { [Op.in]: [] } };

/**
 * Sets `schoolid` on roster rows about to be written (learners, school logins,
 * teachers), inside the importer's transaction, so a row's id always follows the
 * school its name says it is in (a learner who moves school gets the new id with
 * the new name, and the id is never left stale).
 *
 *  - a row that carries BOTH a `schoolid` of a school that exists and a
 *    `schoolname`: the name must be that school's name under the text rule above,
 *    or the whole write fails with a 400 (the payload contradicts itself);
 *  - a row that carries only a `schoolid` of a school that exists keeps it;
 *  - otherwise the row's `schoolname` is resolved (once per distinct name) to a
 *    school's id; a name that matches two schools fails the whole write;
 *  - otherwise (no school given, a name that matches none here, an id of a
 *    school this server does not have) the row's `schoolid` is NULL in the result.
 *    The writers do not take that result: `schoolid` is a required column (S4),
 *    so they use `withRequiredSchoolIds`, which refuses the whole write instead.
 *
 * The name is stored as it was sent; only the id is added.
 */
export async function withImportSchoolIds<T extends { schoolid?: string | null; schoolname?: string | null }>(
  rows: T[],
  transaction?: Transaction,
): Promise<Array<T & { schoolid: string | null }>> {
  const byId = new Map<string, string | null>();
  const byName = new Map<string, string | null>();
  const out: Array<T & { schoolid: string | null }> = [];
  for (const row of rows) {
    let schoolid: string | null = null;
    if (isGiven(row.schoolid)) {
      const id = row.schoolid.trim();
      let storedName = byId.get(id);
      if (storedName === undefined) {
        const found = await schools.findOne({ where: { schoolid: id }, attributes: ["schoolid", "schoolname"], transaction });
        storedName = found ? found.schoolname : null;
        byId.set(id, storedName);
      }
      if (storedName !== null) {
        if (isGiven(row.schoolname) && !isSameSchoolName(storedName, row.schoolname)) {
          throw new ApiError(ErrorCode.INVALID_INPUT, {
            message: "The school id and the school name name different schools.",
            fields: [{ field: "schoolid", message: "The school id and the school name name different schools." }],
          });
        }
        schoolid = id;
      }
    }
    if (!schoolid && isGiven(row.schoolname)) {
      if (!byName.has(row.schoolname)) {
        byName.set(row.schoolname, await findSchoolIdByName(row.schoolname, { strict: true, transaction }));
      }
      schoolid = byName.get(row.schoolname) ?? null;
    }
    out.push({ ...row, schoolid });
  }
  return out;
}

/**
 * `withImportSchoolIds` for a write: every row must end up with the id of a school
 * this server has. A row that names no school, a name that matches none here, or an
 * id of a school this server does not have refuses the WHOLE write with a 400 that
 * counts the rows (never names them), before anything is written: a learner or a
 * school login with no school is a row nobody owns, and the column that holds the id
 * is required (S4). A school's roster can only arrive once the school is here
 * (provisioned, or pushed with its organisation's content).
 */
export async function withRequiredSchoolIds<T extends { schoolid?: string | null; schoolname?: string | null }>(
  rows: T[],
  transaction?: Transaction,
): Promise<Array<T & { schoolid: string }>> {
  const resolved = await withImportSchoolIds(rows, transaction);
  const without = resolved.filter((row) => !isGiven(row.schoolid)).length;
  if (without > 0) {
    const message = `${without} ${without === 1 ? "row names" : "rows name"} no school this server has. A school must be here before its learners and logins. Nothing was written.`;
    throw new RosterSchoolError(ErrorCode.INVALID_INPUT, { message, fields: [{ field: "schoolid", message }] });
  }
  return resolved as Array<T & { schoolid: string }>;
}

type SchoolRef = { schoolid?: unknown; schoolname?: unknown };

/** A roster file that names a school (format 3) and carries rows of another. */
export class RosterSchoolError extends ApiError {}

/**
 * A format-3 roster names the school it is for (a top-level `schoolid`), and every
 * row in it must belong to that school: by the `schoolid` the row carries, or, for
 * a row with none, by its `schoolname` resolving to that school. One row of another
 * school, with no school, or whose name matches no school here, fails the whole
 * file with a 400 (nothing has been written when this runs).
 */
export async function assertRosterBelongsToSchool(
  rowsOfRoster: Array<SchoolRef | null | undefined | Array<SchoolRef | null | undefined>>,
  schoolid: unknown,
  transaction?: Transaction,
): Promise<void> {
  if (!isGiven(schoolid)) {
    throw new RosterSchoolError(ErrorCode.INVALID_INPUT, {
      message: "schoolid must be the id of the school this roster is for.",
      fields: [{ field: "schoolid", message: "schoolid must be the id of the school this roster is for." }],
    });
  }
  const wanted = schoolid.trim().toLowerCase();
  const byName = new Map<string, string | null>();
  let elsewhere = 0;
  const declaredBy = async (row: SchoolRef | null | undefined): Promise<string | null> => {
    if (row && isGiven(row.schoolid)) {
      return row.schoolid.trim();
    }
    if (row && isGiven(row.schoolname)) {
      if (!byName.has(row.schoolname)) {
        byName.set(row.schoolname, await findSchoolIdByName(row.schoolname, { strict: true, transaction }));
      }
      return byName.get(row.schoolname) ?? null;
    }
    return null;
  };
  // An entry is one learner or teacher; when it is a list (a login and its learner record) every part must belong.
  for (const entry of rowsOfRoster) {
    for (const row of Array.isArray(entry) ? entry : [entry]) {
      const declared = await declaredBy(row);
      if (declared === null || declared.toLowerCase() !== wanted) {
        elsewhere += 1;
        break;
      }
    }
  }
  if (elsewhere > 0) {
    const message = `${elsewhere} ${elsewhere === 1 ? "row does" : "rows do"} not belong to the school this roster is for. Nothing was written.`;
    throw new RosterSchoolError(ErrorCode.INVALID_INPUT, { message, fields: [{ field: "schoolid", message }] });
  }
}

/**
 * Does a school a request names (query parameter, filter: an id or a name) mean the caller's own school?
 * Nothing named: yes (there is no filter to widen anything). Named: only when it is the same school. A name
 * that no school has here is not the caller's school.
 */
export async function schoolRefIsOwn(own: SchoolScope | undefined, ref: { schoolid?: unknown; schoolname?: unknown }): Promise<boolean> {
  const given = await resolveSchoolScope(ref);
  if (given === undefined) {
    return true;
  }
  if (own === undefined) {
    return false;
  }
  if ("schoolid" in given && "schoolid" in own) {
    return given.schoolid.toLowerCase() === own.schoolid.toLowerCase();
  }
  if ("schoolname" in given && "schoolname" in own) {
    return isSameSchoolName(own.schoolname, given.schoolname);
  }
  return false;
}
