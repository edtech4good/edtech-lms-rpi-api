import { Op } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { FieldError } from "src/models/FieldError";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { lessons } from "src/models/data-models/lessons";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { levels } from "src/models/data-models/levels";
import { studentprogress } from "src/models/data-models/studentprogress";
import { students } from "src/models/data-models/students";
import { COMPLETED_PERCENTAGE, UNRENDERED_TEMPLATE_TYPES } from "src/models/enums/constant.enum";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Progress } from "src/models/enums/progress.enum";
import { curriculaInScope } from "./content-access";
import { learnersInScope, ReportScope } from "./report-scope";

/**
 * Certificate eligibility: for a set of learners and one scope of one curriculum (a level, a grade or the whole
 * curriculum), is every quiz in the scope passed by a result this server marked itself?
 *
 * The rule (decided by the product owner, 12 Nov 2026):
 *  - the quizzes in a scope are every lesson quiz of every live lesson of every live level under it, plus each such
 *    level's level quiz when it has one; a quiz with no active question cannot be taken and is left out; a scope
 *    with no quiz at all is `not_yet` (`no_quizzes`);
 *  - a quiz is PASSED when some attempt of the learner has `verified` and a result of COMPLETED_PERCENTAGE or more
 *    (the best attempt wins; a later, worse attempt never takes a pass away);
 *  - only an attempt the server marked counts. A result at or over the mark that the server did not mark is
 *    `unverified`: it is reported, and never counted as a pass. This is true whatever the grading settings are, so
 *    `countedpassclause` (which follows them) is deliberately not used here.
 *
 * Read-only. The number of queries is fixed (at most nine) whatever the number of learners, quizzes or levels.
 */

export const CERTIFICATE_SCOPES = ["level", "grade", "curriculum"] as const;
export type CertificateScope = (typeof CERTIFICATE_SCOPES)[number];

export const MAX_STUDENTIDS = 500;

export type QuizKind = "lesson" | "level";
export type QuizState = "passed" | "unverified" | "below" | "not_taken";
export type EligibilityStatus = "ready" | "cant_check" | "not_yet";

export interface ScopeQuiz {
  id: string;
  kind: QuizKind;
  name: string;
  level: { id: string; name: string };
  lesson?: { id: string; name: string };
}

export interface Attempt {
  /** Marked by this server's grading. */
  verified: boolean;
  /** The result, 0 to 100. */
  percentage: number;
}

export interface Reason {
  quiz: { id: string; kind: QuizKind; name: string };
  level: { id: string; name: string };
  lesson?: { id: string; name: string };
  state: Exclude<QuizState, "passed">;
  bestpercent: number | null;
}

export interface LearnerEligibility {
  studentid: string;
  status: EligibilityStatus;
  reasons: Array<Reason | { reason: "no_quizzes" }>;
  quizcount: number;
  passedcount: number;
}

// ---------------------------------------------------------------------------------------------------------
// the pure rule
// ---------------------------------------------------------------------------------------------------------

/** One learner's state for one quiz, from every attempt of theirs at it. */
export const quizState = (attempts: Attempt[]): { state: QuizState; bestpercent: number | null } => {
  if (attempts.length === 0) {
    return { state: "not_taken", bestpercent: null };
  }
  const best = Math.max(...attempts.map((a) => a.percentage));
  if (attempts.some((a) => a.verified && a.percentage >= COMPLETED_PERCENTAGE)) {
    return { state: "passed", bestpercent: best };
  }
  if (attempts.some((a) => !a.verified && a.percentage >= COMPLETED_PERCENTAGE)) {
    return { state: "unverified", bestpercent: best };
  }
  return { state: "below", bestpercent: best };
};

/** A learner's status over the quizzes in scope. `attemptsOf` answers the learner's attempts at one quiz (by quiz id). */
export const learnerEligibility = (studentid: string, quizzes: ScopeQuiz[], attemptsOf: (quizid: string) => Attempt[]): LearnerEligibility => {
  if (quizzes.length === 0) {
    return { studentid, status: "not_yet", reasons: [{ reason: "no_quizzes" }], quizcount: 0, passedcount: 0 };
  }
  const reasons: Reason[] = [];
  let passedcount = 0;
  for (const quiz of quizzes) {
    const { state, bestpercent } = quizState(attemptsOf(quiz.id));
    if (state === "passed") {
      passedcount += 1;
      continue;
    }
    reasons.push({ quiz: { id: quiz.id, kind: quiz.kind, name: quiz.name }, level: quiz.level, ...(quiz.lesson ? { lesson: quiz.lesson } : {}), state, bestpercent });
  }
  const status: EligibilityStatus = reasons.length === 0 ? "ready" : reasons.every((r) => r.state === "unverified") ? "cant_check" : "not_yet";
  return { studentid, status, reasons, quizcount: quizzes.length, passedcount };
};

