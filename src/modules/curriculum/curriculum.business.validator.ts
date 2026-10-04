/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from 'joi';
import { CurriculumBusiness } from './../../business/curriculum.business';
import { IRequest } from 'src/models/IRequest';

export const DeleteCurriculumBaseline = async (request: IRequest, data: any): Promise<Array<ValidationError | null | undefined>> => {
  const schoolexists = await new CurriculumBusiness().isOwnSchoolLive(request.user);
  if (!schoolexists) {
    const error = new ValidationError('Validation', {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: '',
      path: [''],
      type: '',
    };
    erroritem.message = 'Invalid Curriculum id';
    error.details.push(erroritem);
    return [error];
  }
  return [];
};

export const DeleteCurriculum = async (request: IRequest, data: any): Promise<Array<ValidationError | null | undefined>> => {
  const schoolnameexits = await new CurriculumBusiness().isexistsCurriculumID(data.curriculumid);
  if (!schoolnameexits) {
    const error = new ValidationError('Validation', {}, {});
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: '',
      path: [''],
      type: '',
    };
    erroritem.message = 'Invalid Curriculum id';
    error.details.push(erroritem);
    return [error];
  }
  return [];
};