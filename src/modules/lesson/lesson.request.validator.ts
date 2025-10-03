import joi from "joi";
import { RequestValidator } from "../../models/RequestValidator";

export const lessonlearningprogress: RequestValidator = {
  body: joi.object().keys({
    ended: joi.boolean().required(),
    time: joi.number().required(),
    content_length: joi.number().required(),
    date: joi.date().label('Invalid Date'),
  }),
};

export const lessonidparams: RequestValidator = ({
  params: joi.object().keys({
    lessonid: joi.string().required().uuid().label('Lesson ID'),
  }),
});
