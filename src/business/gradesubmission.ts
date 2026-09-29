import { Logger } from "src/config";
import { gradeAnswer, isAnswerV1, QuestionForGrading } from "./grading";

export type ServerGrade = "correct" | "incorrect" | "ungradable";

export interface GradableSubmittedItem {
  iscorrect: boolean;
  answer?: unknown;
  [key: string]: unknown;
}

export interface GradeSubmissionResult<T> {
  /**
   * EVERY submitted item, unchanged in count — a duplicate item is neither
   * dropped nor merged. `iscorrect` is that single item's own individually
   * graded verdict (see the per-item rule below); `clientiscorrect` and
   * `servergrade` are its ground-truth record, independent of mode or of
   * whether this item ends up counted for scoring.
   */
  items: (T & { iscorrect: boolean; clientiscorrect: boolean; servergrade: ServerGrade | null })[];
  /**
   * Exactly one item per key in `activeQuestions` that had at least one
   * submitted item — the FIRST submitted item for that question, in
   * submission order. This is the only input the caller should hand to
   * scorelessonquiz/scorelevelquiz/scorebaseline/scorepractice and to the
   * `correct` list for points: a learner (or a compromised client) cannot
   * inflate a score by attaching extra duplicate items — the exploit this
   * fixes, where a second, unanswered or malformed item claiming
   * `iscorrect: true` rode along on an otherwise-honest, server-graded-wrong
   * submission and flipped the question to "correct".
   */
  scoringItems: (T & { iscorrect: boolean })[];
  /**
   * True only in "enforce" mode, and only when every active, renderable
   * question's COUNTED item (see scoringItems) was actually gradable
   * (servergrade "correct" or "incorrect", never "ungradable" or missing).
   * "verified" means "this row's score came from the server, not the
   * client" — shadow mode never sets it, by definition it can't have: shadow
   * scoring always uses the client's own claim.
   */
  verified: boolean;
}

/** Internal per-item classification, used to decide the item's own iscorrect under enforce. */
type Category =
  | "gradable" // a real, gradable server verdict exists
  | "badanswer" // an answer was submitted but it's structurally invalid, or the wrong shape for the question's template — the client attempted the protocol and got it wrong
  | "noinfo"; // nothing to hold against the client: no answer at all, or a legitimately ungradable template/prototype

function classify(
  raw: { answer?: unknown; [k: string]: unknown },
  question: QuestionForGrading | undefined,
): { category: Category; servergrade: ServerGrade | null; correct: boolean | null } {
  if (!question) {
    // Not an active question at all (foreign/inactive/unrenderable id) — nothing to grade against.
    return { category: "noinfo", servergrade: null, correct: null };
  }
  if (raw.answer === undefined || raw.answer === null) {
    return { category: "noinfo", servergrade: "ungradable", correct: null };
  }
  if (!isAnswerV1(raw.answer)) {
    // Present, but not even a valid AnswerV1 envelope: the client used the
    // new protocol and sent garbage, as opposed to simply not answering.
    return { category: "badanswer", servergrade: "ungradable", correct: null };
  }
  const result = gradeAnswer(question, raw.answer);
  if (result.gradable) {
    return { category: "gradable", servergrade: result.correct ? "correct" : "incorrect", correct: result.correct };
  }
  if (result.reason === "malformed" || result.reason === "type-mismatch") {
    return { category: "badanswer", servergrade: "ungradable", correct: null };
  }
  // "no-answer" (the library's own check), "unsupported-template" or
  // "prototype-not-graded": a well-formed answer we simply can't grade yet —
  // not the client's fault, so it falls back to their claim like "noinfo".
  return { category: "noinfo", servergrade: "ungradable", correct: null };
}

/**
 * The item's own iscorrect for STORAGE purposes — computed independently
 * for every item, including duplicates. See classify() for what "gradable"
 * / "badanswer" / "noinfo" mean.
 *
 * Shadow mode never looks at any of this: it always scores the client's own
 * claim, full stop, so a submission is scored identically whether or not
 * GRADING_MODE is ever turned to enforce later (shadow's whole point is to
 * be comparable, risk-free, ahead of that switch).
 *
 * Enforce mode: a real server verdict (gradable) wins outright. A
 * structurally-bad answer (badanswer) is scored incorrect regardless of the
 * client's claim — the client attempted the protocol and produced garbage,
 * which must never be more advantageous than answering honestly. Anything
 * else (noinfo: no answer submitted, or a template we can't grade yet)
 * falls back to the client's own claim, same as an old app that never sends
 * `answer` at all.
 */
