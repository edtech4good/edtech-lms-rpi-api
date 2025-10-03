import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ValidationError } from 'joi';
import { flatten, pick, uniq } from 'lodash';
import { forkJoin, from, Observable } from 'rxjs';
import { IBusinessRule } from '../models/Ibusinessrule';
import { RequestValidator } from '../models/RequestValidator';
import { ValidationException } from '../models/ValidationException';
import { IRequest } from 'src/models/IRequest';
@Injectable()
export class BusinessValidationInterceptor implements NestInterceptor {
  constructor(private rules: Array<IBusinessRule>) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const ctx = context.switchToHttp();
    const request: IRequest = ctx.getRequest();
    const value: RequestValidator = pick(request as any, ['params', 'query', 'body']);

    let businessobject: any = {};

    if (value.params) {
      businessobject = {
        ...businessobject,
        ...value.params,
      };
    }
    if (value.query) {
      businessobject = {
        ...businessobject,
        ...value.query,
      };
    }
    if (value.body) {
      businessobject = {
        ...businessobject,
        ...value.body,
      };
    }
    if (Object.keys(businessobject).length > 0) {
      const validationresultarray = await forkJoin(this.rules.map(x => from(x(request, businessobject)))).toPromise();
      const validationresult = flatten(validationresultarray);
      const validationExceptions: Array<Error | null | undefined> = validationresult.filter(
        x => x instanceof Error && !(x instanceof ValidationError) && (x !== null || x !== undefined)
      );
      const validationErrors: Array<ValidationError | null | undefined> = validationresult.filter(
        x => x instanceof ValidationError && (x !== null || x !== undefined)
      );
      if (validationExceptions && validationExceptions.length > 0) {
        const throwerror = validationExceptions.find(x => x !== null || x !== undefined);
        if (throwerror) {
          throw throwerror;
        }
      }
      if (validationErrors && validationErrors.length > 0) {
        const errorsmap = validationErrors.filter(x => x !== null && x !== undefined).map(x => (x ? x.details.map(y => y.message) : ''));
        if (errorsmap.length > 0) {
          throw new ValidationException(uniq(flatten(errorsmap).filter(x => x.length > 0)).join(', '));
        }
      }
    }
    return next.handle();
  }
}
