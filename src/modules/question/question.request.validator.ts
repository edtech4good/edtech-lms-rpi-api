import joi from 'joi';
import { RequestValidator } from '../../models/RequestValidator';

export const levelquestions: RequestValidator = ({
  params: joi.object().keys({
    levelid: joi.string().required().uuid().label('Level ID'),
  }),
});


export const lessonquestions: RequestValidator = ({
  params: joi.object().keys({
    lessonid: joi.string().required().uuid().label('Lesson ID'),
  }),
});


export const lessonpractices: RequestValidator = ({
  params: joi.object().keys({
    lessonpracticeid: joi.string().required().uuid().label('Lesson Practice ID'),
  }),
});

export const lessonquizzes: RequestValidator = ({
  params: joi.object().keys({
    lessonquizid: joi.string().required().uuid().label('Lesson Quiz ID'),
  }),
});

export const baselinequestion: RequestValidator = ({
  params: joi.object().keys({
    curriculumbaselineid: joi.string().required().uuid().label('Curriculumbaseline Question ID'),
  }),
});