import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { compile } from 'joi';
import { pick } from 'lodash';
import { Observable } from 'rxjs';
import { RequestValidator } from 'src/models';
import { ValidationException } from '../models/ValidationException';

@Injectable()
export class SchemaValidationInterceptor implements NestInterceptor {
  constructor(private schema: RequestValidator) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request: any = ctx.getRequest();
    const validSchema = pick(this.schema, ['params', 'query', 'body']);
    const object = pick(request, Object.keys(validSchema));
    const { error } = compile(this.schema)
      .prefs({ errors: { label: 'key' } })
      .validate(object);

    if (error) {
      const errorMessage = error.details.map(details => details.message).join(', ');
      throw new ValidationException(errorMessage);
    }
    return next.handle();
  }
}

/*
const validate = (schema) => (req, res, next) => {
  const validSchema = pick(schema, ['params', 'query', 'body']);
  const object = pick(req, Object.keys(validSchema));
  const { value, error } = Joi.compile(validSchema)
    .prefs({ errors: { label: 'key' }, abortEarly: false })
    .validate(object);

  if (error) {
    const errorMessage = error.details.map((details) => details.message).join(', ');
    return next(new ApiError(httpStatus.BAD_REQUEST, errorMessage));
  }
  Object.assign(req, value);
  return next();
};
*/