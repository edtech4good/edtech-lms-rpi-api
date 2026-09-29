import { Op } from "sequelize";
import { lessonpracticequestions } from "src/models/data-models/init-models";
import { COMPLETED_PERCENTAGE, UNRENDERED_TEMPLATE_TYPES } from "src/models/enums/constant.enum";

/**
 * Score a lesson-practice attempt against the practice itself, not against
 * the submitted payload.
 *
 * The previous rule was `correct / submitted * 100`. The Expo client only
 * sends the answers the learner got right, so any attempt with at least one
 * correct answer scored 100% and passed (and an empty attempt gave NaN).
 * Because the practice route stops recording attempts once one has passed,
 * a learner who once scored 1/5 could never have a better attempt recorded.
 * Stored `marks` has also been seen to include answers to other practices'
 * questions (marks 7 on a 4-question practice), so the payload cannot be
 * trusted to be scoped or de-duplicated either.
 *
 * Rule: distinct correct answers to this practice's active questions,
 * divided by the number of active questions (the same filter used when the
 * questions are served, plus the unrendered-template exclusion below),
 * capped at 100, 2 dp. Pass is COMPLETED_PERCENTAGE (80), inclusive. A
 * practice with no active (renderable) questions cannot be failed.
 *
 * A question whose templatetypeid has no tablet renderer (9-17, see
 * UNRENDERED_TEMPLATE_TYPES) is excluded from the active set entirely: the
 * learner never saw it, so it cannot appear in the denominator.
 */
export interface PracticePassResult {
  marks: number;
  percentage: number;
  ispass: boolean;
}

export function practicePassResult(marks: number, activecount: number): PracticePassResult {
  if (activecount <= 0) {
    return { marks, percentage: 100, ispass: true };
  }
  const percentage = Number(Math.min(100, (marks * 100) / activecount).toFixed(2));
  return { marks, percentage, ispass: percentage >= COMPLETED_PERCENTAGE };
}

export async function scorepractice(
  lessonpracticeid: string,
  answers: { iscorrect: boolean; lessonpracticequestionid: string }[] | undefined,
): Promise<PracticePassResult> {
  const active = await lessonpracticequestions.findAll({
    attributes: ["lessonpracticequestionid"],
    where: { lessonpracticeid, lessonpracticequestionstatus: true },
    include: [
      {
        association: "question",
        attributes: [],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const activeids = new Set(active.map((q) => q.lessonpracticequestionid));
  const correct = new Set(
    (answers ?? [])
      .filter((a) => a.iscorrect === true && activeids.has(a.lessonpracticequestionid))
      .map((a) => a.lessonpracticequestionid),
  );
  return practicePassResult(correct.size, activeids.size);
}
