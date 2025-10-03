import { RequestValidator } from "src/models";
import joi from 'joi';

export const accessDate: RequestValidator = {
  body: joi.object().keys({
    starttime: joi.date().label("Invalid Date"),
    endtime: joi.date().label("Invalid Date"),
  }),
};
