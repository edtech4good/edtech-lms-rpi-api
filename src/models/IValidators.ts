import { Schema, ValidationError } from 'joi';

interface IValidators<T> {
  schema: Schema;
  validator(data: T): Promise<{ error: ValidationError; value: T } | unknown>;
}
export { IValidators };
