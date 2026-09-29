/**
 * Pure server-side answer grading library (workspace#79, step 1a / phase 1).
 *
 * Nothing in this module talks to the database or to Nest — it takes a
 * question's stored shape and a learner's submitted answer and returns a
 * verdict. Nothing in the app calls it yet; wiring it into the result
 * pipeline is a separate PR (step 1b) coded against the interface below.
 *
 * Template ids (edtech-expo src/constants/QuestionTemplate.ts):
 *   1 MCQSingleText   2 MCQSingleImage   3 MCQMultiText   4 MCQMultiImage
 *   5 TextOrdering    6 ImageOrdering    7 DragDrop       8 FillInBlank
 *   9-17              (no renderer; unsupported)
 *   18 DOption1  19 DOption3  20 DOption4
 *   21 FOption1  22 FOption2  23 FOption4  24 Fraction
 */
import { GradingOption, parseOptions } from "./option";
import { gradeBlanks, gradeChoice, gradeMatch, gradeOrder } from "./templates";

export { normaliseTyped } from "./normalise";
export { prototypeGraders } from "./prototypes";

export type AnswerV1 =
  | { v: 1; type: "choice"; selected: string[] } // option ids (MCQ text/image single+multi, DOption1)
  | { v: 1; type: "order"; order: string[] } // option ids in the learner's order (order text/images)
  | { v: 1; type: "match"; pairs: Record<string, string> } // target option id -> dragged option id (drag/match)
  | { v: 1; type: "blanks"; filled: string[] } // tile/option ids in blank order (fill-blank tiles)
  | { v: 1; type: "counts"; counts: Record<string, number> } // option id -> count (DOption3/DOption4)
  | { v: 1; type: "text"; entries: Record<string, string> } // blank/option id -> typed text (FOption1/2/4)
  | { v: 1; type: "fraction"; parts: Record<string, { numerator: string; denominator: string }> };

export type GradeResult =
  | { gradable: true; correct: boolean }
  | { gradable: false; reason: "no-answer" | "unsupported-template" | "type-mismatch" | "malformed" | "prototype-not-graded" };

export interface QuestionForGrading {
  templatetypeid: number;
  questionoptions: unknown;
  questioncorrectvalue?: unknown;
  questiondistractors?: unknown;
}

const UNSUPPORTED_TEMPLATES = new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]);
const PROTOTYPE_TEMPLATES = new Set([18, 19, 20, 21, 22, 23, 24]);

/** The AnswerV1 `type` each graded template (1-8) expects. */
const EXPECTED_TYPE: Record<number, AnswerV1["type"]> = {
  1: "choice",
  2: "choice",
  3: "choice",
  4: "choice",
  5: "order",
  6: "order",
  7: "match",
  8: "blanks",
};

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === "string");
}

function isStringRecord(x: unknown): x is Record<string, string> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  return Object.values(x as Record<string, unknown>).every((v) => typeof v === "string");
}

/** `counts` values are tap counts: never negative, never fractional. */
function isCountsRecord(x: unknown): x is Record<string, number> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  return Object.values(x as Record<string, unknown>).every(
    (v) => typeof v === "number" && Number.isInteger(v) && v >= 0,
  );
}

function isFractionPartRecord(x: unknown): x is Record<string, { numerator: string; denominator: string }> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  return Object.values(x as Record<string, unknown>).every((v) => {
    if (!v || typeof v !== "object") return false;
    const part = v as Record<string, unknown>;
    return typeof part.numerator === "string" && typeof part.denominator === "string";
  });
}

/**
 * Shape validation only — never throws, never touches a question or
 * template. `x.v` must be exactly `1` and the payload for `x.type` must
 * match; anything else (wrong version, unknown type, wrong-shaped payload,
 * not an object at all) is rejected.
 */
export function isAnswerV1(x: unknown): x is AnswerV1 {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const a = x as Record<string, unknown>;
  if (a.v !== 1) return false;
  switch (a.type) {
    case "choice":
      return isStringArray(a.selected);
    case "order":
      return isStringArray(a.order);
    case "match":
      return isStringRecord(a.pairs);
    case "blanks":
      return isStringArray(a.filled);
    case "counts":
      return isCountsRecord(a.counts);
    case "text":
      return isStringRecord(a.entries);
    case "fraction":
      return isFractionPartRecord(a.parts);
    default:
      return false;
  }
}

function gradeCore(templatetypeid: number, options: GradingOption[], answer: AnswerV1): boolean {
  switch (answer.type) {
    case "choice":
      return gradeChoice(options, answer.selected);
    case "order":
      return gradeOrder(options, answer.order);
    case "match":
      return gradeMatch(options, answer.pairs);
    case "blanks":
      return gradeBlanks(options, answer.filled);
    /* istanbul ignore next -- unreachable: templatetypeid 1-8 never expect
       counts/text/fraction, so EXPECTED_TYPE already turned these into a
       type-mismatch before gradeCore is called. */
    default:
      return false;
  }
}

/**
 * Grades one answer against one question.
 *
 *  - Templates 9-17 have no renderer: always `unsupported-template`.
 *  - Templates 18-24 are practice-only prototypes for now (workspace#79
 *    decision 5): always `prototype-not-graded`, regardless of the answer.
 *    Their real graders live in `prototypeGraders`, tested directly.
 *  - Templates 1-8: `no-answer` when nothing was submitted, `malformed`
 *    when the answer isn't valid AnswerV1 shape or the question's own
 *    `questionoptions` can't be parsed, `type-mismatch` when the answer's
 *    `type` doesn't match what this template grades, otherwise a verdict.
 */
export function gradeAnswer(question: QuestionForGrading, answer: unknown): GradeResult {
  const { templatetypeid } = question;

  if (UNSUPPORTED_TEMPLATES.has(templatetypeid)) {
    return { gradable: false, reason: "unsupported-template" };
  }
  if (PROTOTYPE_TEMPLATES.has(templatetypeid)) {
    return { gradable: false, reason: "prototype-not-graded" };
  }

  const expectedType = EXPECTED_TYPE[templatetypeid];
  if (!expectedType) {
    return { gradable: false, reason: "unsupported-template" };
  }

  if (answer === undefined || answer === null) {
    return { gradable: false, reason: "no-answer" };
  }
  if (!isAnswerV1(answer)) {
    return { gradable: false, reason: "malformed" };
  }
  if (answer.type !== expectedType) {
    return { gradable: false, reason: "type-mismatch" };
  }

  const options = parseOptions(question.questionoptions);
  if (!options) {
    return { gradable: false, reason: "malformed" };
  }

  return { gradable: true, correct: gradeCore(templatetypeid, options, answer) };
}
