/**
 * STUB — replaced whole-cloth when the parallel step 1a PR
 * (`feat/grading-library`, refs workspace#79) merges its real
 * `src/business/grading/index.ts`.
 *
 * Until then, every question is reported as gradable: false, so shadow mode
 * has nothing to compare and enforce mode never overrides a client's claim.
 * This lets step 1b (this PR) land, ship, and be exercised end-to-end
 * (validator, storage, mode plumbing, verified/REQUIRE_GRADED_ANSWERS logic)
 * without depending on the grader implementations landing first.
 *
 * Kept as its own commit in this PR specifically so the eventual merge of
 * the real library is a trivial "replace this file" — see the PR
 * description.
 */

export type AnswerV1 = {
  v: 1;
  type: "choice" | "order" | "match" | "blanks" | "counts" | "text" | "fraction";
  // type-specific fields
  [k: string]: unknown;
};

export type GradeResult =
  | { gradable: true; correct: boolean }
  | {
      gradable: false;
      reason: "no-answer" | "unsupported-template" | "type-mismatch" | "malformed" | "prototype-not-graded";
    };

export interface QuestionForGrading {
  templatetypeid: number;
  questionoptions: unknown;
  questioncorrectvalue?: unknown;
  questiondistractors?: unknown;
}

export function gradeAnswer(_question: QuestionForGrading, _answer: unknown): GradeResult {
  return { gradable: false, reason: "unsupported-template" };
}

export function isAnswerV1(x: unknown): x is AnswerV1 {
  if (typeof x !== "object" || x === null) {
    return false;
  }
  const v = x as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.type === "string" &&
    ["choice", "order", "match", "blanks", "counts", "text", "fraction"].includes(v.type)
  );
}
