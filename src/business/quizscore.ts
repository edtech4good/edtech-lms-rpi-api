import { Op } from "sequelize";
import { lessonquizquestions, levelquizquestions } from "src/models/data-models/init-models";
import { COMPLETED_PERCENTAGE, UNRENDERED_TEMPLATE_TYPES } from "src/models/enums/constant.enum";

/**
 * Score a lesson-quiz or level-quiz attempt against the quiz itself, not
 * against the submitted payload — mirrors practicescore.ts's fix for the
 * same flaw.
 *
 * The previous rule was `correct / submitted * 100`. A submission of one
 * correct item scored 100%, and duplicate items for the same question could
 * inflate the count further. This scores distinct correct answers to the
 * quiz's own ACTIVE questions, divided by the number of active questions
 * (the same filter used when the questions are served, plus the
 * unrendered-template exclusion below), capped at 100, 2 dp. Pass is
 * COMPLETED_PERCENTAGE (80), inclusive. A quiz with no active (renderable)
 * questions cannot be failed.
 *
 * Dedup rule: "any correct" — a question counted once if at least one
 * submitted item for it says iscorrect true, matching scorepractice's rule
 * (duplicate correct items for one question don't inflate the count).
 *
 * A question whose templatetypeid has no tablet renderer (9-17, see
 * UNRENDERED_TEMPLATE_TYPES) is excluded from the active set entirely: the
 * learner never saw it, so it cannot appear in the denominator, and any
 * submitted item against it is ignored regardless of iscorrect.
 */
export interface QuizPassResult {
  marks: number;
  percentage: number;
  ispass: boolean;
}

export function quizPassResult(marks: number, activecount: number): QuizPassResult {
  if (activecount <= 0) {
    return { marks, percentage: 100, ispass: true };
  }
  const percentage = Number(Math.min(100, (marks * 100) / activecount).toFixed(2));
  return { marks, percentage, ispass: percentage >= COMPLETED_PERCENTAGE };
}

export async function scorelessonquiz(
  lessonquizid: string,
  answers: { iscorrect: boolean; lessonquizquestionid: string }[] | undefined,
): Promise<QuizPassResult> {
  const active = await lessonquizquestions.findAll({
    attributes: ["lessonquizquestionid"],
    where: { lessonquizid, lessonquizquestionstatus: true },
    include: [
      {
        association: "question",
        attributes: [],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const activeids = new Set(active.map((q) => q.lessonquizquestionid));
  const correct = new Set(
    (answers ?? [])
      .filter((a) => a.iscorrect === true && activeids.has(a.lessonquizquestionid))
      .map((a) => a.lessonquizquestionid),
  );
  return quizPassResult(correct.size, activeids.size);
}

export async function scorelevelquiz(
  levelid: string,
  answers: { iscorrect: boolean; levelquizquestionid: string }[] | undefined,
): Promise<QuizPassResult> {
  const active = await levelquizquestions.findAll({
    attributes: ["levelquizquestionid"],
    where: { levelid, levelquizquestionstatus: true },
    include: [
      {
        association: "question",
        attributes: [],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const activeids = new Set(active.map((q) => q.levelquizquestionid));
  const correct = new Set(
    (answers ?? [])
      .filter((a) => a.iscorrect === true && activeids.has(a.levelquizquestionid))
      .map((a) => a.levelquizquestionid),
  );
  return quizPassResult(correct.size, activeids.size);
}
