import { Op } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { curriculumbaseline } from "src/models/data-models/curriculumbaseline";
import { curriculums } from "src/models/data-models/curriculums";
import { documents } from "src/models/data-models/documents";
import { grades } from "src/models/data-models/grades";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonlearningdocuments } from "src/models/data-models/lessonlearningdocuments";
import { lessonplans } from "src/models/data-models/lessonplan";
import { lessonpracticequestions } from "src/models/data-models/lessonpracticequestions";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { lessons } from "src/models/data-models/lessons";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { levels } from "src/models/data-models/levels";
import { schools } from "src/models/data-models/school";
import { students } from "src/models/data-models/students";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { Token } from "src/models/token.model";
import { isGiven } from "./school-identity";

/**
 * Which curriculum a piece of content belongs to, and whether the caller may see it.
 *
 * Every piece of content hangs from exactly one curriculum, and a curriculum is
 * owned by one organisation. So "may this caller see this content?" is always
 * "is its curriculum one of the caller's?", and the answer for content that is
 * not theirs is the one for content that does not exist: a 404, and a result
 * submission writes nothing.
 *
 * The rule, by who is asking (a token's `schooluserrole`):
 *  - a LEARNER: the curriculum is in the learner's CURRENT `curriculumids`, read
 *    from the database (the token's own copy is stale until the next sign-in),
 *    AND it belongs to the token's organisation;
 *  - school STAFF (teacher, admin, super admin): the curriculum is in their
 *    school's `curriculums` list AND belongs to the token's organisation, and the
 *    school is itself that organisation's.
 * A token with no organisation or school claim has nothing in scope.
 *
 * What a piece of content's curriculum is:
 *   lesson -> level -> grade -> curriculum
 *   practice, quiz, learning, plan -> lesson -> ...
 *   level quiz question -> level -> ...
 *   baseline, baseline question -> curriculum
 *   practice, quiz, level quiz and baseline question rows -> their container
 *   document -> every learning and plan that uses it -> lesson -> ...
 */
export type ContentKind =
  | "curriculum"
  | "grade"
  | "level"
  | "lesson"
  | "lessonlearning"
  | "lessonplan"
  | "lessonpractice"
  | "lessonquiz"
  | "baseline"
  | "lessonpracticequestion"
  | "lessonquizquestion"
  | "levelquizquestion"
  | "baselinequestion"
  | "document";

export type CallerKind = "learner" | "staff";

const STAFF_ROLES: number[] = [SchoolRole.SUPERADMIN, SchoolRole.ADMIN, SchoolRole.TEACHER];

/** Staff when the token's role is a school staff role; anything else is treated as a learner (the narrower rule). */
export const callerKindOf = (user: Pick<Token, "schooluserrole"> | undefined): CallerKind =>
  STAFF_ROLES.includes(Number(user?.schooluserrole)) ? "staff" : "learner";

const lower = (value: string): string => value.toLowerCase();

/** The organisation and school a token names, or null when either claim is missing. */
export const claimsOf = (user: Pick<Token, "organisationid" | "schoolid"> | undefined): { organisationid: string; schoolid: string } | null =>
  isGiven(user?.organisationid) && isGiven(user?.schoolid)
    ? { organisationid: String(user?.organisationid).trim(), schoolid: String(user?.schoolid).trim() }
    : null;

/** Who is asking: the school, and the organisation it belongs to. */
export interface Caller {
  organisationid: string;
  schoolid: string;
}

/**
 * The caller of a request, from the token's claims. Null when the token proves nothing (the strategy refuses
 * such a token before any route runs; this is the same answer for anything that asks without it). A token with
 * no organisation claim is never a caller, on a classroom Pi as much as online.
 */
export function callerOf(user: Pick<Token, "organisationid" | "schoolid"> | undefined): Caller | null {
  return claimsOf(user);
}

const usable = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 64;

type Row = Record<string, unknown>;
const field = (row: unknown, name: string): string | null => {
  const value = row ? (row as Row)[name] : undefined;
  return typeof value === "string" && value.length > 0 ? value : null;
};

const curriculumOfGrade = async (gradeid: string | null): Promise<string[]> => {
  if (!gradeid) return [];
  const grade = await grades.findOne({ where: { gradeid }, attributes: ["gradeid", "curriculumid"], raw: true });
  const id = field(grade, "curriculumid");
  return id ? [id] : [];
};

const curriculumOfLevel = async (levelid: string | null): Promise<string[]> => {
  if (!levelid) return [];
  const level = await levels.findOne({ where: { levelid }, attributes: ["levelid", "gradeid"], raw: true });
  return curriculumOfGrade(field(level, "gradeid"));
};

const curriculumOfLesson = async (lessonid: string | null): Promise<string[]> => {
  if (!lessonid) return [];
  const lesson = await lessons.findOne({ where: { lessonid }, attributes: ["lessonid", "levelid"], raw: true });
  return curriculumOfLevel(field(lesson, "levelid"));
};

