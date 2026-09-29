/**
 * Graders for the prototype templates (18-24). Per workspace#79 decision 5
 * these stay out of quizzes for now (gradeAnswer in ./index.ts always
 * returns `prototype-not-graded` for them) — they are implemented and
 * tested here, behind this named export, so wiring one in later is a
 * one-line change in index.ts's dispatch table.
 *
 * Two of these intentionally *fix* a bug in the app's own grading rather
 * than mirror it, because the task is to grade the *intended* rule once
 * these templates are turned on — see each function's docstring.
 */
import { typedAnswerEquals } from "./normalise";
import { GradingOption } from "./option";
import { gradeChoice } from "./templates";

/** DOption1 (18) is a single-selection choice question; reuses the MCQ
 * grader (DOption1.tsx: `attempt.selection?.questionoptioniscorrect`, which
 * is exactly "the one selected option is in the correct set"). */
export const gradeDOption1 = gradeChoice;

/**
 * DOption3 (19): counts — option id -> number of taps. The app
 * (DOption3.tsx handleSubmit) has a real bug: it only walks
 * `data.answers`, i.e. the areas the learner actually tapped, and compares
 * each to `questionoptionvalue`. An area that needed N > 0 taps but was
 * never tapped at all is simply never checked, so it's possible to submit
 * a partial answer and still pass. We grade the *intended* rule instead:
 * every option with a numeric `questionoptionvalue` (the tappable areas —
 * options without one are the fixed operator/label glyphs the app renders
 * as plain text and never makes tappable) must have its submitted count
 * (defaulting to 0 when untapped) equal that value.
 */
export function gradeDOption3(options: GradingOption[], counts: Record<string, number>): boolean {
  for (const o of options) {
    if (typeof o.questionoptionvalue !== "number") continue;
    const submitted = counts[o.questionoptionid] ?? 0;
    if (submitted !== o.questionoptionvalue) return false;
  }
  return true;
}

/**
 * DOption4 (20): counts — option id -> number of taps, each worth
 * `questionoptionvalue`; mirrors DOption4.tsx handleSubmit, which sums
 * `questionoptionvalue * count` over every tapped option and compares the
 * total against `question.questioncorrectvalue` (stringified equality in
 * the app; we compare numerically, which is equivalent for well-formed
 * numeric data and more forgiving of formatting).
 */
export function gradeDOption4(
  options: GradingOption[],
  counts: Record<string, number>,
  questioncorrectvalue: number | undefined,
): boolean | undefined {
  if (typeof questioncorrectvalue !== "number") return undefined;
  const byId = new Map(options.map((o) => [o.questionoptionid, o]));
  let total = 0;
  for (const [id, count] of Object.entries(counts)) {
    const opt = byId.get(id);
    if (!opt || typeof opt.questionoptionvalue !== "number") continue;
    total += opt.questionoptionvalue * count;
  }
  return total === questioncorrectvalue;
}

/**
 * FOption1 (21): typed text per option, mirrors FOption1.tsx handleSubmit
 * (`value.answer !== value.option.questionoptiontext` for every option).
 * The app compares raw strings; we apply the forgiving-match rule
 * (workspace#79 decision 4) on top, since this is exactly the kind of
 * typed free-text answer that rule exists for.
 */
export function gradeFOption1(options: GradingOption[], entries: Record<string, string>): boolean {
  for (const o of options) {
    const typed = entries[o.questionoptionid] ?? "";
    if (!typedAnswerEquals(typed, o.questionoptiontext ?? "")) return false;
  }
  return true;
}

/**
 * FOption4 (23): typed text per option compared against
 * `questionoptionvalue` (a number, typically rendered as digits) rather
 * than `questionoptiontext`; mirrors FOption4.tsx handleSubmit
 * (`value.answer !== \`${value.option.questionoptionvalue}\``). Forgiving
 * match applies, and since the target is numeric, equal values are
 * compared numerically (so Khmer-digit input matches ASCII).
 */
export function gradeFOption4(options: GradingOption[], entries: Record<string, string>): boolean {
  for (const o of options) {
    const typed = entries[o.questionoptionid] ?? "";
    const expected = typeof o.questionoptionvalue === "number" ? String(o.questionoptionvalue) : "";
    if (!typedAnswerEquals(typed, expected)) return false;
  }
  return true;
}

/**
 * FOption2 (22): a single typed numeric answer, mirrors FOption2.tsx
 * handleSubmit, which has a real bug — it hard-codes
 * `questionOptions[4]?.questionoptionvalue` as "the answer field" instead
 * of naming it, so authoring the options in any order/count other than the
 * 5-slot equation layout the screen was built for silently compares
 * against the wrong (or a missing) option. We reproduce the same
 * hard-coded-index lookup rather than fix it, since fixing it would need a
 * data model change (a way to mark which option is the answer) that is out
 * of scope here; the answer is keyed by whatever option id sits at index 4
 * in `questionoptions`, exactly as the app renders it.
 */
export function gradeFOption2(options: GradingOption[], entries: Record<string, string>): boolean | undefined {
  const target = options[4];
  if (!target) return undefined;
  const typed = entries[target.questionoptionid] ?? "";
  const expected = typeof target.questionoptionvalue === "number" ? String(target.questionoptionvalue) : "";
  return typedAnswerEquals(typed, expected);
}

/**
 * Fraction (24): mirrors PracticeFraction.tsx handleSubmit. For every
 * option that isn't a plain text label (`questionoptionistext`), the
 * numerator must match `questionoptionnumeratorvalue` unless it's marked
 * static (pre-filled, nothing to type); the denominator is checked the
 * same way, but only when the option `questionoptionisfraction`.
 */
export function gradeFraction(
  options: GradingOption[],
  parts: Record<string, { numerator: string; denominator: string }>,
): boolean {
  for (const o of options) {
    if (o.questionoptionistext) continue;
    const part = parts[o.questionoptionid] ?? { numerator: "", denominator: "" };
    if (!o.questionoptionnumeratorisstatic) {
      if (!typedAnswerEquals(part.numerator, o.questionoptionnumeratorvalue ?? "")) return false;
    }
    if (o.questionoptionisfraction && !o.questionoptiondenominatorisstatic) {
      if (!typedAnswerEquals(part.denominator, o.questionoptiondenominatorvalue ?? "")) return false;
    }
  }
  return true;
}

export const prototypeGraders = {
  gradeDOption1,
  gradeDOption3,
  gradeDOption4,
  gradeFOption1,
  gradeFOption2,
  gradeFOption4,
  gradeFraction,
};