export interface GradeRow { gradeid: string; gradename: string; gradeorder: number; gradestatus: boolean; isdeleted: boolean }
export interface LevelRow { levelid: string; gradeid: string; levelname: string; levelorder: number; levelstatus: boolean; isdeleted: boolean }
export interface LessonRow { lessonid: string; levelid: string; lessonname: string; lessonorder: number }
export interface LessonQuizRow { lessonquizid: string; lessonid: string; lessonquizname: string; lessonquizorder: number }

const lower = (x: unknown): string => String(x ?? "").toLowerCase();
const byOrder = (a: number | null | undefined, b: number | null | undefined, ida: string, idb: string): number =>
  (Number(a ?? 0) - Number(b ?? 0)) || (ida < idb ? -1 : ida > idb ? 1 : 0);

/** The levels of the curriculum that a scope covers (live ones only), or null when the scope id is not part of the curriculum. */
export const levelsOfScope = (
  content: { curriculumid: string; grades: GradeRow[]; levels: LevelRow[] },
  scope: CertificateScope,
  scopeid: string,
): LevelRow[] | null => {
  const live = (l: LevelRow) => Boolean(l.levelstatus) && !l.isdeleted;
  const liveGrade = (g: GradeRow) => Boolean(g.gradestatus) && !g.isdeleted;
  if (scope === "level") {
    const level = content.levels.find((l) => lower(l.levelid) === lower(scopeid));
    // a level whose grade is switched off or deleted is not live either
    const parent = level ? content.grades.find((g) => lower(g.gradeid) === lower(level.gradeid)) : undefined;
    return level ? (live(level) && parent !== undefined && liveGrade(parent) ? [level] : []) : null;
  }
  if (scope === "grade") {
    const grade = content.grades.find((g) => lower(g.gradeid) === lower(scopeid));
    return grade ? (liveGrade(grade) ? content.levels.filter((l) => lower(l.gradeid) === lower(grade.gradeid) && live(l)) : []) : null;
  }
  if (lower(scopeid) !== lower(content.curriculumid)) {
    return null;
  }
  const liveGrades = new Set(content.grades.filter(liveGrade).map((g) => lower(g.gradeid)));
  return content.levels.filter((l) => liveGrades.has(lower(l.gradeid)) && live(l));
};

/**
 * The quizzes in a scope, in teaching order (grade, level, lesson; each level's lesson quizzes, then its level quiz).
 * `activeLessonQuizIds` and `levelsWithQuiz` are the quizzes that have at least one active question.
 */
export const quizzesInScope = (
  content: { grades: GradeRow[]; levels: LevelRow[]; lessons: LessonRow[]; lessonquizzes: LessonQuizRow[] },
  scopeLevels: LevelRow[],
  activeLessonQuizIds: Set<string>,
  levelsWithQuiz: Set<string>,
): ScopeQuiz[] => {
  const gradeOrder = new Map(content.grades.map((g) => [lower(g.gradeid), Number(g.gradeorder ?? 0)]));
  const levelsInOrder = [...scopeLevels].sort(
    (a, b) => ((gradeOrder.get(lower(a.gradeid)) ?? 0) - (gradeOrder.get(lower(b.gradeid)) ?? 0)) || byOrder(a.levelorder, b.levelorder, a.levelid, b.levelid),
  );
  const out: ScopeQuiz[] = [];
  for (const level of levelsInOrder) {
    const lessonsOfLevel = content.lessons.filter((l) => lower(l.levelid) === lower(level.levelid)).sort((a, b) => byOrder(a.lessonorder, b.lessonorder, a.lessonid, b.lessonid));
    for (const lesson of lessonsOfLevel) {
      const quizzesOfLesson = content.lessonquizzes
        .filter((q) => lower(q.lessonid) === lower(lesson.lessonid) && activeLessonQuizIds.has(lower(q.lessonquizid)))
        .sort((a, b) => byOrder(a.lessonquizorder, b.lessonquizorder, a.lessonquizid, b.lessonquizid));
      for (const quiz of quizzesOfLesson) {
        out.push({
          id: quiz.lessonquizid,
          kind: "lesson",
          name: quiz.lessonquizname,
          level: { id: level.levelid, name: level.levelname },
          lesson: { id: lesson.lessonid, name: lesson.lessonname },
        });
      }
    }
    if (levelsWithQuiz.has(lower(level.levelid))) {
      out.push({ id: level.levelid, kind: "level", name: level.levelname, level: { id: level.levelid, name: level.levelname } });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------------------------------------

export interface EligibilityRequest {
  curriculumid: string;
  scope: CertificateScope;
  scopeid: string;
  studentids: string[];
}

const invalid = (field: string, message: string): ApiError =>
  new ApiError(ErrorCode.INVALID_INPUT, { message: `${field}: ${message}`, fields: [{ field, message } as FieldError] });

const idField = (body: Record<string, unknown>, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "" || value.length > 64) {
    throw invalid(field, "An id (text) is required.");
  }
  return value.trim();
};

/** The body, checked. Throws a 400 that names the field. */
export const parseEligibilityRequest = (raw: unknown): EligibilityRequest => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw invalid("curriculumid", "An id (text) is required.");
  }
  const body = raw as Record<string, unknown>;
  const curriculumid = idField(body, "curriculumid");
  if (typeof body.scope !== "string" || !(CERTIFICATE_SCOPES as readonly string[]).includes(body.scope)) {
    throw invalid("scope", "Must be one of level, grade or curriculum.");
  }
  const scopeid = idField(body, "scopeid");
  const ids = body.studentids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_STUDENTIDS) {
    throw invalid("studentids", `A list of 1 to ${MAX_STUDENTIDS} learner ids is required.`);
  }
  if (ids.some((id) => typeof id !== "string" || id.trim() === "" || id.length > 64)) {
    throw invalid("studentids", "Every learner id must be a non-empty text.");
  }
  return { curriculumid, scope: body.scope as CertificateScope, scopeid, studentids: (ids as string[]).map((id) => id.trim()) };
};

