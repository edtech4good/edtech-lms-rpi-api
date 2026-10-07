import { FieldError } from "src/models/FieldError";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { fieldForJoiDetail, humanizeJoiMessage } from "src/utils/joi-message";
import { ORGANISATION_CODE, OwnershipOrganisation, organisation as organisationRow } from "./ownership.request.validator";

/**
 * The format-3 content payload: what `PUT /import/master` receives when it
 * carries ONE organisation's content (see organisation-content.business.ts for
 * what the import does with it).
 *
 * ```
 * { format: 3, organisationid, organisationcode, scope: "organisation",
 *   organisations: [ <exactly one row, the header's organisation> ],
 *   schools, standards, countries,
 *   curriculums, curriculumbaselines, baselinequestion, grades, levels, lessons,
 *   lessonlearnings, lessonplans, lessonpractices, lessonquizzes,
 *   lessonpracticequestions, lessonquizquestions, levelquizquestions,
 *   questions, documents, subjects }
 * ```
 *
 * Every key is required (an empty array is a valid value: it means "this
 * organisation has none", and the import replaces what it had). Any other key
 * is refused. Everything here is checked BEFORE the import writes anything, from
 * the payload alone.
 */

export const CONTENT_FORMAT = 3;
export const CONTENT_SCOPE = "organisation";

/** The most rows one table of one payload may carry. */
export const MAX_ROWS_PER_TABLE = 200000;

const ID_MAX_LENGTH = 36;
/** How many problems the message names (`fields` lists them all). */
const MAX_MESSAGE_PROBLEMS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Row = Record<string, unknown>;

export type TableKey =
  | "schools"
  | "standards"
  | "countries"
  | "curriculums"
  | "curriculumbaselines"
  | "baselinequestion"
  | "grades"
  | "levels"
  | "lessons"
  | "lessonlearnings"
  | "lessonplans"
  | "lessonpractices"
  | "lessonquizzes"
  | "lessonpracticequestions"
  | "lessonquizquestions"
  | "levelquizquestions"
  | "questions"
  | "documents"
  | "subjects";

interface Reference {
  /** The column on this table that holds the id. */
  fk: string;
  /** The payload table the id must be a row of. */
  to: TableKey;
  /** The column may be empty. */
  optional?: boolean;
}

export interface TableSpec {
  pk: string;
  /**
   *  - owned: the table has an `organisationid` column; every row must carry the header's;
   *  - inherited: no owner of its own; it belongs to the organisation through `parent`;
   *  - global: shared across organisations (never deleted by an import).
   */
  kind: "owned" | "inherited" | "global";
  /** For an inherited row: the owned (or inherited) row it hangs from, which must be in the payload. */
  parent?: Reference;
  /** Other ids the row holds, which must also be rows of this payload (so one organisation's content never points into another's). */
  refs?: Reference[];
  /** Columns holding a LIST of ids (a JSON array) of rows of `to`. The import keeps the entries that are rows of this payload. */
  lists?: Array<{ fk: string; to: TableKey }>;
}

