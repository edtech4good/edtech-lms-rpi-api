import joi from "joi";
import { RequestValidator } from "../../models/RequestValidator";

export const studentstats: RequestValidator = {
  params: joi.object().keys({
    studentid: joi.string().required().uuid().label("Student ID"),
  }),
};
