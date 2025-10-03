import { Schema, ValidationError } from 'joi';

class ValidatorBase<T> {
  schema: Schema | undefined;

  validator(data: T): Promise<{ error: ValidationError; value: T } | unknown> {
    if (!this.schema) {
      throw new Error('Schema not defined');
    } else {
      return this.schema.validateAsync(data, {
        abortEarly: false,
        allowUnknown: true,
      });
    }
  }
}

export { ValidatorBase };
