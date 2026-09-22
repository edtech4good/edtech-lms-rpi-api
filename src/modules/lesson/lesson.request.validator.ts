import joi from "joi";
import { RequestValidator } from "../../models/RequestValidator";

export const lessonlearningprogress: RequestValidator = {
  body: joi.object().keys({
    ended: joi.boolean().required(),
    // Bounded here, not left for MySQL: a negative value used to reach the
    // studentlearningsprogress INSERT (both columns are UNSIGNED) and bounce
    // back as a raw "Out of range value" DB error instead of a real 400.
    // No .integer(): expo-av on web reports fractional millis (e.g.
    // 11211.207999999999) for both of these, and both columns are
    // INTEGER UNSIGNED anyway — updatelearningprogress rounds before any
    // arithmetic or write, so the validator only needs to bound the range,
    // not the shape.
    time: joi.number().min(0).required(),
    content_length: joi.number().min(0).required(),
    date: joi.date().label('Invalid Date'),
  }),
};

export const lessonidparams: RequestValidator = ({
  params: joi.object().keys({
    lessonid: joi.string().required().uuid().label('Lesson ID'),
  }),
});
