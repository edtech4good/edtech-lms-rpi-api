import joi from "joi";
import { RequestValidator } from "src/models";

export const showlevelid: RequestValidator = {
  params: joi.object().keys({
    levelid: joi.string().required().uuid().label("Level ID"),
  }),
};
