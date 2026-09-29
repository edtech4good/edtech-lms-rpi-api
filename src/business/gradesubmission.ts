import { Logger } from "src/config";
import { gradeAnswer, isAnswerV1, QuestionForGrading } from "./grading";

export type ServerGrade = "correct" | "incorrect" | "ungradable";

export interface GradableSubmittedItem {
  iscorrect: boolean;
  answer?: unknown;
  [key: string]: unknown;
}

export interface GradedItem<T> {
  item: T;
  /** The client's original claim, preserved regardless of mode. */
  clientiscorrect: boolean;
  /** null when there was nothing to grade against at all (see servergrade below). */
  servergrade: ServerGrade | null;
  /** The flag scoring should use — client's claim in shadow, server's grade in enforce (when gradable). */
  effectiveiscorrect: boolean;
}

export interface GradeSubmissionResult<T> {
  /** Same items, `iscorrect` set to `effectiveiscorrect`, plus `clientiscorrect`/`servergrade` for storage. */
  items: (T & { iscorrect: boolean; clientiscorrect: boolean; servergrade: ServerGrade | null })[];
  /** True iff every active question in `activeQuestions` has at least one submitted item with a gradable server grade. */
  verified: boolean;
}

/**
 * Grades a submission's items against the activity's active questions
 * (workspace#79 step 1b).
 *
 * `idKey` is the property on each item that identifies which active
 * question it answers (e.g. "lessonquizquestionid"). `activeQuestions` is
 * keyed the same way (see quizscore.ts / practicescore.ts's
 * get*gradablequestions functions).
 *
 * Mode ("shadow" | "enforce") only changes what `effectiveiscorrect` (and
 * therefore the returned `iscorrect`) ends up as; `clientiscorrect` and
 * `servergrade` are recorded identically in either mode, so shadow mode's
 * data is directly comparable to what enforce mode would have scored.
 */
export function gradeSubmissionItems<T extends GradableSubmittedItem>(
  items: T[],
  activeQuestions: Map<string, QuestionForGrading>,
  idKey: string,
  mode: "shadow" | "enforce",
): GradeSubmissionResult<T> {
  const gradedActiveIds = new Set<string>();

  const graded = items.map((raw) => {
    const clientiscorrect = raw.iscorrect === true;
    const activeid = raw[idKey] as string | undefined;
    const question = activeid !== undefined ? activeQuestions.get(activeid) : undefined;

    let servergrade: ServerGrade | null = null;
    let gradableCorrect: boolean | null = null;

    if (question) {
      if (raw.answer !== undefined && raw.answer !== null && isAnswerV1(raw.answer)) {
        const result = gradeAnswer(question, raw.answer);
        if (result.gradable) {
          servergrade = result.correct ? "correct" : "incorrect";
          gradableCorrect = result.correct;
          gradedActiveIds.add(activeid as string);
        } else {
          servergrade = "ungradable";
        }
      } else {
        // No (valid) answer submitted for a question we can otherwise grade.
        servergrade = "ungradable";
      }
    }

    const effectiveiscorrect =
      mode === "enforce" && gradableCorrect !== null ? gradableCorrect : clientiscorrect;

    return {
      ...raw,
      iscorrect: effectiveiscorrect,
      clientiscorrect,
      servergrade,
    };
  });

  const verified = Array.from(activeQuestions.keys()).every((id) => gradedActiveIds.has(id));

  return { items: graded, verified };
}

/**
 * Shadow-mode visibility (workspace#79 step 1b #4): one info-level line per
 * submission, counting client-vs-server disagreements by templatetypeid.
 * No learner identifiers — just the route name and counts — so the
 * disagreement rate can be measured before flipping GRADING_MODE to enforce.
 */
export function logGradingDisagreements(
  route: string,
  items: { clientiscorrect: boolean; servergrade: ServerGrade | null }[],
  activeQuestions: Map<string, QuestionForGrading>,
  idKeyValues: (string | undefined)[],
): void {
  let graded = 0;
  const disagreementsByTemplate: Record<number, number> = {};

  items.forEach((it, i) => {
    if (it.servergrade === null || it.servergrade === "ungradable") {
      return;
    }
    graded += 1;
    const servercorrect = it.servergrade === "correct";
    if (servercorrect !== it.clientiscorrect) {
      const activeid = idKeyValues[i];
      const templatetypeid = activeid ? activeQuestions.get(activeid)?.templatetypeid : undefined;
      const key = templatetypeid ?? -1;
      disagreementsByTemplate[key] = (disagreementsByTemplate[key] ?? 0) + 1;
    }
  });

  const totalDisagreements = Object.values(disagreementsByTemplate).reduce((a, b) => a + b, 0);
  Logger.info(`grading shadow comparison for ${route}`, {
    route,
    submitted: items.length,
    graded,
    disagreements: totalDisagreements,
    disagreementsByTemplate,
  });
}
