/**
 * Graders for templates 1-8 (and, via gradeChoice, DOption1/18), matching
 * how the Expo app itself decides correctness so a server-graded answer
 * agrees with the client's own submitted verdict. Each grader's docstring
 * names the app file it mirrors, read at edtech-expo origin/main.
 */
import { GradingOption } from "./option";

/**
 * choice (MCQSingleText/MCQMultiText/MCQSingleImage/MCQMultiImage, DOption1):
 * mirrors PracticeMCQText.tsx / PracticeMCQImage.tsx handleSubmit, and
 * DOption1.tsx's `attempt.selection?.questionoptioniscorrect`. The app
 * walks every option and fails the attempt as soon as either a correct
 * option was not selected, or an incorrect option was selected — i.e. the
 * selected set must equal exactly the set of options with
 * questionoptioniscorrect === true (no partial credit, no tolerance for
 * extra selections).
 */
export function gradeChoice(options: GradingOption[], selected: string[]): boolean {
  const correctIds = new Set(options.filter((o) => o.questionoptioniscorrect).map((o) => o.questionoptionid));
  const selectedIds = new Set(selected);
  if (selectedIds.size !== selected.length) return false; // duplicate selections are not a legitimate single choice
  if (selectedIds.size !== correctIds.size) return false;
  for (const id of selectedIds) {
    if (!correctIds.has(id)) return false;
  }
  return true;
}

/**
 * order (TextOrdering/ImageOrdering): mirrors PracticeArrangeText.tsx and
 * PracticeArrangeImage.tsx handleSubmit. ArrangeText additionally requires
 * the submitted length to equal the option count (ArrangeImage always
 * submits every option since it only ever reorders the full set in place).
 * Both walk the submitted order comparing each item's
 * questionoptionsequence against the previous one, starting from a
 * baseline of 0, and fail only on a *decrease* — equal sequence numbers
 * (ties) are accepted, matching the app.
 *
 * We additionally require `order` to be a permutation of the real option
 * ids (every id appears, none repeated, none foreign) — the app's UI can
 * only ever produce that by construction (each option is consumed once),
 * so this does not change behaviour for any answer the real app could
 * produce; it just keeps a server-only answer honest.
 */
export function gradeOrder(options: GradingOption[], order: string[]): boolean {
  if (order.length !== options.length) return false;
  if (new Set(order).size !== order.length) return false;
  const byId = new Map(options.map((o) => [o.questionoptionid, o]));
  let currentSequence = 0;
  for (const id of order) {
    const opt = byId.get(id);
    if (!opt || typeof opt.questionoptionsequence !== "number") return false;
    if (opt.questionoptionsequence < currentSequence) return false;
    currentSequence = opt.questionoptionsequence;
  }
  return true;
}

/**
 * match (DragDrop): mirrors PracticeDragDrop.tsx handleSubmit — every
 * option's id must be dragged onto the drop target with that same id
 * (`answers[optionid] === optionid` for every option).
 */
export function gradeMatch(options: GradingOption[], pairs: Record<string, string>): boolean {
  for (const o of options) {
    if (pairs[o.questionoptionid] !== o.questionoptionid) return false;
  }
  return true;
}

/**
 * blanks (FillInBlank): mirrors PracticeFillBlank.tsx handleSubmit. The
 * "real" options are `questionoptions` (distractors, pulled in separately
 * from `questiondistractors` via fromQuestionDistractorToQuestionOption,
 * carry no `questionoptionsequence` and so always fail the sequence check
 * below — the same effect as excluding them explicitly).
 *
 * The app has a single-option quirk worth mirroring exactly: its
 * correctness check only enforces `questionoptioniscorrect === true` on
 * each filled item when there is more than one real option
 * (`questionOptions.length > 1`). When a blank has exactly one real
 * option, that check is skipped entirely and only the sequence/identity
 * check applies — so a mis-authored single-option blank whose sole real
 * option has `questionoptioniscorrect: false` would still be accepted by
 * the app. We reproduce that rather than "fix" it, since step 1b must
 * agree with the client's own verdict.
 */
export function gradeBlanks(options: GradingOption[], filled: string[]): boolean {
  const requiredCount = options.length;
  if (filled.length !== requiredCount) return false;
  const byId = new Map(options.map((o) => [o.questionoptionid, o]));
  let currentSequence = 0;
  for (const id of filled) {
    const opt = byId.get(id);
    if (!opt || typeof opt.questionoptionsequence !== "number") return false;
    if (opt.questionoptionsequence < currentSequence) return false;
    if (requiredCount > 1 && opt.questionoptioniscorrect !== true) return false;
    currentSequence = opt.questionoptionsequence;
  }
  return true;
}
