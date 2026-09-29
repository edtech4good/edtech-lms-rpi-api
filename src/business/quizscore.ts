import { Op } from "sequelize";
import { baselinequestion, lessonquizquestions, levelquizquestions } from "src/models/data-models/init-models";
import { COMPLETED_PERCENTAGE, UNRENDERED_TEMPLATE_TYPES } from "src/models/enums/constant.enum";
import { QuestionForGrading } from "./grading";

/**
 * Score a lesson-quiz, level-quiz or baseline attempt against the activity
 * itself, not against the submitted payload — mirrors practicescore.ts's fix
 * for the same flaw.
 *
 * The previous rule was `correct / submitted * 100`. A submission of one
 * correct item scored 100%, and duplicate items for the same question could
 * inflate the count further. This scores distinct correct answers to the
 * activity's own ACTIVE questions, divided by the number of active questions
 * (the same filter used when the questions are served, plus the
 * unrendered-template exclusion below), capped at 100, 2 dp. Pass is
 * COMPLETED_PERCENTAGE (80), inclusive.
 *
 * Unlike practice, a quiz/baseline with NO active (renderable) questions is
 * NOT a pass: it returns { marks: 0, percentage: 0, ispass: false }. A pass
 * is sticky (ResultBusiness.ispass short-circuits every later submission to
 * that activity) and feeds activity "done" state, calculatescore,
 * level_quiz_scores, reports and — per workspace#79 decision 2 — quiz
 * certificates, so an empty POST to a quiz built only of unrenderable
 * questions (or with nothing active) must never silently pass. Practice
 * keeps its own convention (0 active questions passes at 100): practice
 * doesn't gate certificates, and activityprogress already treats a
 * 0-question practice as done.
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
    return { marks: 0, percentage: 0, ispass: false };
  }
  const percentage = Number(Math.min(100, (marks * 100) / activecount).toFixed(2));
  return { marks, percentage, ispass: percentage >= COMPLETED_PERCENTAGE };
}

/**
 * The activity's active, renderable questions, with the fields
 * `gradeAnswer` (src/business/grading) needs, keyed by the activity-scoped
 * question id (e.g. lessonquizquestionid) — the same id server grading is
 * recorded against on studentprogressquestions.referencequestionid.
 *
 * A second, near-identical query to the one in each score* function below
 * (same table, association and where clause) rather than a refactor of
 * those functions' return type, so the existing, already-tested scoring
 * behaviour is untouched. The cost is one extra indexed lookup per
 * submission, not a hot path.
 */
export async function getlessonquizgradablequestions(lessonquizid: string): Promise<Map<string, QuestionForGrading>> {
  const active = await lessonquizquestions.findAll({
    attributes: ["lessonquizquestionid"],
    where: { lessonquizid, lessonquizquestionstatus: true },
    include: [
      {
        association: "question",
        attributes: ["templatetypeid", "questionoptions", "questioncorrectvalue", "questiondistractors"],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const out = new Map<string, QuestionForGrading>();
  for (const row of active as unknown as { lessonquizquestionid: string; question?: QuestionForGrading }[]) {
    // A row missing its joined `question` shouldn't happen for real (the
    // include is `required: true`) — this only guards a lighter-weight test
    // double (e.g. result.controller.quizscore.spec.ts) that mocks
    // findAll to return bare `{ lessonquizquestionid }` rows.
    if (!row.question) {
      continue;
    }
    out.set(row.lessonquizquestionid, {
      templatetypeid: row.question.templatetypeid,
      questionoptions: row.question.questionoptions,
      questioncorrectvalue: row.question.questioncorrectvalue,
      questiondistractors: row.question.questiondistractors,
    });
  }
  return out;
}

export async function getlevelquizgradablequestions(levelid: string): Promise<Map<string, QuestionForGrading>> {
  const active = await levelquizquestions.findAll({
    attributes: ["levelquizquestionid"],
    where: { levelid, levelquizquestionstatus: true },
    include: [
      {
        association: "question",
        attributes: ["templatetypeid", "questionoptions", "questioncorrectvalue", "questiondistractors"],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const out = new Map<string, QuestionForGrading>();
  for (const row of active as unknown as { levelquizquestionid: string; question?: QuestionForGrading }[]) {
    if (!row.question) {
      continue;
    }
    out.set(row.levelquizquestionid, {
      templatetypeid: row.question.templatetypeid,
      questionoptions: row.question.questionoptions,
      questioncorrectvalue: row.question.questioncorrectvalue,
      questiondistractors: row.question.questiondistractors,
    });
  }
  return out;
}

export async function getbaselinegradablequestions(
  curriculumbaselineid: string,
): Promise<Map<string, QuestionForGrading>> {
  const active = await baselinequestion.findAll({
    attributes: ["baselinequestionid"],
    where: { curriculumbaselineid, baselinequestionstatus: true },
    include: [
      {
        association: "scorerquestion",
        attributes: ["templatetypeid", "questionoptions", "questioncorrectvalue", "questiondistractors"],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const out = new Map<string, QuestionForGrading>();
  for (const row of active as unknown as { baselinequestionid: string; scorerquestion?: QuestionForGrading }[]) {
    if (!row.scorerquestion) {
      continue;
    }
    out.set(row.baselinequestionid, {
      templatetypeid: row.scorerquestion.templatetypeid,
      questionoptions: row.scorerquestion.questionoptions,
      questioncorrectvalue: row.scorerquestion.questioncorrectvalue,
      questiondistractors: row.scorerquestion.questiondistractors,
    });
  }
  return out;
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

export async function scorebaseline(
  curriculumbaselineid: string,
  answers: { iscorrect: boolean; baselinequestionid: string }[] | undefined,
): Promise<QuizPassResult> {
  const active = await baselinequestion.findAll({
    attributes: ["baselinequestionid"],
    where: { curriculumbaselineid, baselinequestionstatus: true },
    include: [
      {
        association: "scorerquestion",
        attributes: [],
        required: true,
        where: { templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } },
      },
    ],
  });
  const activeids = new Set(active.map((q) => q.baselinequestionid));
  const correct = new Set(
    (answers ?? [])
      .filter((a) => a.iscorrect === true && activeids.has(a.baselinequestionid))
      .map((a) => a.baselinequestionid),
  );
  return quizPassResult(correct.size, activeids.size);
}
