import { ValidationError } from 'joi';
import { IRequest } from './IRequest';

interface IBusinessRule {
  (request: IRequest, data: any): Promise<Array<ValidationError | null | undefined>>;
}
export { IBusinessRule };
