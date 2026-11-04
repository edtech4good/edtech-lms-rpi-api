import { COMPLETED_PERCENTAGE } from "../models/enums/constant.enum";

/**
 * The completion rules for lesson, level and grade progress, kept free of models and configuration so the
 * compiled file can also be loaded by an operator script (scripts/recalc-lesson-quiz-points.js) that has no
 * database layer of the app. LessonBusiness uses these same functions when it updates a progress row.
 */

/**
 * A lesson is complete once accumulated points reach its own pass mark
 * (`lessons.passing_points`), falling back to COMPLETED_PERCENTAGE of
 * total_points for older content that has no passing_points set. This
 * replaces the previous "progress strictly greater than 80%" rule, which
 * left a lesson permanently incomplete when its reachable points (e.g. no
 * video on the learning activity) summed to exactly the old percentage
 * threshold.
 */
export function lessonPassMark(lesson: { passing_points?: number | null; total_points?: number | null }): number {
  if (typeof lesson.passing_points === "number" && lesson.passing_points > 0) {
    return lesson.passing_points;
  }
  if (typeof lesson.total_points === "number" && lesson.total_points > 0) {
    return Math.ceil((lesson.total_points * COMPLETED_PERCENTAGE) / 100);
  }
  // No usable total either: an unreachable pass mark means never complete, not "0 points completes it".
  return Number.POSITIVE_INFINITY;
}

/** The stored `progress` of a lesson, level or grade row: points as a percentage of the total, two decimals. */
export const progressPercent = (points: number, total: number): number => Number((points * 100 / total).toFixed(2)) ?? 0;

/** Whether a level or grade row is complete: its progress has reached COMPLETED_PERCENTAGE. */
export const percentCompleted = (progress: number): boolean => progress >= COMPLETED_PERCENTAGE;

/**
 * The per-organisation rule "a lesson quiz that is not passed earns no points" is on only for the boolean `true`
 * at `settingsconfig.requireLessonQuizPass`; an absent key, a null or non-object `settingsconfig`, the string "true",
 * the number 1 and anything else leave it off, so a malformed value can never change how a submission is scored.
 */
export const requiresLessonQuizPass = (settingsconfig: unknown): boolean => {
  if (settingsconfig === null || typeof settingsconfig !== "object" || Array.isArray(settingsconfig)) {
    return false;
  }
  return (settingsconfig as Record<string, unknown>).requireLessonQuizPass === true;
};
