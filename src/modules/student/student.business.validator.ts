/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from "joi";
import { IRequest } from "src/models/IRequest";
import { StudentBusiness } from "src/business/student.business";

export const StudentExist = async (
  request: IRequest,
  data: any
): Promise<Array<ValidationError | null | undefined>> => {
  // a token with no learner record of its own (staff) has no profile to update
  const studentid = request.user?.studentid;
  const studentexists = typeof studentid === "string" && studentid.length > 0 && (await new StudentBusiness().studentExists(studentid));
  if (!studentexists) {
    const error = new ValidationError("Validation", {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: "",
      path: [""],
      type: "",
    };
    erroritem.message = "Invalid student id";
    error.details.push(erroritem);
    return [error];
  }
  return [];
};
