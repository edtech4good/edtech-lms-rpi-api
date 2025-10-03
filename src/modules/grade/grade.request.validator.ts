import { RequestValidator } from "src/models";
import joi from "joi";

export const showgradeid: RequestValidator = {
  params: joi.object().keys({
    gradeid: joi.string().required().uuid().label("Grade ID"),
  }),
};