const raw = { raw: true } as const;
const asBool = (x: unknown): boolean => x === true || Number(x) === 1;

/**
 * The live lessons of the levels, their lesson quizzes, and which quizzes have an active question (the same filter the
 * quiz is scored and served with, quizscore.ts): four queries at most, whatever the number of levels. Shared with the
 * learner's certificates overview, which asks for every level of every curriculum at once.
 */
export async function loadQuizContent(levelids: string[]): Promise<{
  lessonRows: LessonRow[];
  quizRows: LessonQuizRow[];
  activeLessonQuizIds: Set<string>;
  levelsWithQuiz: Set<string>;
}> {
  const lessonRows = levelids.length
    ? ((await lessons.findAll({
        where: { levelid: { [Op.in]: levelids }, lessonstatus: true, isdeleted: false },
        attributes: ["lessonid", "levelid", "lessonname", "lessonorder"],
        ...raw,
      })) as unknown as LessonRow[])
    : [];
  const quizRows = lessonRows.length
    ? ((await lessonquizzes.findAll({
        where: { lessonid: { [Op.in]: lessonRows.map((l) => l.lessonid) }, lessonquizstatus: true },
        attributes: ["lessonquizid", "lessonid", "lessonquizname", "lessonquizorder"],
        ...raw,
      })) as unknown as LessonQuizRow[])
    : [];
  const activeQuestion = { association: "question", attributes: [], required: true, where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } } };
  const lessonQuizQuestionRows = quizRows.length
    ? ((await lessonquizquestions.findAll({
        where: { lessonquizid: { [Op.in]: quizRows.map((q) => q.lessonquizid) }, lessonquizquestionstatus: true },
        attributes: ["lessonquizid"],
        include: [activeQuestion],
        ...raw,
      })) as unknown as Array<{ lessonquizid: string }>)
    : [];
  const levelQuizQuestionRows = levelids.length
    ? ((await levelquizquestions.findAll({
        where: { levelid: { [Op.in]: levelids }, levelquizquestionstatus: true },
        attributes: ["levelid"],
        include: [activeQuestion],
        ...raw,
      })) as unknown as Array<{ levelid: string }>)
    : [];
  return {
    lessonRows,
    quizRows,
    activeLessonQuizIds: new Set(lessonQuizQuestionRows.map((r) => lower(r.lessonquizid))),
    levelsWithQuiz: new Set(levelQuizQuestionRows.map((r) => lower(r.levelid))),
  };
}

type AttemptRow = { studentid: string; progresstype: number; studentprogressreferenceid: string; resultpercentage: number | string | null; verified: unknown };

