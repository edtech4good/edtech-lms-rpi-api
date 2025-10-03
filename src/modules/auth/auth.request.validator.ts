import joi from 'joi';
import { RequestValidator } from '../../models/RequestValidator';

export const login: RequestValidator = ({
  body: joi.object().keys({
    studentusername: joi.string().required().label('Invalid User'),
    studentpassword: joi.string().required().label('Invalid User'),
    logintime: joi.number().label('Invalid Login Time'),
  }),
});


