/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from "joi";
import { schoolScopeFromToken } from "src/business/school-identity";
import { StudentBusiness } from "src/business/student.business";
import { IRequest } from "src/models/IRequest";

export const TeacherStudent = async (
  request: IRequest,
  data: any
): Promise<Array<ValidationError | null | undefined>> => {
  // The learner must be one of the token's school's: one of another school is "invalid", like one that does not exist.
  const school = await schoolScopeFromToken(request.user);
  const studentexists = school !== undefined && (await new StudentBusiness().studentIsInSchool(data.studentid, school));
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
