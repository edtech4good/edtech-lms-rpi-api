/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from 'joi';
import { IRequest } from 'src/models/IRequest';
import { GradeBusiness } from 'src/business/grade.business';

export const DeleteGrade = async (request: IRequest, data: any): Promise<Array<ValidationError | null | undefined>> => {
  const gradeexists = await new GradeBusiness().isexistsGradeID(data.gradeid);
  if (!gradeexists) {
    const error = new ValidationError('Validation', {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: '',
      path: [''],
      type: '',
    };
    erroritem.message = 'Invalid Grade id';
    error.details.push(erroritem);
    return [error];
  }
  return [];
};