const curriculumOfBaseline = async (curriculumbaselineid: string | null): Promise<string[]> => {
  if (!curriculumbaselineid) return [];
  const baseline = await curriculumbaseline.findOne({
    where: { curriculumbaselineid },
    attributes: ["curriculumbaselineid", "curriculumid"],
    raw: true,
  });
  const id = field(baseline, "curriculumid");
  return id ? [id] : [];
};

/**
 * The curricula a piece of content belongs to: one for everything but a document (which can be used by
 * lessons of several curricula), none when the id names nothing.
 */
export async function curriculumIdsOf(kind: ContentKind, id: unknown): Promise<string[]> {
  if (!usable(id)) {
    return [];
  }
  switch (kind) {
    case "curriculum": {
      const row = await curriculums.findOne({ where: { curriculumid: id }, attributes: ["curriculumid"], raw: true });
      const found = field(row, "curriculumid");
      return found ? [found] : [];
    }
    case "grade":
      return curriculumOfGrade(id);
    case "level":
      return curriculumOfLevel(id);
    case "lesson":
      return curriculumOfLesson(id);
    case "lessonlearning": {
      const row = await lessonlearnings.findOne({ where: { lessonlearningid: id }, attributes: ["lessonlearningid", "lessonid"], raw: true });
      return curriculumOfLesson(field(row, "lessonid"));
    }
    case "lessonplan": {
      const row = await lessonplans.findOne({ where: { lessonplanid: id }, attributes: ["lessonplanid", "lessonid"], raw: true });
      return curriculumOfLesson(field(row, "lessonid"));
    }
    case "lessonpractice": {
      const row = await lessonpractices.findOne({ where: { lessonpracticeid: id }, attributes: ["lessonpracticeid", "lessonid"], raw: true });
      return curriculumOfLesson(field(row, "lessonid"));
    }
    case "lessonquiz": {
      const row = await lessonquizzes.findOne({ where: { lessonquizid: id }, attributes: ["lessonquizid", "lessonid"], raw: true });
      return curriculumOfLesson(field(row, "lessonid"));
    }
    case "baseline":
      return curriculumOfBaseline(id);
    case "lessonpracticequestion": {
      const row = await lessonpracticequestions.findOne({
        where: { lessonpracticequestionid: id },
        attributes: ["lessonpracticequestionid", "lessonpracticeid"],
        raw: true,
      });
      return curriculumIdsOf("lessonpractice", field(row, "lessonpracticeid"));
    }
    case "lessonquizquestion": {
      const row = await lessonquizquestions.findOne({
        where: { lessonquizquestionid: id },
        attributes: ["lessonquizquestionid", "lessonquizid"],
        raw: true,
      });
      return curriculumIdsOf("lessonquiz", field(row, "lessonquizid"));
    }
    case "levelquizquestion": {
      const row = await levelquizquestions.findOne({
        where: { levelquizquestionid: id },
        attributes: ["levelquizquestionid", "levelid"],
        raw: true,
      });
      return curriculumOfLevel(field(row, "levelid"));
    }
    case "baselinequestion": {
      const row = await baselinequestion.findOne({
        where: { baselinequestionid: id },
        attributes: ["baselinequestionid", "curriculumbaselineid"],
        raw: true,
      });
      return curriculumOfBaseline(field(row, "curriculumbaselineid"));
    }
    case "document": {
      const direct = await lessonlearnings.findAll({ where: { documentid: id }, attributes: ["lessonlearningid", "lessonid"], raw: true });
      // an item may also use a document through a link row (learning items): its learning counts as using it
      const linked = await lessonlearningdocuments.findAll({ where: { documentid: id }, attributes: ["lessonlearningid"], raw: true });
      const linkedIds = [...new Set(linked.map((r) => field(r, "lessonlearningid")).filter((x): x is string => x !== null))];
      const viaLinks = linkedIds.length > 0 ? await lessonlearnings.findAll({ where: { lessonlearningid: { [Op.in]: linkedIds } }, attributes: ["lessonlearningid", "lessonid"], raw: true }) : [];
      const learnings = [...direct, ...viaLinks];
      const plans = await lessonplans.findAll({ where: { documentid: id }, attributes: ["lessonplanid", "lessonid"], raw: true });
      const lessonids = [...new Set([...learnings, ...plans].map((r) => field(r, "lessonid")).filter((x): x is string => x !== null))];
      const out = new Set<string>();
      for (const lessonid of lessonids) {
        for (const curriculumid of await curriculumOfLesson(lessonid)) {
          out.add(curriculumid);
        }
      }
      return [...out];
    }
    default:
      return [];
  }
}

/**
 * A way to say which curricula of an organisation are in play: `curriculumids` undefined means every
 * curriculum the organisation owns; a list means those of them in it (a school's own list).
 */
export interface CurriculumScope {
  organisationid: string;
  curriculumids?: string[];
}

/** Of these curricula, the ones the organisation owns here and (when the scope lists them) that are in its list. */
export async function curriculaInScope(scope: CurriculumScope, candidates: string[]): Promise<string[]> {
  const wanted = [...new Set(candidates.filter(usable))];
  if (wanted.length === 0) {
    return [];
  }
  const rows = await curriculums.findAll({
    where: { curriculumid: { [Op.in]: wanted }, organisationid: scope.organisationid },
    attributes: ["curriculumid"],
    raw: true,
  });
  const owned = rows.map((r) => field(r, "curriculumid")).filter((x): x is string => x !== null);
  if (!scope.curriculumids) {
    return owned;
  }
  const listed = new Set(scope.curriculumids.map(lower));
  return owned.filter((id) => listed.has(lower(id)));
}

