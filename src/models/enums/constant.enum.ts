export const COMPLETED_PERCENTAGE = 80;

/**
 * templatetypeid values 9-17 are on the authoring menu but have no screen
 * on the tablet (docs/question-types-and-lesson-structure.md, "On the
 * authoring menu, but not supported"): a learner served one of these gets
 * an error where the question should be. A learner must never be scored
 * against a question they could not see, so these are excluded from the
 * active-question denominator everywhere quizzes and practices are scored.
 */
export const UNRENDERED_TEMPLATE_TYPES = [9, 10, 11, 12, 13, 14, 15, 16, 17];