import joi from 'joi';
import { RequestValidator } from '../../models/RequestValidator';

/**
 * The raw shape of a submitted answer (the server-grading protocol). Kept
 * permissive on `v`/`type` — detailed per-template validation is
 * `isAnswerV1` in src/business/grading, not the HTTP layer — but the
 * per-field SHAPE here must agree with `AnswerV1` (src/business/grading,
 * from #93) for every field a real answer can carry, or a legitimate
 * answer gets a 400 here that `isAnswerV1` would have accepted: a whole
 * quiz result containing one drag-drop (`match`) or fraction question
 * would then be rejected outright and, being an old-format-looking payload
 * from the app's point of view, dropped after 24h (pendingResultsQueue).
 * See result.request.validator.spec.ts's `describe("agrees with
 * isAnswerV1 on every #93 fixture shape", ...)` for the check that pins
 * this agreement.
 *
 * Optional AND nullable on every item so an old client (no `answer` field
 * at all, or an app that sends `answer: null` for "no attempt") still
 * validates exactly as before — `null` is treated as "absent" by the
 * grader (gradesubmission.ts), same as leaving the field out entirely.
 *
 * Size caps guard against a single request (and later, the stored JSON
 * column) ballooning arbitrarily: a string is capped at 200 characters
 * (enough for any real typed/fraction/text answer), and every array or
 * record field is capped at 50 entries. Every array item and every record
 * value is a plain bounded string, number or integer — never a nested
 * object — so a value like `selected: [{ x: "<100k chars>" }]` cannot
 * smuggle an unbounded string past the cap by wrapping it in an object one
 * level down.
 */
// .strict() everywhere a type must match isAnswerV1 exactly: joi's default
// `convert: true` coerces a numeric STRING like "2" into the number 2,
// which would make { counts: { a: "2" } } pass here while isAnswerV1
// rejects it outright (counts must be an actual number, not a numeric
// string) — a disagreement result.request.validator.spec.ts's
// "agrees with isAnswerV1" suite caught directly.
const boundedString = joi.string().max(200).strict();
/** selected/order/filled (AnswerV1: string[]) — plain strings only, never nested objects. */
const stringArray = joi.array().max(50).items(boundedString);
/** pairs/entries (AnswerV1: Record<string, string>). */
const stringRecord = joi.object().max(50).pattern(joi.string().max(200), boundedString);
/** counts (AnswerV1: Record<string, number>) — tap counts: non-negative integers only, never a numeric string. */
const countsRecord = joi.object().max(50).pattern(joi.string().max(200), joi.number().integer().min(0).strict());
/** parts (AnswerV1: Record<string, {numerator, denominator}>), each a bounded string pair. */
const fractionPart = joi.object({
  numerator: boundedString.required(),
  denominator: boundedString.required(),
});
const partsRecord = joi.object().max(50).pattern(joi.string().max(200), fractionPart);
/**
 * A future/unrecognized field (not yet part of AnswerV1) still gets a
 * bound, never trusted unbounded — but never a nested object either, and
 * never coerced (same .strict() reasoning as above).
 */
const boundedScalar = joi.alternatives().try(boundedString, joi.number().strict(), joi.boolean());
const fallbackField = joi.alternatives().try(boundedScalar, stringArray, stringRecord);

const answerv1 = joi
  .object({
    v: joi.number().valid(1).required(),
    type: joi.string().valid('choice', 'order', 'match', 'blanks', 'counts', 'text', 'fraction').required(),
    selected: stringArray.optional(),
    order: stringArray.optional(),
    filled: stringArray.optional(),
    pairs: stringRecord.optional(),
    parts: partsRecord.optional(),
    counts: countsRecord.optional(),
    entries: stringRecord.optional(),
  })
  .pattern(joi.string(), fallbackField);

export const resultpractice: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().max(200).items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      lessonpracticeid: joi.string().uuid().required(),
      lessonpracticequestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      tries: joi.number().required(),
      answer: answerv1.optional().allow(null),
    })).required(), // [] is valid: an all-wrong Expo practice submits no answers
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  }),
});


export const resultquiz: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().max(200).items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      lessonquizid: joi.string().uuid().required(),
      lessonquizquestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      answer: answerv1.optional().allow(null),
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});


export const resultlevelquiz: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().max(200).items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      levelid: joi.string().uuid().required(),
      levelquizquestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      answer: answerv1.optional().allow(null),
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});

export const resultbaselinequestion: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().max(200).items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      curriculumbaselineid: joi.string().uuid().required(),
      baselinequestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      answer: answerv1.optional().allow(null),
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});