/** Every table of the payload, parents before children. */
export const CONTENT_TABLES: Record<TableKey, TableSpec> = {
  countries: { pk: "countryid", kind: "global" },
  schools: {
    pk: "schoolid",
    kind: "owned",
    refs: [{ fk: "countryid", to: "countries", optional: true }],
    lists: [{ fk: "curriculums", to: "curriculums" }],
  },
  standards: { pk: "standardid", kind: "inherited", parent: { fk: "schoolid", to: "schools" } },
  subjects: { pk: "subjectid", kind: "owned" },
  curriculums: { pk: "curriculumid", kind: "owned", refs: [{ fk: "subjectid", to: "subjects", optional: true }] },
  questions: { pk: "questionid", kind: "owned" },
  documents: { pk: "documentid", kind: "owned" },
  curriculumbaselines: {
    pk: "curriculumbaselineid",
    kind: "inherited",
    parent: { fk: "curriculumid", to: "curriculums" },
    lists: [{ fk: "schoolid", to: "schools" }],
  },
  baselinequestion: {
    pk: "baselinequestionid",
    kind: "inherited",
    parent: { fk: "curriculumbaselineid", to: "curriculumbaselines" },
    refs: [{ fk: "questionid", to: "questions" }],
  },
  grades: { pk: "gradeid", kind: "inherited", parent: { fk: "curriculumid", to: "curriculums" } },
  levels: { pk: "levelid", kind: "inherited", parent: { fk: "gradeid", to: "grades" } },
  lessons: { pk: "lessonid", kind: "inherited", parent: { fk: "levelid", to: "levels" } },
  lessonlearnings: {
    pk: "lessonlearningid",
    kind: "inherited",
    parent: { fk: "lessonid", to: "lessons" },
    refs: [{ fk: "documentid", to: "documents", optional: true }],
  },
  lessonplans: {
    pk: "lessonplanid",
    kind: "inherited",
    parent: { fk: "lessonid", to: "lessons" },
    refs: [{ fk: "documentid", to: "documents", optional: true }],
  },
  lessonpractices: { pk: "lessonpracticeid", kind: "inherited", parent: { fk: "lessonid", to: "lessons" } },
  lessonquizzes: { pk: "lessonquizid", kind: "inherited", parent: { fk: "lessonid", to: "lessons" } },
  lessonpracticequestions: {
    pk: "lessonpracticequestionid",
    kind: "inherited",
    parent: { fk: "lessonpracticeid", to: "lessonpractices" },
    refs: [{ fk: "questionid", to: "questions" }],
  },
  lessonquizquestions: {
    pk: "lessonquizquestionid",
    kind: "inherited",
    parent: { fk: "lessonquizid", to: "lessonquizzes" },
    refs: [{ fk: "questionid", to: "questions" }],
  },
  levelquizquestions: {
    pk: "levelquizquestionid",
    kind: "inherited",
    parent: { fk: "levelid", to: "levels" },
    refs: [
      { fk: "questionid", to: "questions" },
      { fk: "lessonid", to: "lessons", optional: true },
    ],
  },
};

export const TABLE_KEYS = Object.keys(CONTENT_TABLES) as TableKey[];

/** The keys a content payload may carry besides its tables. */
const HEADER_KEYS = ["format", "organisationid", "organisationcode", "scope", "organisations"];

/** Keys that mean learners or logins, which a content payload never carries (the roster routes own them). */
const ROSTER_KEYS = new Set([
  "students",
  "studentusers",
  "schoolusers",
  "teachers",
  "logins",
  "users",
  "studentprogress",
  "studentprogresses",
  "studentpoints",
  "tokens",
]);

/** The keys that only a content payload has: any of them, or `format`, marks the payload as one. */
const CONTENT_MARKERS = ["format", "scope", "organisationid", "organisationcode", "organisations"];

/**
 * True when the body is meant as a format-3 content payload (or claims to be, so that
 * `validateOrganisationContent` can say what is wrong with it). False for anything else:
 * a body that names format 2 (retired), an array, a scalar, and the old whole-content
 * payload, which has none of the markers. The caller refuses all of those.
 */
export const looksLikeOrganisationContent = (body: unknown): boolean => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  const row = body as Row;
  if (row.format === 2) {
    return false;
  }
  return CONTENT_MARKERS.some((key) => key in row);
};

export interface OrganisationContent {
  organisationid: string;
  organisationcode: string;
  organisation: OwnershipOrganisation;
  tables: Record<TableKey, Row[]>;
}

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= ID_MAX_LENGTH;
const lower = (value: string) => value.toLowerCase();
const rows = (n: number) => (n === 1 ? "1 row" : `${n} rows`);

class Problems {
  readonly list: FieldError[] = [];
  add(field: string, message: string) {
    this.list.push({ field, message });
  }
}

/**
 * Throws a 400 (INVALID_INPUT, with `fields`) unless the body is a valid format-3
 * content payload. Reads nothing but the body. Every problem is reported (one
 * `fields` entry each), and a message that names a table gives how many ROWS are
 * at fault, never their ids.
 */
