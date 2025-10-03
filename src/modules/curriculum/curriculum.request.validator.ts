import joi from "joi";
import { RequestValidator } from "../../models/RequestValidator";
import { emptyString } from "src/validators/custom.validator";

export const showcurriculumbaseline: RequestValidator = {
  params: joi.object().keys({
    curriculumid: joi.string().required().uuid().label("Curriculum ID"),
    studentid: joi.string().required().uuid().label("Student ID"),
  }),
};

export const showschoolname: RequestValidator = {
  params: joi.object().keys({
    schoolname: joi.string().required().min(1).max(300).custom(emptyString("School Name")).label("School Name"),
    studentid: joi.string().required().uuid().label("Student ID"),
    curriculumid: joi.string().required().uuid().label("Curriculum ID"),
  }),
};

export const showcurriculum: RequestValidator = {
  params: joi.object().keys({
    curriculumid: joi.string().required().uuid().label("Curriculum ID")
  }),
};
