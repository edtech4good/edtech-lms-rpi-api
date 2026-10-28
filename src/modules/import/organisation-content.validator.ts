import { FieldError } from "src/models/FieldError";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { fieldForJoiDetail, humanizeJoiMessage } from "src/utils/joi-message";
import { ORGANISATION_CODE, OwnershipOrganisation, organisation as organisationRow } from "./ownership.request.validator";
import { LEARNING_DOCUMENT_ROLES, LEARNING_ITEM_RULES, LEARNING_ITEM_TYPES, isLearningItemType } from "src/constants/learning-items";
import {
  ANSWER_BEARING_FIELDS,
  FEEDBACK_KEYS,
  LANGUAGE_CODE,
  NO_SUBKEY,
  SUBKEYED_FIELDS,
  SUBKEY_MAX_LENGTH,
  TRANSLATABLE_FIELDS,
  TRANSLATION_TEXT_MAX_BYTES,
  isAnswerBearing,
  normaliseLanguage,
} from "src/constants/content-translations";
import {
  DOCUMENT_LICENCES,
  DOCUMENT_TITLE_MAX,
  VIDEO_DOCUMENT_TYPE_ID,
  isDocumentLicence,
  normaliseDocumentAttribution,
  normaliseDocumentTitle,
} from "src/constants/media-library";

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
 *   lessonlearnings, lessonlearningdocuments, lessonplans, lessonpractices, lessonquizzes,
 *   lessonpracticequestions, lessonquizquestions, levelquizquestions,
 *   questions, documents, subjects, contenttranslations }
 * ```
 *
 * Every key is required (an empty array is a valid value: it means "this
 * organisation has none", and the import replaces what it had). Any other key
 * is refused. Everything here is checked BEFORE the import writes anything, from
 * the payload alone.
 *
 * A `lessonlearnings` row is a typed learning item: its `lessonlearningtype` must
 * be a type this server knows (phase 0: `video`), its `lessonlearningbody` must
 * follow the type's rule (null for `video`), and a type that needs a primary
 * document must name one. `lessonlearningdocuments` holds an item's further
 * documents; each row hangs from a learning and names a document of the payload.
 * `lessonlearningdocuments` is required like every other key, so a payload from
 * before learning items (which lacks it) is refused, by design.
 *
 * `contenttranslations` (bilingual content) holds translations of learner-visible text of content rows: owned by the
 * organisation, with a POLYMORPHIC parent (`tablename`, `rowid`) over an allow-list of tables and fields. Its rows are
 * refused (never dropped: the student side refuses where central drops) when the parent is not a row of the payload,
 * when the table or field is not translatable, when the field is one an answer is graded by (it depends on the
 * question's template), when the subkey does not follow the field's rule (`''` for a field with none), or when the
 * language is the organisation's own `contentlanguage`, or when the payload carries translations and its organisation
 * row has no `contentlanguage` (nothing to differ from). Languages are kept as their primary subtag in lower case
 * (`KM` is `km`). Like `lessonlearningdocuments` it is a required key, so a
 * payload from before translations (which lacks it) is refused, by design: the student API ships first, central
 * straight after, with no Sync Content in between. `organisations[0].contentlanguage` is optional (an empty
 * `contenttranslations` needs none).
 *
 * A `documents` row may carry `documenttitle`, `documentlicence` and `documentattribution` (media library): each is
 * checked when the row has the key, and a row without it is accepted (the licence then takes its default).
 *
 * A `video` item's `documentid` must name a payload `documents` row whose `documenttypeid` is VIDEO (2):
 * a PDF or a picture on a video item would reach the player and be marked done (media library, phase 0).
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
  | "lessonlearningdocuments"
  | "lessonplans"
  | "lessonpractices"
  | "lessonquizzes"
  | "lessonpracticequestions"
  | "lessonquizquestions"
  | "levelquizquestions"
  | "questions"
  | "documents"
  | "subjects"
  | "contenttranslations";

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
   * A table with a `polymorphic` parent is owned and also names its parent row by (table name, row id) columns.
   */
  kind: "owned" | "inherited" | "global";
  /** The row names its parent by a table name column and an id column, over an allow-list of tables (translations). */
  polymorphic?: { tablefield: string; idfield: string };
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
  lessonlearningdocuments: {
    pk: "lessonlearningdocumentid",
    kind: "inherited",
    parent: { fk: "lessonlearningid", to: "lessonlearnings" },
    refs: [{ fk: "documentid", to: "documents" }],
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
  // The LAST key. Translations of text of rows of other tables of the payload (see the note above).
  contenttranslations: { pk: "translationid", kind: "owned", polymorphic: { tablefield: "tablename", idfield: "rowid" } },
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

  // Learning items: the type, the body and the primary document follow the type's rule; a link row has a known role,
  // a whole-number order, and is the only one of its (learning, document) pair.
  const itemRows = tables.lessonlearnings ?? [];
  let noType = 0;
  let unknownType = 0;
  let bodyNotNull = 0;
  let noDocument = 0;
  let videoNotVideo = 0;
  // the documents of the payload by id: a video item's file must be a VIDEO document (design note, section 7)
  const documentTypes = new Map<string, unknown>();
  for (const doc of tables.documents ?? []) {
    if (isRow(doc) && isId(doc.documentid)) documentTypes.set(lower(doc.documentid), doc.documenttypeid);
  }
  for (const row of itemRows) {
    if (!isRow(row)) continue;
    const type = row.lessonlearningtype;
    if (typeof type !== "string" || type.length === 0) {
      noType += 1;
      continue;
    }
    if (!isLearningItemType(type)) {
      unknownType += 1;
      continue;
    }
    const rule = LEARNING_ITEM_RULES[type];
    if (rule.bodyMustBeNull && row.lessonlearningbody !== undefined && row.lessonlearningbody !== null) bodyNotNull += 1;
    if (rule.documentRequired && (row.documentid === undefined || row.documentid === null || row.documentid === "")) noDocument += 1;
    // a document that is not in the payload is reported as a missing reference above, not here
    if (type === "video" && typeof row.documentid === "string" && documentTypes.has(lower(row.documentid))) {
      const documenttypeid = documentTypes.get(lower(row.documentid));
      if (typeof documenttypeid !== "number" || documenttypeid !== VIDEO_DOCUMENT_TYPE_ID) videoNotVideo += 1;
    }
  }
  const knownTypes = LEARNING_ITEM_TYPES.join(", ");
  if (noType) problems.add("lessonlearnings", `lessonlearnings: ${rows(noType)} ${noType === 1 ? "has" : "have"} no lessonlearningtype (a string).`);
  if (unknownType) {
    problems.add(
      "lessonlearnings",
      `lessonlearnings: ${rows(unknownType)} ${unknownType === 1 ? "has" : "have"} a lessonlearningtype this server does not know (it knows: ${knownTypes}).`,
    );
  }
  if (bodyNotNull) {
    problems.add("lessonlearnings", `lessonlearnings: ${rows(bodyNotNull)} of type video ${bodyNotNull === 1 ? "has" : "have"} a lessonlearningbody, which must be null for a video.`);
  }
  if (noDocument) {
    problems.add("lessonlearnings", `lessonlearnings: ${rows(noDocument)} ${noDocument === 1 ? "has" : "have"} no documentid, and the type of ${noDocument === 1 ? "the item" : "each item"} needs one.`);
  }

  if (videoNotVideo) {
    problems.add(
      "lessonlearnings",
      `lessonlearnings: ${rows(videoNotVideo)} of type video ${videoNotVideo === 1 ? "points" : "point"} at a document that is not a video (its documenttypeid must be ${VIDEO_DOCUMENT_TYPE_ID}).`,
    );
  }

  // Documents: the media-library columns, checked only on a row that carries the column (an export from before the
  // media library has none of them, and still imports; the licence then takes its default).
  let badTitle = 0;
  let nullLicence = 0;
  let unknownLicence = 0;
  let badAttribution = 0;
  for (const doc of tables.documents ?? []) {
    if (!isRow(doc)) continue;
    if (doc.documenttitle !== undefined && !normaliseDocumentTitle(doc.documenttitle).ok) badTitle += 1;
    if (doc.documentlicence !== undefined) {
      if (doc.documentlicence === null) nullLicence += 1;
      else if (!isDocumentLicence(doc.documentlicence)) unknownLicence += 1;
    }
    if (doc.documentattribution !== undefined && !normaliseDocumentAttribution(doc.documentattribution).ok) badAttribution += 1;
  }
  if (badTitle) {
    problems.add(
      "documents",
      `documents: ${rows(badTitle)} ${badTitle === 1 ? "has" : "have"} a documenttitle that is not a string of at most ${DOCUMENT_TITLE_MAX} characters without control characters.`,
    );
  }
  if (nullLicence) {
    problems.add("documents", `documents: ${rows(nullLicence)} ${nullLicence === 1 ? "has" : "have"} a null documentlicence, which is never empty (leave the key out for the default).`);
  }
  if (unknownLicence) {
    problems.add(
      "documents",
      `documents: ${rows(unknownLicence)} ${unknownLicence === 1 ? "has" : "have"} a documentlicence this server does not know (it knows: ${DOCUMENT_LICENCES.join(", ")}).`,
    );
  }
  if (badAttribution) {
    problems.add(
      "documents",
      `documents: ${rows(badAttribution)} ${badAttribution === 1 ? "has" : "have"} a documentattribution that is not null or an object of version 1 with only author, sourceurl and adaptedfrom, each within its length (the sourceurl an http or https address, the whole at most 4096 bytes).`,
    );
  }

  const linkRows = tables.lessonlearningdocuments ?? [];
  let badRole = 0;
  let badOrder = 0;
  let repeatedPairs = 0;
  const pairs = new Set<string>();
  for (const row of linkRows) {
    if (!isRow(row)) continue;
    if (typeof row.lessonlearningdocumentrole !== "string" || !(LEARNING_DOCUMENT_ROLES as readonly string[]).includes(row.lessonlearningdocumentrole)) badRole += 1;
    const order = row.lessonlearningdocumentorder;
    // a missing order defaults to 0 in the database; an explicit null does not (the column is NOT NULL)
    if (order !== undefined && !(typeof order === "number" && Number.isInteger(order))) badOrder += 1;
    if (typeof row.lessonlearningid === "string" && typeof row.documentid === "string") {
      const pair = `${lower(row.lessonlearningid)}/${lower(row.documentid)}`;
      if (pairs.has(pair)) repeatedPairs += 1;
      else pairs.add(pair);
    }
  }
  const roles = LEARNING_DOCUMENT_ROLES.join(", ");
  if (badRole) {
    problems.add(
      "lessonlearningdocuments",
      `lessonlearningdocuments: ${rows(badRole)} ${badRole === 1 ? "has" : "have"} a lessonlearningdocumentrole that is not one of ${roles}.`,
    );
  }
  if (badOrder) {
    problems.add("lessonlearningdocuments", `lessonlearningdocuments: ${rows(badOrder)} ${badOrder === 1 ? "has" : "have"} a lessonlearningdocumentorder that is not a whole number.`);
  }
  if (repeatedPairs) {
    problems.add(
      "lessonlearningdocuments",
      `lessonlearningdocuments: ${rows(repeatedPairs)} repeat${repeatedPairs === 1 ? "s" : ""} a lessonlearningid and documentid pair that is already in this table of the payload.`,
    );
  }

  // Translations: each row names its parent by (tablename, rowid), a table and a field that may be translated (and, for
  // a question, a field its template does not grade by), the subkey its field needs, a language other than the
  // organisation's own, a text, the hash of the base text, and when it was written. A row whose parent is not a row of
  // THIS payload is refused (central drops it; this side refuses).
  const translationRows = tables.contenttranslations ?? [];
  if (translationRows.length > 0) {
    const baseLanguage = organisation && typeof organisation.contentlanguage === "string" ? organisation.contentlanguage.toLowerCase() : null;
    // Translations are differences from the organisation's base language: without one there is nothing to differ from, and
    // a row in the base language could not be told apart. (An older central never sends translations.)
    const templates = new Map<string, unknown>();
    for (const q of tables.questions ?? []) {
      if (isRow(q) && isId(q.questionid)) templates.set(lower(q.questionid), q.templatetypeid);
    }
    let badTable = 0;
    let badField = 0;
    let answerBearing = 0;
    let badSubkey = 0;
    let badLanguage = 0;
    let baseLanguageRows = 0;
    let badText = 0;
    let badHash = 0;
    let badDate = 0;
    let repeated = 0;
    const missingParent = new Map<string, number>();
    const seenTranslations = new Set<string>();
    for (const row of translationRows) {
      if (!isRow(row)) continue;
      const { tablename, rowid, field, subkey, language, text, sourcehash, lastupdated } = row;
      const knownTable = typeof tablename === "string" && Object.prototype.hasOwnProperty.call(TRANSLATABLE_FIELDS, tablename);
      if (!knownTable) badTable += 1;
      const knownField = knownTable && typeof field === "string" && TRANSLATABLE_FIELDS[tablename as string].includes(field);
      if (knownTable && !knownField) badField += 1;
      if (knownField && tablename === "questions" && typeof rowid === "string" && isAnswerBearing(templates.get(lower(rowid)), field as string)) answerBearing += 1;
      if (knownField) {
        const needsSubkey = SUBKEYED_FIELDS.includes(field as string);
        const rule = typeof subkey === "string" && (needsSubkey ? subkey !== NO_SUBKEY && subkey.length <= SUBKEY_MAX_LENGTH : subkey === NO_SUBKEY);
        const feedbackOk = field !== "feedback" || (typeof subkey === "string" && FEEDBACK_KEYS.includes(subkey));
        if (!rule || !feedbackOk) badSubkey += 1;
      }
      if (typeof language !== "string" || !LANGUAGE_CODE.test(language)) badLanguage += 1;
      else if (baseLanguage !== null && language.toLowerCase() === baseLanguage) baseLanguageRows += 1;
      if (typeof text !== "string" || text.length === 0 || Buffer.byteLength(text, "utf8") > TRANSLATION_TEXT_MAX_BYTES) badText += 1;
      if (typeof sourcehash !== "string" || !/^[0-9a-f]{64}$/i.test(sourcehash)) badHash += 1;
      if (typeof lastupdated !== "string" || Number.isNaN(Date.parse(lastupdated))) badDate += 1;
      if (knownTable && typeof rowid === "string") {
        if (!idsOf[tablename as TableKey]?.has(lower(rowid))) {
          missingParent.set(tablename as string, (missingParent.get(tablename as string) ?? 0) + 1);
        }
      } else if (knownTable) {
        missingParent.set(tablename as string, (missingParent.get(tablename as string) ?? 0) + 1);
      }
      if (knownField && typeof rowid === "string" && typeof subkey === "string" && typeof language === "string") {
        const key = [tablename, rowid, field, subkey, language].map((v) => String(v).toLowerCase()).join("\u0000");
        if (seenTranslations.has(key)) repeated += 1;
        else seenTranslations.add(key);
      }
    }
    const tablesNamed = Object.keys(TRANSLATABLE_FIELDS).join(", ");
    if (baseLanguage === null) problems.add("contenttranslations", "contenttranslations: the organisation has no contentlanguage; set it before sending translations.");
    if (badTable) problems.add("contenttranslations", `contenttranslations: ${rows(badTable)} ${badTable === 1 ? "names" : "name"} a tablename that is not translatable (it must be one of ${tablesNamed}).`);
    if (badField) problems.add("contenttranslations", `contenttranslations: ${rows(badField)} ${badField === 1 ? "names" : "name"} a field that its table does not have as translatable text.`);
    if (answerBearing) {
      const graded = Object.entries(ANSWER_BEARING_FIELDS)
        .map(([template, fields]) => `template ${template}: ${fields.join(", ")}`)
        .join("; ");
      problems.add(
        "contenttranslations",
        `contenttranslations: ${rows(answerBearing)} translate${answerBearing === 1 ? "s" : ""} a field that an answer is graded by (${graded}).`,
      );
    }
    if (badSubkey) {
      problems.add(
        "contenttranslations",
        `contenttranslations: ${rows(badSubkey)} ${badSubkey === 1 ? "has" : "have"} a subkey that does not follow its field's rule (an option, partner or distractor id, or a feedback message key, of 1 to ${SUBKEY_MAX_LENGTH} characters, for ${SUBKEYED_FIELDS.join(", ")}; an empty string for every other field).`,
      );
    }
    if (badLanguage) problems.add("contenttranslations", `contenttranslations: ${rows(badLanguage)} ${badLanguage === 1 ? "has" : "have"} a language that is not 2 to 8 letters, digits or hyphens.`);
    if (baseLanguageRows) {
      problems.add("contenttranslations", `contenttranslations: ${rows(baseLanguageRows)} ${baseLanguageRows === 1 ? "is" : "are"} in the organisation's own contentlanguage, which the table's own columns already hold.`);
    }
    if (badText) problems.add("contenttranslations", `contenttranslations: ${rows(badText)} ${badText === 1 ? "has" : "have"} a text that is not a string of 1 to ${TRANSLATION_TEXT_MAX_BYTES} bytes.`);
    if (badHash) problems.add("contenttranslations", `contenttranslations: ${rows(badHash)} ${badHash === 1 ? "has" : "have"} a sourcehash that is not 64 hexadecimal characters.`);
    if (badDate) problems.add("contenttranslations", `contenttranslations: ${rows(badDate)} ${badDate === 1 ? "has" : "have"} a lastupdated that is not a date.`);
    if (repeated) {
      problems.add(
        "contenttranslations",
        `contenttranslations: ${rows(repeated)} repeat${repeated === 1 ? "s" : ""} a table, row, field, subkey and language that is already in this table of the payload.`,
      );
    }
    for (const [table, n] of missingParent) {
      problems.add("contenttranslations", `contenttranslations: ${rows(n)} ${n === 1 ? "names" : "name"} a ${table} row (rowid) that is not in the payload.`);
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
  // Stored as the primary subtag in lower case (`KM` is served as `km`): the organisation's contentlanguage and every translation's language.
  if (typeof organisation.contentlanguage === "string") organisation = { ...organisation, contentlanguage: normaliseLanguage(organisation.contentlanguage) };
  if (tables.contenttranslations.length > 0) {
    tables.contenttranslations = tables.contenttranslations.map((row) =>
      isRow(row) && typeof row.language === "string" ? { ...row, language: normaliseLanguage(row.language) } : row,
    );
  }
  return { organisationid: headerId, organisationcode: headerCode, organisation, tables };
}