/** Every attempt of the learners at the quizzes, from `studentprogress` rows, by `studentid|quizid` (both lower case). */
export async function loadAttempts(studentids: string[], quizzes: ScopeQuiz[]): Promise<Map<string, Attempt[]>> {
  const attempts = new Map<string, Attempt[]>();
  if (studentids.length === 0 || quizzes.length === 0) {
    return attempts;
  }
  const attemptRows = (await studentprogress.findAll({
    where: {
      studentid: { [Op.in]: studentids },
      progresstype: { [Op.in]: [Progress.LESSONQUIZ, Progress.LEVELQUIZ] },
      studentprogressreferenceid: { [Op.in]: [...new Set(quizzes.map((q) => q.id))] },
    },
    attributes: ["studentid", "progresstype", "studentprogressreferenceid", "resultpercentage", "verified"],
    ...raw,
  })) as unknown as AttemptRow[];
  const kindOf = new Map(quizzes.map((q) => [lower(q.id), q.kind === "lesson" ? Progress.LESSONQUIZ : Progress.LEVELQUIZ]));
  for (const row of attemptRows) {
    // a row with no result is not an attempt
    if (row.resultpercentage === null || row.resultpercentage === undefined) {
      continue;
    }
    // a lesson quiz is stored with progresstype 2 and a level quiz with 3, both under the quiz's own id
    if (kindOf.get(lower(row.studentprogressreferenceid)) !== Number(row.progresstype)) {
      continue;
    }
    const key = `${lower(row.studentid)}|${lower(row.studentprogressreferenceid)}`;
    attempts.set(key, [...(attempts.get(key) ?? []), { verified: asBool(row.verified), percentage: Number(row.resultpercentage) || 0 }]);
  }
  return attempts;
}

/**
 * The eligibility of the learners the caller may see, in the order the caller gave them. A learner id that is not a learner
 * in the scope (unknown, or of another organisation or school) is left out, exactly as an unknown id is.
 *
 * A curriculum the scope does not cover answers as one that does not exist (404). A scope id that is not part of the
 * curriculum is a 400 naming `scopeid`.
 */
export async function certificateEligibility(request: EligibilityRequest, scope: ReportScope | null): Promise<LearnerEligibility[]> {
  // 1. the curriculum, inside the caller's scope (another organisation's answers as nonexistent)
  const visible = scope
    ? await curriculaInScope({ organisationid: scope.organisationid, curriculumids: scope.curriculumids }, [request.curriculumid])
    : ((await curriculums.findOne({ where: { curriculumid: request.curriculumid }, attributes: ["curriculumid"], ...raw })) as unknown as { curriculumid: string } | null)
      ? [request.curriculumid]
      : [];
  if (visible.length === 0) {
    throw new ApiError(ErrorCode.NOT_FOUND);
  }

  // 2-3. the curriculum's grades and levels (switched-off ones included: they decide which scope ids are valid)
  const gradeRows = (await grades.findAll({ where: { curriculumid: request.curriculumid }, attributes: ["gradeid", "gradename", "gradeorder", "gradestatus", "isdeleted"], ...raw })) as unknown as GradeRow[];
  const levelRows = gradeRows.length
    ? ((await levels.findAll({
        where: { gradeid: { [Op.in]: gradeRows.map((g) => g.gradeid) } },
        attributes: ["levelid", "gradeid", "levelname", "levelorder", "levelstatus", "isdeleted"],
        ...raw,
      })) as unknown as LevelRow[])
    : [];
  const scopeLevels = levelsOfScope({ curriculumid: request.curriculumid, grades: gradeRows, levels: levelRows }, request.scope, request.scopeid);
  if (scopeLevels === null) {
    throw invalid("scopeid", "That is not part of this curriculum.");
  }
  const levelids = scopeLevels.map((l) => l.levelid);

  // 4-7. live lessons, their lesson quizzes, and which quizzes have an active question
  const { lessonRows, quizRows, activeLessonQuizIds, levelsWithQuiz } = await loadQuizContent(levelids);
  const quizzes = quizzesInScope(
    { grades: gradeRows, levels: levelRows, lessons: lessonRows, lessonquizzes: quizRows },
    scopeLevels,
    activeLessonQuizIds,
    levelsWithQuiz,
  );

  // 8. the learners the caller may see
  const asked = [...new Map(request.studentids.map((id) => [lower(id), id])).values()];
  const known = (await students.findAll({ where: { studentid: { [Op.in]: asked }, ...learnersInScope(scope) }, attributes: ["studentid"], ...raw })) as unknown as Array<{ studentid: string }>;
  const knownIds = new Set(known.map((s) => lower(s.studentid)));
  const learners = asked.filter((id) => knownIds.has(lower(id)));
  if (learners.length === 0) {
    return [];
  }
  if (quizzes.length === 0) {
    return learners.map((id) => learnerEligibility(id, quizzes, () => []));
  }

  // 9. every attempt of those learners at those quizzes
  const attempts = await loadAttempts(learners, quizzes);
  return learners.map((id) => learnerEligibility(id, quizzes, (quizid) => attempts.get(`${lower(id)}|${lower(quizid)}`) ?? []));
}
