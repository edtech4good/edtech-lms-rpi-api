import { HttpException, HttpStatus } from '@nestjs/common';
import { FieldError } from './FieldError';

/**
 * Raised by SchemaValidationInterceptor / BusinessValidationInterceptor on a
 * Joi failure. Carries structured `fields` (one entry per invalid field, in
 * plain language) so the global filter can map this straight to
 * INVALID_INPUT with a `fields` array, per docs/api-errors.md, instead of
 * re-parsing a joined string.
 */
export class ValidationException extends HttpException {
  public readonly fields: FieldError[];

  constructor(fields: FieldError[]) {
    const message = fields.map(f => f.message).join(', ');
    super(message, HttpStatus.BAD_REQUEST);
    this.fields = fields;
  }
}
