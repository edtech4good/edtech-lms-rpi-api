/* eslint-disable @typescript-eslint/no-explicit-any */
import { ValidationError, ValidationErrorItem } from 'joi';
import { SchoolUserBusiness } from 'src/business/schooluser.business';
import { IRequest } from 'src/models/IRequest';



const UserExistsValidator = async (request: IRequest, user: any): Promise<ValidationError | null | undefined> => {
  const userexists = await new SchoolUserBusiness().getuserbyid(user.lmsuserid);
  if (!userexists) {
    const error = new ValidationError('Validation', {}, user);
    error.details = [];
    const erroritem: ValidationErrorItem = {
      message: '',
      path: [''],
      type: '',
    };
    erroritem.message = 'User not exists';
    error.details.push(erroritem);
    return error;
  }
  return null;
};

export {
  UserExistsValidator,
};

