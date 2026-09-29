import joi from 'joi';
import { RequestValidator } from '../../models/RequestValidator';

/**
 * The raw shape of a submitted answer (workspace#79 step 1b). Kept
 * permissive here — only `v` and `type` are checked — because detailed,
 * per-template validation is `isAnswerV1` in src/business/grading, not the
 * HTTP layer. Optional on every item so an old client (no `answer` field at
 * all) still validates exactly as before: it must never see a 400, or the
 * app drops the queued result after 24h (pendingResultsQueue).
 */
const answerv1 = joi.object({
  v: joi.number().valid(1).required(),
  type: joi.string().valid('choice', 'order', 'match', 'blanks', 'counts', 'text', 'fraction').required(),
}).unknown(true);

export const resultpractice: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      lessonpracticeid: joi.string().uuid().required(),
      lessonpracticequestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      tries: joi.number().required(),
      answer: answerv1.optional(),
    })).required(), // [] is valid: an all-wrong Expo practice submits no answers
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  }),
});


export const resultquiz: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      lessonquizid: joi.string().uuid().required(),
      lessonquizquestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      answer: answerv1.optional(),
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});


export const resultlevelquiz: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      levelid: joi.string().uuid().required(),
      levelquizquestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      answer: answerv1.optional(),
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});

export const resultbaselinequestion: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      curriculumbaselineid: joi.string().uuid().required(),
      baselinequestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      answer: answerv1.optional(),
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});


