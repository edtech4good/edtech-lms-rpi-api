import { RequestValidator } from './RequestValidator';

export interface IRequestValidator {
  (): RequestValidator;
}
