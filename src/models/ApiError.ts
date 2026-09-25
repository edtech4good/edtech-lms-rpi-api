import { HttpException } from '@nestjs/common';
import { ErrorCode } from './enums/errorcode.enum';
import { ErrorCatalogue } from './error-catalogue';
import { FieldError } from './FieldError';

export interface ApiErrorOptions {
  /** Overrides the catalogue default when it adds real context. */
  message?: string;
  /** Overrides the catalogue default hint. */
  hint?: string;
  /** Only meaningful for INVALID_INPUT. */
  fields?: FieldError[];
  /**
   * Overrides the catalogue default status. Only for codes the spec lists
   * with more than one possible status (FILE_REJECTED is 400 or 413).
   */
  status?: number;
}

/**
 * Throw-site helper for the error contract (docs/api-errors.md):
 * `throw new ApiError(ErrorCode.NOT_FOUND)` or, with a more specific message,
 * `throw new ApiError(ErrorCode.FILE_REJECTED, { message: 'That file is
 * larger than 10 MB.' })`.
 *
 * The global exception filter reads `code`/`hint`/`fields` straight off an
 * ApiError instance rather than re-deriving them, so throwing one is the
 * only thing a new call site needs to do to get a fully-shaped response.
 */
export class ApiError extends HttpException {
  public readonly code: ErrorCode;
  public readonly hint?: string;
  public readonly fields?: FieldError[];

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    const entry = ErrorCatalogue[code];
    super(options.message ?? entry.message, options.status ?? entry.status);
    this.code = code;
    this.hint = options.hint ?? entry.hint;
    this.fields = options.fields;
  }
}
