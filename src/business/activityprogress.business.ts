import { Op } from "sequelize";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { lessonpracticequestions } from "src/models/data-models/lessonpracticequestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { studentprogress } from "src/models/data-models/studentprogress";
import { Progress } from "src/models/enums/progress.enum";
import { COMPLETED_PERCENTAGE } from "src/models/enums/constant.enum";
import { Token } from "src/models/token.model";
import { LessonBusiness } from "./lesson.business";

export type ActivityStatus = "done" | "inProgress" | "todo";

interface LearningActivityProgress {
  lessonlearningid: string;
  status: ActivityStatus;
  progress_percentage: number;
}

interface AttemptActivityProgress {
  status: ActivityStatus;
  attempts: number;
  best_percentage: number | null;
}

export class ActivityProgressBusiness {
  /**
   * Per-activity status (learning/practice/quiz) for every active item in a
   * lesson, for the calling student. Mirrors the read pattern used by
   * LessonBusiness.getuserlessonprogress (batched queries, no per-item
   * loops) but keeps its own file so it doesn't collide with the open PR
   * touching lesson.business.ts / result.business.ts /
   * lesson.learning.controller.ts.
   */
  getlessonactivitiesprogress = async (lessonid: string, user: Token) => {
    // Throws BadRequestException("Student Not Found") the same way the rest
    // of the student-only lesson routes do when the token has no matching
    // student (e.g. the "server" sync user) — reusing LessonBusiness's
    // helper instead of inventing a new error shape.
    const student = await new LessonBusiness().getstudent(user);

    const [learnings, practices, quizzes] = await Promise.all([
      lessonlearnings.findAll({
        where: { lessonid, lessonlearningstatus: true },
        order: [["lessonlearningorder", "ASC"]],
        attributes: ["lessonlearningid"],
      }),
      lessonpractices.findAll({
        where: { lessonid, lessonpracticestatus: true },
        order: [["lessonpracticeorder", "ASC"]],
        attributes: ["lessonpracticeid"],
      }),
      lessonquizzes.findAll({
        where: { lessonid, lessonquizstatus: true },
        order: [["lessonquizorder", "ASC"]],
        attributes: ["lessonquizid"],
      }),
    ]);

    const [learningsResult, practicesResult, quizzesResult] = await Promise.all([
      this.buildlearningsprogress(learnings, student.studentid),
      this.buildpracticesprogress(practices, student.studentid),
      this.buildquizzesprogress(quizzes, student.studentid),
    ]);

    return {
      lessonid,
      pass_percentage: COMPLETED_PERCENTAGE,
      learnings: learningsResult,
      practices: practicesResult,
      quizzes: quizzesResult,
    };
  };

  private buildlearningsprogress = async (
    learnings: lessonlearnings[],
    studentid: string
  ): Promise<LearningActivityProgress[]> => {
    const lessonlearningids = learnings.map((l) => l.lessonlearningid);
    if (lessonlearningids.length === 0) return [];

    const rows = await studentlearningprogress.findAll({
      where: {
        studentid,
        lessonlearningid: { [Op.in]: lessonlearningids },
      },
      attributes: ["lessonlearningid", "viewed", "progress_percentage"],
    });
    const byid = new Map(rows.map((r) => [r.lessonlearningid, r]));

    return learnings.map((learning) => {
      const row = byid.get(learning.lessonlearningid);
      if (!row) {
        return {
          lessonlearningid: learning.lessonlearningid,
          status: "todo" as ActivityStatus,
          progress_percentage: 0,
        };
      }
      const done = (row.viewed ?? 0) > 0;
      const started = done || (row.progress_percentage ?? 0) > 0;
      const status: ActivityStatus = done ? "done" : started ? "inProgress" : "todo";
      const progress_percentage = done
        ? 100
        : Math.min(100, Math.max(0, row.progress_percentage ?? 0));
      return {
        lessonlearningid: learning.lessonlearningid,
        status,
        progress_percentage,
      };
    });
  };