export function validateOrganisationContent(body: unknown): OrganisationContent {
  const problems = new Problems();
  const fail = () => {
    const shown = problems.list.slice(0, MAX_MESSAGE_PROBLEMS).map((p) => p.message);
    const more = problems.list.length > MAX_MESSAGE_PROBLEMS ? [`(and ${problems.list.length - MAX_MESSAGE_PROBLEMS} more)`] : [];
    throw new ApiError(ErrorCode.INVALID_INPUT, { message: [...shown, ...more].join(" "), fields: problems.list });
  };

  if (!isRow(body)) {
    problems.add("body", "The content payload must be a JSON object.");
    return fail();
  }

  // ---- the header -------------------------------------------------------
  if (body.format !== CONTENT_FORMAT) {
    problems.add("format", `format must be ${CONTENT_FORMAT}.`);
  }
  if (body.scope !== CONTENT_SCOPE) {
    problems.add("scope", `scope must be "${CONTENT_SCOPE}": no other scope is supported.`);
  }
  const headerId = typeof body.organisationid === "string" && UUID.test(body.organisationid) ? body.organisationid : null;
  if (!headerId) {
    problems.add("organisationid", "organisationid must be an organisation's id (a uuid).");
  }
  const headerCode = typeof body.organisationcode === "string" && ORGANISATION_CODE.test(body.organisationcode) ? body.organisationcode : null;
  if (!headerCode) {
    problems.add("organisationcode", "organisationcode must be 2 to 16 lower-case letters and digits.");
  }

  // ---- keys -------------------------------------------------------------
  const allowed = new Set<string>([...HEADER_KEYS, ...TABLE_KEYS]);
  for (const key of Object.keys(body)) {
    if (ROSTER_KEYS.has(key)) {
      problems.add(key, `${key}: learners and logins are not part of a content payload; they are imported through the roster routes.`);
    } else if (!allowed.has(key)) {
      problems.add(key, `${key} is not part of a content payload.`);
    }
  }

  // ---- the organisation row --------------------------------------------
  let organisation: OwnershipOrganisation | null = null;
  if (!Array.isArray(body.organisations) || body.organisations.length !== 1) {
    problems.add("organisations", "organisations must hold exactly one row: the organisation this payload is for.");
  } else {
    const { error } = organisationRow.validate(body.organisations[0], { abortEarly: true, convert: false });
    if (error) {
      const details = error.details[0];
      const field = fieldForJoiDetail(["organisations", "0", ...details.path.map(String)], details.type);
      problems.add(field, humanizeJoiMessage(field, details.type, details.message));
    } else {
      organisation = body.organisations[0] as OwnershipOrganisation;
      if (headerId && lower(organisation.organisationid) !== lower(headerId)) {
        problems.add("organisations", "The organisation row is not the organisation named in the header.");
      }
      if (headerCode && organisation.organisationcode !== headerCode) {
        problems.add("organisations", "The organisation row's code is not the organisationcode in the header.");
      }
    }
  }

  // ---- the tables -------------------------------------------------------
  const tables = {} as Record<TableKey, Row[]>;
  for (const key of TABLE_KEYS) {
    const value = body[key];
    if (!Array.isArray(value)) {
      problems.add(key, `${key} must be an array (an empty one if the organisation has none).`);
    } else if (value.length > MAX_ROWS_PER_TABLE) {
      problems.add(key, `${key} has too many rows: at most ${MAX_ROWS_PER_TABLE}.`);
    } else {
      tables[key] = value as Row[];
    }
  }

  // Row shape, ids and owners.
  const idsOf = {} as Record<TableKey, Set<string>>;
  for (const key of TABLE_KEYS) {
    const list = tables[key];
    if (!list) continue;
    const { pk, kind } = CONTENT_TABLES[key];
    const seen = new Set<string>();
    let notRows = 0;
    let noId = 0;
    let duplicates = 0;
    let foreign = 0;
    let ownerless = 0;
    for (const row of list) {
      if (!isRow(row)) {
        notRows += 1;
        continue;
      }
      const id = row[pk];
      if (!isId(id)) {
        noId += 1;
      } else if (seen.has(lower(id))) {
        duplicates += 1;
      } else {
        seen.add(lower(id));
      }
      const owner = row.organisationid;
      if (kind === "owned") {
        if (owner === undefined || owner === null || owner === "") {
          ownerless += 1;
        } else if (typeof owner !== "string" || !headerId || lower(owner) !== lower(headerId)) {
          foreign += 1;
        }
      } else if (owner !== undefined && owner !== null && owner !== "" && (typeof owner !== "string" || !headerId || lower(owner) !== lower(headerId))) {
        foreign += 1;
      }
    }
    idsOf[key] = seen;
    if (notRows) problems.add(key, `${key}: ${rows(notRows)} ${notRows === 1 ? "is" : "are"} not an object.`);
    if (noId) problems.add(key, `${key}: ${rows(noId)} ${noId === 1 ? "has" : "have"} no valid ${pk} (a string of 1 to ${ID_MAX_LENGTH} characters).`);
    if (duplicates) problems.add(key, `${key}: ${rows(duplicates)} repeat${duplicates === 1 ? "s" : ""} an id that is already in this table of the payload.`);
    if (foreign) problems.add(key, `${key}: ${rows(foreign)} belong${foreign === 1 ? "s" : ""} to another organisation than the one in the header.`);
    if (ownerless) problems.add(key, `${key}: ${rows(ownerless)} ${ownerless === 1 ? "carries" : "carry"} no organisationid, and this table's rows must carry the header's.`);
  }

  // Parents and other references: every one must be a row of this same payload.
  for (const key of TABLE_KEYS) {
    const list = tables[key];
    if (!list) continue;
    const spec = CONTENT_TABLES[key];
    const references: Array<Reference & { parent: boolean }> = [
      ...(spec.parent ? [{ ...spec.parent, parent: true }] : []),
      ...(spec.refs ?? []).map((r) => ({ ...r, parent: false })),
    ];
    for (const ref of references) {
      const targets = idsOf[ref.to];
      if (!targets) continue; // that table is itself malformed: already reported
      let missing = 0;
      for (const row of list) {
        if (!isRow(row)) continue;
        const value = row[ref.fk];
        if (value === undefined || value === null || value === "") {
          if (!ref.optional) missing += 1;
        } else if (typeof value !== "string" || !targets.has(lower(value))) {
          missing += 1;
        }
      }
      if (missing) {
        problems.add(
          key,
          ref.parent
            ? `${key}: ${rows(missing)} ${missing === 1 ? "hangs" : "hang"} from a ${ref.to} row (${ref.fk}) that is not in the payload.`
            : `${key}: ${rows(missing)} point${missing === 1 ? "s" : ""} at a ${ref.to} row (${ref.fk}) that is not in the payload.`,
        );
      }
    }
  }

  // Lists of ids (a school's curricula, the schools a baseline is for) must be lists of ids. Which
  // entries name rows that are not in the payload is a matter for the import, which can see what
  // is here: it refuses the file for an entry owned by another organisation and drops the rest.
  for (const key of TABLE_KEYS) {
    const list = tables[key];
    if (!list) continue;
    for (const { fk, to } of CONTENT_TABLES[key].lists ?? []) {
      let bad = 0;
      for (const row of list) {
        if (!isRow(row)) continue;
        const value = row[fk];
        if (value === undefined || value === null) continue;
        if (!Array.isArray(value) || value.some((id) => !isId(id))) {
          bad += 1;
        }
      }
      if (bad) {
        problems.add(key, `${key}: ${rows(bad)} ${bad === 1 ? "has" : "have"} a ${fk} that is not a list of ${to} ids.`);
      }
    }
  }

  if (problems.list.length > 0 || !headerId || !headerCode || !organisation) {
    if (problems.list.length === 0) problems.add("body", "The content payload is not valid.");
    return fail();
  }
  return { organisationid: headerId, organisationcode: headerCode, organisation, tables };
}