function effectiveIscorrect(
  mode: "shadow" | "enforce",
  clientiscorrect: boolean,
  category: Category,
  correct: boolean | null,
): boolean {
  if (mode === "shadow") {
    return clientiscorrect;
  }
  if (category === "gradable") {
    return correct as boolean;
  }
  if (category === "badanswer") {
    return false;
  }
  return clientiscorrect;
}

/**
 * Grades a submission's items against the activity's active questions (the
 * server-grading protocol).
 *
 * `idKey` is the property on each item that identifies which active
 * question it answers (e.g. "lessonquizquestionid"). `activeQuestions` is
 * keyed the same way (see quizscore.ts / practicescore.ts's
 * get*gradablequestions functions).
 */
export function gradeSubmissionItems<T extends GradableSubmittedItem>(
  items: T[],
  activeQuestions: Map<string, QuestionForGrading>,
  idKey: string,
  mode: "shadow" | "enforce",
): GradeSubmissionResult<T> {
  // First-submitted-item-per-active-question wins for scoring; every item
  // (first or duplicate) still gets graded and stored below.
  const firstSeenIndexByActiveId = new Map<string, number>();

  const graded = items.map((raw, index) => {
    const clientiscorrect = raw.iscorrect === true;
    const activeid = raw[idKey] as string | undefined;
    const question = activeid !== undefined ? activeQuestions.get(activeid) : undefined;
    const { category, servergrade, correct } = classify(raw, question);

    // Dedup by the raw idKey value alone — NOT gated on whether our own
    // `activeQuestions` map happens to have grading data for it. The
    // question of "is this actually an active, renderable question" is the
    // scorer's own job (scorelessonquiz/scorelevelquiz/scorebaseline/
    // scorepractice each run their own active-question query); ours is only
    // "of the items submitted for this id, which one counts". Gating this
    // on `question` truthiness would silently drop every item into
    // scoringItems whenever this id isn't one we could find grading data
    // for, which is wrong whether that's because it's genuinely not active
    // (harmless — the scorer ignores it) or, as this bit us in review,
    // because the caller's own active-question fetch turned up empty for a
    // question the scorer's independent query still recognises as active.
    if (activeid !== undefined && !firstSeenIndexByActiveId.has(activeid)) {
      firstSeenIndexByActiveId.set(activeid, index);
    }

    return {
      ...raw,
      iscorrect: effectiveIscorrect(mode, clientiscorrect, category, correct),
      clientiscorrect,
      servergrade,
      // Not part of the public shape (stripped before returning below) —
      // carried through this map only so the scoringItems pass doesn't need
      // to re-classify.
      __category: category,
    };
  });

  const scoringItems = Array.from(firstSeenIndexByActiveId.values())
    .sort((a, b) => a - b)
    .map((index) => graded[index]);

  const verified =
    mode === "enforce" &&
    Array.from(activeQuestions.keys()).every((id) => {
      const index = firstSeenIndexByActiveId.get(id);
      return index !== undefined && graded[index].__category === "gradable";
    });

  const stripCategory = <U extends { __category: Category }>(x: U): Omit<U, "__category"> => {
    const { __category, ...rest } = x;
    return rest;
  };

  return {
    items: graded.map(stripCategory) as GradeSubmissionResult<T>["items"],
    scoringItems: scoringItems.map(stripCategory) as GradeSubmissionResult<T>["scoringItems"],
    verified,
  };
}

/**
 * Shadow-mode visibility (server-grading protocol): one info-level line per
 * submission, counting client-vs-server disagreements by templatetypeid.
 * No learner identifiers — just the route name and counts — so the
 * disagreement rate can be measured before flipping GRADING_MODE to enforce.
 *
 * Takes the full `items` list (not `scoringItems`): a disagreement on a
 * duplicate item that never counted toward the score is still worth seeing.
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