  private buildquizzesprogress = async (
    quizzes: lessonquizzes[],
    studentid: string
  ): Promise<(AttemptActivityProgress & { lessonquizid: string })[]> => {
    const lessonquizids = quizzes.map((q) => q.lessonquizid);
    if (lessonquizids.length === 0) return [];

    const attempts = await studentprogress.findAll({
      where: {
        studentid,
        progresstype: Progress.LESSONQUIZ,
        studentprogressreferenceid: { [Op.in]: lessonquizids },
      },
      attributes: ["studentprogressreferenceid", "resultpercentage"],
    });

    const byquiz = new Map<string, number[]>();
    for (const attempt of attempts) {
      const list = byquiz.get(attempt.studentprogressreferenceid) ?? [];
      list.push(Number(attempt.resultpercentage));
      byquiz.set(attempt.studentprogressreferenceid, list);
    }

    return quizzes.map((quiz) => {
      const results = byquiz.get(quiz.lessonquizid) ?? [];
      const attemptcount = results.length;
      const best_percentage =
        attemptcount === 0 ? null : Number(Math.max(...results).toFixed(2));
      const status: ActivityStatus =
        best_percentage !== null && best_percentage >= COMPLETED_PERCENTAGE
          ? "done"
          : attemptcount > 0
          ? "inProgress"
          : "todo";
      return {
        lessonquizid: quiz.lessonquizid,
        status,
        attempts: attemptcount,
        best_percentage,
      };
    });
  };

  private buildpracticesprogress = async (
    practices: lessonpractices[],
    studentid: string
  ): Promise<(AttemptActivityProgress & { lessonpracticeid: string })[]> => {
    const lessonpracticeids = practices.map((p) => p.lessonpracticeid);
    if (lessonpracticeids.length === 0) return [];

    const [attempts, questions] = await Promise.all([
      studentprogress.findAll({
        where: {
          studentid,
          progresstype: Progress.LESSONPRACTICE,
          studentprogressreferenceid: { [Op.in]: lessonpracticeids },
        },
        attributes: ["studentprogressreferenceid", "marks"],
      }),
      lessonpracticequestions.findAll({
        where: {
          lessonpracticeid: { [Op.in]: lessonpracticeids },
          lessonpracticequestionstatus: true,
        },
        attributes: ["lessonpracticeid"],
      }),
    ]);

    const attemptsbypractice = new Map<string, number[]>();
    for (const attempt of attempts) {
      const list = attemptsbypractice.get(attempt.studentprogressreferenceid) ?? [];
      list.push(Number(attempt.marks));
      attemptsbypractice.set(attempt.studentprogressreferenceid, list);
    }
    const questioncountbypractice = new Map<string, number>();
    for (const question of questions) {
      questioncountbypractice.set(
        question.lessonpracticeid,
        (questioncountbypractice.get(question.lessonpracticeid) ?? 0) + 1
      );
    }

    return practices.map((practice) => {
      const marksperattempt = attemptsbypractice.get(practice.lessonpracticeid) ?? [];
      const attemptcount = marksperattempt.length;
      const activequestioncount = questioncountbypractice.get(practice.lessonpracticeid) ?? 0;

      // resultpercentage on studentprogress is not usable for practices: the
      // client only ever reports correct answers, so it always comes back
      // as 100 (or NaN when there are 0 questions). The real score is the
      // best attempt's marks (count of correct answers) against the
      // practice's current active question count, mirroring the filter
      // question.business.ts#getpracticequestions uses to serve questions.
      let best_percentage: number | null;
      let status: ActivityStatus;
      if (attemptcount === 0) {
        best_percentage = null;
        status = "todo";
      } else if (activequestioncount === 0) {
        // Nothing left to score against (all questions since deactivated) —
        // there's nothing to fail, so any attempt counts as done.
        best_percentage = null;
        status = "done";
      } else {
        const bestmarks = Math.max(...marksperattempt);
        const pct = Math.min(100, (bestmarks / activequestioncount) * 100);
        best_percentage = Number(pct.toFixed(2));
        status = best_percentage >= COMPLETED_PERCENTAGE ? "done" : "inProgress";
      }

      return {
        lessonpracticeid: practice.lessonpracticeid,
        status,
        attempts: attemptcount,
        best_percentage,
      };
    });
  };
}
