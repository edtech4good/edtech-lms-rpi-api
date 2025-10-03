import joi from 'joi';
import { RequestValidator } from '../../models/RequestValidator';

export const resultpractice: RequestValidator = ({
  body: joi.object().keys({
    result: joi.array().items(joi.object().keys({
      iscorrect: joi.boolean().required(),
      lessonpracticeid: joi.string().uuid().required(),
      lessonpracticequestionid: joi.string().uuid().required(),
      questionid: joi.string().uuid().required(),
      tries: joi.number().required(),
    })),
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
    })),
    starttime: joi.date().label('Invalid Date'),
    endtime: joi.date().label('Invalid Date'),
  })
});


