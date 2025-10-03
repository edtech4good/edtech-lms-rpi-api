/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from "joi";
import { StudentBusiness } from "src/business/student.business";
import { IRequest } from "src/models/IRequest";

export const TeacherStudent = async (
  request: IRequest,
  data: any
): Promise<Array<ValidationError | null | undefined>> => {
  const studentexists = await new StudentBusiness().studentExists(
    data.studentid
  );
  if (!studentexists) {
    const error = new ValidationError("Validation", {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: "",
      path: [""],
      type: "",
    };
    erroritem.message = "Invalid Student ID";
    error.details.push(erroritem);
    return [error];
  }
  return [];
};