const idList = (value: unknown): string[] => (Array.isArray(value) ? value.filter(usable) : []);

/**
 * The curricula of the caller's school: its `curriculums` list, and only when the school is the token's
 * organisation's (a school that moved to another organisation, or is gone, has nothing).
 */
export async function schoolCurriculumList(organisationid: string, schoolid: string): Promise<string[]> {
  const school = await schools.scope("withOwnership").findOne({
    where: { schoolid },
    attributes: ["schoolid", "organisationid", "curriculums"],
  });
  if (!school) {
    return [];
  }
  const owner = school.organisationid ? lower(String(school.organisationid)) : null;
  if (owner !== lower(organisationid)) {
    return [];
  }
  return idList(school.curriculums);
}

/** The curriculum ids a learner is enrolled in RIGHT NOW (the database, not the token's copy). */
export async function learnerCurriculumList(studentid: unknown): Promise<string[]> {
  if (!usable(studentid)) {
    return [];
  }
  const student = await students.findOne({ where: { studentid }, attributes: ["studentid", "curriculumids"] });
  return idList(student?.curriculumids);
}

/** The curricula the token's holder may see, as curriculum rows' ids: the rule above, applied to the whole list. */
export async function curriculumIdsInScope(user: Token | undefined): Promise<string[]> {
  const claims = callerOf(user);
  if (!claims || !user) {
    return [];
  }
  const candidates =
    callerKindOf(user) === "staff"
      ? await schoolCurriculumList(claims.organisationid, claims.schoolid)
      : await learnerCurriculumList(user.studentid);
  return curriculaInScope({ organisationid: claims.organisationid }, candidates);
}

/**
 * The curricula the token's holder is ENROLLED in: their own learner record's current list, and only those
 * the token's organisation owns (and, for staff who also have a learner record, only those in the school's
 * list). What the learner screens (subjects, progress summary, library) show.
 */
export async function enrolledCurriculumIds(user: Token | undefined): Promise<string[]> {
  const claims = callerOf(user);
  if (!claims || !user) {
    return [];
  }
  const own = await learnerCurriculumList(user.studentid);
  const scope: CurriculumScope =
    callerKindOf(user) === "staff"
      ? { organisationid: claims.organisationid, curriculumids: await schoolCurriculumList(claims.organisationid, claims.schoolid) }
      : { organisationid: claims.organisationid };
  return curriculaInScope(scope, own);
}

/** May the token's holder see this content? An id that names nothing is not visible either. */
export async function canAccessContent(user: Token | undefined, kind: ContentKind, id: unknown): Promise<boolean> {
  const caller = callerOf(user);
  if (!caller) {
    return false;
  }
  const own = await curriculumIdsOf(kind, id);
  if (own.length === 0) {
    return false;
  }
  const visible = new Set((await curriculumIdsInScope(user)).map(lower));
  if (visible.size === 0) {
    return false;
  }
  if (!own.some((curriculumid) => visible.has(lower(curriculumid)))) {
    return false;
  }
  if (kind === "document") {
    // a document has its owner too: it must be the token's organisation's, as well as used by a curriculum in scope
    const doc = await documents.scope("withOwnership").findOne({ where: { documentid: String(id) }, attributes: ["documentid", "organisationid"], raw: true });
    const owner = field(doc, "organisationid");
    return owner !== null && lower(owner) === lower(caller.organisationid);
  }
  return true;
}

export const notFound = (): ApiError => new ApiError(ErrorCode.NOT_FOUND);

/** Throws the 404 of absent content unless the token's holder may see it. */
export async function assertContentAccess(user: Token | undefined, kind: ContentKind, id: unknown): Promise<void> {
  if (!(await canAccessContent(user, kind, id))) {
    throw notFound();
  }
}

/** The ids of the grades of the curricula in the caller's scope (what a list of levels or lessons may come from). */
export async function gradeIdsInScope(user: Token | undefined): Promise<string[]> {
  const curriculumids = await curriculumIdsInScope(user);
  if (curriculumids.length === 0) {
    return [];
  }
  const rows = await grades.findAll({ where: { curriculumid: { [Op.in]: curriculumids } }, attributes: ["gradeid"], raw: true });
  return rows.map((r) => field(r, "gradeid")).filter((x): x is string => x !== null);
}

/** The ids of the levels of the grades in the caller's scope. */
export async function levelIdsInScope(user: Token | undefined): Promise<string[]> {
  const gradeids = await gradeIdsInScope(user);
  if (gradeids.length === 0) {
    return [];
  }
  const rows = await levels.findAll({ where: { gradeid: { [Op.in]: gradeids } }, attributes: ["levelid"], raw: true });
  return rows.map((r) => field(r, "levelid")).filter((x): x is string => x !== null);
}
