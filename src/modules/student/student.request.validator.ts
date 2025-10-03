import joi from "joi";
import { RequestValidator } from "../../models/RequestValidator";

export const studentprofile: RequestValidator = {
  body: joi.object().keys({
    filename: joi.string().required().label("Profile Image"),
  }),
};
