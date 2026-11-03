/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from "joi";
import { schoolScopeFromToken } from "src/business/school-identity";
import { StudentBusiness } from "src/business/student.business";
import { raiseBusinessValidationResults } from "src/interceptors/businessvalidation.interceptor";
import { IRequest } from "src/models/IRequest";
import { Token } from "src/models/token.model";

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

/**
 * The handler's own check of the learner named in the path: the same rule, answered the same way as the
 * interceptor answers it, so it holds whatever the interceptor is given.
 */
export const assertTeacherStudent = async (user: Token, studentid: string): Promise<void> => {
  raiseBusinessValidationResults([await TeacherStudent({ user } as IRequest, { studentid })]);
};
