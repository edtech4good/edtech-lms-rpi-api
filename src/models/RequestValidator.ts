import { ObjectSchema, ArraySchema } from 'joi';

export class RequestValidator {
  body?: ObjectSchema | ArraySchema;

  query?: ObjectSchema;

  params?: ObjectSchema;
}
