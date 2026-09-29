import joi from 'joi';
import { RequestValidator } from '../../models/RequestValidator';

/**
 * The raw shape of a submitted answer (the server-grading protocol). Kept
 * permissive here — only `v` and `type` are checked, plus a size cap —
 * because detailed, per-template validation is `isAnswerV1` in
 * src/business/grading, not the HTTP layer. Optional AND nullable on every
 * item so an old client (no `answer` field at all, or an app that sends
 * `answer: null` for "no attempt") still validates exactly as before: it
 * must never see a 400, or the app drops the queued result after 24h
 * (pendingResultsQueue). `null` is treated as "absent" by the grader
 * (gradesubmission.ts), same as leaving the field out entirely.
 *
 * Size caps guard against a single request ballooning the request body (and
 * later, the stored JSON column) arbitrarily: a string field is capped at
 * 200 characters (enough for any real typed/fraction/text answer; nothing
 * legitimate needs more), and the array/record fields the known answer
 * types use (selected/order/filled/pairs/parts/counts/entries) are capped
 * at 50 entries. An unknown field not in that list still gets the same
 * caps via the wildcard pattern below, rather than being trusted
 * unbounded — future answer shapes are bounded by default, not by
 * omission.
 */
const boundedString = joi.string().max(200);
const boundedScalar = joi.alternatives().try(boundedString, joi.number(), joi.boolean());
const boundedArray = joi.array().max(50).items(joi.alternatives().try(boundedScalar, joi.object().max(50)));
const boundedRecord = joi.object().max(50).pattern(joi.string().max(200), boundedScalar);

const answerv1 = joi
  .object({
    v: joi.number().valid(1).required(),
    type: joi.string().valid('choice', 'order', 'match', 'blanks', 'counts', 'text', 'fraction').required(),
    selected: boundedArray.optional(),
    order: boundedArray.optional(),
    filled: boundedArray.optional(),
    pairs: boundedArray.optional(),
    parts: boundedArray.optional(),
    counts: boundedRecord.optional(),
    entries: boundedRecord.optional(),
    value: boundedScalar.optional(),
    numerator: joi.number().optional(),
    denominator: joi.number().optional(),
  })
  .pattern(joi.string(), joi.alternatives().try(boundedScalar, boundedArray, boundedRecord));

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


