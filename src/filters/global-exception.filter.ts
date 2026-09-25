import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  ConnectionAcquireTimeoutError,
  ConnectionError,
  ConnectionRefusedError,
  DatabaseError,
  ForeignKeyConstraintError,
  TimeoutError as SequelizeTimeoutError,
  UniqueConstraintError,
  ValidationError as SequelizeValidationError,
} from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { ValidationException } from '../models/ValidationException';
import { ApiError } from '../models/ApiError';
import { ErrorCode } from '../models/enums/errorcode.enum';
import { ErrorCatalogue } from '../models/error-catalogue';
import { generateErrorReference } from '../utils/reference';
import { Config, Logger } from '../config';
import { IErrorResponse } from 'src/models/IErrorResponse';
import { FieldError } from 'src/models/FieldError';

interface MappedError {
  code: ErrorCode;
  status: number;
  message: string;
  hint?: string;
  fields?: FieldError[];
}

/**
 * MySQL errno values for data that can NEVER be saved as given, no matter
 * how many times the client retries — a data-shape problem, not a
 * transient one. Mapped to INVALID_INPUT (400) so the client stops
 * retrying, instead of the generic 500 they'd otherwise get (or, before
 * this contract, the connection-error 503 bucket, which the client DOES
 * retry — retrying a value that will never fit the column is pointless).
 *   1048 ER_BAD_NULL_ERROR            (column cannot be null)
 *   1264 ER_WARN_DATA_OUT_OF_RANGE    (numeric value out of range)
 *   1292 ER_TRUNCATED_WRONG_VALUE     (bad date/enum/etc value)
 *   1366 ER_TRUNCATED_WRONG_VALUE_FOR_FIELD
 *   1406 ER_DATA_TOO_LONG             (value too long for column)
 */
const NEVER_SAVEABLE_MYSQL_ERRNOS = new Set([1048, 1264, 1292, 1366, 1406]);

/**
 * Nest's HttpException stores the thrown value verbatim in `getResponse()`
 * — a plain string, `{ statusCode, message, error }` (Nest's OWN default
 * shape, used for e.g. `new BadRequestException('x')` and for framework-
 * generated exceptions like a malformed-JSON body or an unmatched route),
 * or this repo's long-standing `{ error: true, errormessage }` object
 * literal (~30 throw sites, pre-dating this contract, all first-party and
 * already plain language).
 *
 * Only the second (our own) shape is trusted enough to forward: Nest's own
 * default shape can carry ANYTHING a lower-level library put in `.message`
 * — a JSON.parse SyntaxError quoting the offending request body is exactly
 * this, arriving as a plain `BadRequestException` (see
 * global-exception.filter.spec.ts "malformed JSON"). A bare string
 * HttpException is never trusted either, for the same reason.
 */
function ownShapeMessage(exception: HttpException): string | undefined {
  const body: any = exception.getResponse();
  if (body && typeof body === 'object' && typeof body.errormessage === 'string') {
    return body.errormessage;
  }
  return undefined;
}

const mapped = (code: ErrorCode, overrides: Partial<Omit<MappedError, 'code'>> = {}): MappedError => {
  const entry = ErrorCatalogue[code];
  return {
    code,
    status: entry.status,
    message: entry.message,
    hint: entry.hint,
    ...overrides,
  };
};

/**
 * `@nestjs/platform-express` vendors its own copy of `multer`, so a
 * `MulterError` thrown by the interceptor's underlying multer instance can
 * fail `instanceof MulterError` against this file's own `multer` import
 * (two separate copies in node_modules, two separate constructors) — check
 * the error's `name` instead, which multer always sets regardless of which
 * copy threw it.
 *
 * In practice this repo's `FileInterceptor` usages already have most
 * multer error codes converted by Nest itself before this filter ever sees
 * them (`LIMIT_FILE_SIZE` -> `PayloadTooLargeException`,
 * `LIMIT_UNEXPECTED_FILE` -> `BadRequestException('Unexpected field')` —
 * handled below, in the HttpException branch) — this check is what catches
 * anything Nest's own transform doesn't recognize, or a raw MulterError
 * from a code path that bypasses that transform.
 */
function isMulterError(exception: any): boolean {
  return !!exception && exception.name === 'MulterError' && typeof exception.code === 'string';
}

/**
 * body-parser's own errors (from the plain `app.use(json(...))` middleware
 * in server.ts, which runs before Nest's request pipeline) are never
 * HttpExceptions — they're `http-errors` instances with a `.type` and a
 * `.status`/`.statusCode`, thrown directly into this filter.
 */
function isEntityTooLarge(exception: any): boolean {
  return exception?.type === 'entity.too.large' || exception?.status === 413 || exception?.statusCode === 413;
}

/**
 * A malformed-JSON body. In this repo's actual Express/Nest version this
 * arrives already converted into a plain `BadRequestException` (Nest's own
 * `{statusCode, message, error}` shape — see `ownShapeMessage` above) whose
 * `.message` is the underlying `JSON.parse` `SyntaxError`'s own message,
 * which QUOTES A FRAGMENT OF THE REQUEST BODY ("Unexpected token 'h',
 * ..."assword": hunter2sec"... is not valid JSON"). The response side is
 * already safe (ownShapeMessage returns undefined for Nest's default
 * shape, so the generic INVALID_INPUT message is used) — this check exists
 * so LOGGING also never writes that fragment to the error log (which is
 * zipped into the teacher export and shipped to the cloud).
 *
 * Deliberately NOT keyed off `JSON.parse`'s exact wording (Node's message
 * for this varies — "Unexpected token", "Unexpected end of JSON input",
 * "Expected ',' or '}' after property value in JSON at position N", and
 * whatever a future V8/Node version phrases it as): any of
 *   - a `SyntaxError` with a 400 status (`.status`/`.statusCode`) or
 *     `.type === 'entity.parse.failed'` (the raw body-parser/http-errors
 *     shape, in a setup where Nest doesn't intercept and re-wrap it), or
 *   - a `.cause` that is a `SyntaxError`, or
 *   - a 400 `HttpException` in Nest's own default body shape (never our
 *     own `{error:true,errormessage}` shape) whose message mentions "JSON"
 *     at all
 * counts, so a Node upgrade that rewords the message can't silently start
 * leaking the body fragment again.
 */
function isBodyParserJsonError(exception: any): boolean {
  if (exception instanceof SyntaxError) {
    const syntaxErr: any = exception;
    if (syntaxErr.type === 'entity.parse.failed' || syntaxErr.status === 400 || syntaxErr.statusCode === 400) {
      return true;
    }
  }
  if (exception?.type === 'entity.parse.failed') {
    return true;
  }
  if (exception?.cause instanceof SyntaxError) {
    return true;
  }
  return (
    exception instanceof HttpException &&
    exception.getStatus() === HttpStatus.BAD_REQUEST &&
    ownShapeMessage(exception) === undefined &&
    typeof exception.message === 'string' &&
    exception.message.includes('JSON')
  );
}

/**
 * Nest's own message for an unmatched route ("Cannot GET /path?query=..."),
 * which embeds the full request path AND query string — the same "never
 * log the URL/query" rule as everywhere else in this filter, just reached
 * through `.message` instead of a logged `route`/`url` field.
 */
const ROUTE_NOT_FOUND_MESSAGE = /^Cannot [A-Z]+ /;
function isRouteNotFoundMessage(exception: any): boolean {
  return (
    exception instanceof HttpException &&
    exception.getStatus() === HttpStatus.NOT_FOUND &&
    typeof exception.message === 'string' &&
    ROUTE_NOT_FOUND_MESSAGE.test(exception.message)
  );
}

/**
 * Whether this exception's `.message`/`.stack` are safe to write to the log
 * verbatim. Both malformed-JSON and "unmatched route" exceptions carry
 * request content (a body fragment, or the URL+query) inside `.message`,
 * and `Error.prototype.stack` always starts with `<ClassName>: <message>`
 * — redacting `.message` alone would still leak it through `.stack`.
 */
function hasLoggableRequestContent(exception: unknown): boolean {
  return isBodyParserJsonError(exception) || isRouteNotFoundMessage(exception);
}

/**
 * Sequelize `DatabaseError` (covers `ForeignKeyConstraintError`, and any
 * other MySQL-errno-carrying failure) and `ValidationError` (covers
 * `UniqueConstraintError`, which extends it) both wrap the raw driver
 * error's own message, which for several real MySQL errnos QUOTES THE
 * OFFENDING VALUE VERBATIM — e.g. errno 1366 (truncated wrong value):
 * `Incorrect integer value: 'DBVALUESECRET' for column 'age'`, or a
 * unique-constraint message naming the duplicate value itself. This log
 * ships to the cloud (rpi-api's teacher export), so these two families
 * are logged by errno/sqlState/class only — never `.message` or `.stack`.
 */
function sequelizeDbErrorLogFields(exception: unknown): { errno?: number; sqlState?: string } | undefined {
  if (!(exception instanceof DatabaseError) && !(exception instanceof SequelizeValidationError)) {
    return undefined;
  }
  const original: any = (exception as any)?.original ?? (exception as any)?.parent;
  return { errno: original?.errno, sqlState: original?.code };
}

/**
 * Classifies any thrown value into the error contract (docs/api-errors.md,
 * "Mapping rules"). Order matters throughout: more specific checks must run
 * before the generic HttpException / "anything else" fallbacks, since e.g.
 * a Sequelize UniqueConstraintError is not an HttpException at all, a
 * body-parser entity-too-large error is not an HttpException either, and a
 * hand-rolled BadRequestException is not an ApiError.
 */
function mapException(exception: unknown): MappedError {
  if (exception instanceof ApiError) {
    return {
      code: exception.code,
      status: exception.getStatus(),
      message: exception.message,
      hint: exception.hint,
      fields: exception.fields,
    };
  }

  if (exception instanceof ValidationException) {
    return mapped(ErrorCode.INVALID_INPUT, { fields: exception.fields });
  }

  if (exception instanceof ThrottlerException) {
    return mapped(ErrorCode.TOO_MANY_ATTEMPTS);
  }

  if (isMulterError(exception)) {
    const err: any = exception;
    if (err.code === 'LIMIT_FILE_SIZE') {
      return mapped(ErrorCode.FILE_REJECTED, { status: HttpStatus.PAYLOAD_TOO_LARGE });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return mapped(ErrorCode.FILE_REJECTED, {
        status: HttpStatus.BAD_REQUEST,
        message: 'That file field is not accepted here.',
      });
    }
    return mapped(ErrorCode.FILE_REJECTED, { status: HttpStatus.BAD_REQUEST });
  }

  if (isEntityTooLarge(exception)) {
    return mapped(ErrorCode.FILE_REJECTED, { status: HttpStatus.PAYLOAD_TOO_LARGE });
  }

  if (isBodyParserJsonError(exception)) {
    // Deliberately generic — never exception.message here, that's the body
    // fragment this check exists to keep out of the response.
    return mapped(ErrorCode.INVALID_INPUT);
  }

  if (
    exception instanceof ConnectionError ||
    exception instanceof SequelizeTimeoutError ||
    exception instanceof ConnectionRefusedError ||
    exception instanceof ConnectionAcquireTimeoutError
  ) {
    return mapped(ErrorCode.SERVICE_UNAVAILABLE);
  }

  if (exception instanceof UniqueConstraintError) {
    return mapped(ErrorCode.ALREADY_EXISTS);
  }

  if (exception instanceof ForeignKeyConstraintError) {
    return mapped(ErrorCode.INVALID_INPUT, {
      message: "That refers to something that doesn't exist.",
    });
  }

  if (exception instanceof SequelizeValidationError) {
    return mapped(ErrorCode.INVALID_INPUT);
  }

  if (exception instanceof DatabaseError) {
    // Not a connection/pool failure (those are their own classes, checked
    // above) and not a unique/foreign-key constraint (also checked above).
    // A MySQL errno for data that can never be saved as given (NULL into a
    // NOT NULL column, a value too long/out of range) is a data problem,
    // not a transient one — 400, not the 503 a client would retry forever,
    // and not a bare 500 either. Any OTHER DatabaseError (a real, unknown
    // DB fault) falls through to the generic INTERNAL 500 at the bottom.
    const errno: number | undefined = (exception as any)?.original?.errno ?? (exception as any)?.parent?.errno;
    if (errno !== undefined && NEVER_SAVEABLE_MYSQL_ERRNOS.has(errno)) {
      return mapped(ErrorCode.INVALID_INPUT);
    }
  }

  if (exception instanceof UnauthorizedException) {
    return mapped(ErrorCode.SIGN_IN_REQUIRED);
  }

  if (exception instanceof ForbiddenException) {
    return mapped(ErrorCode.NOT_ALLOWED);
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const ownMessage = ownShapeMessage(exception);

    // Nest's own multer-error conversion for an unrecognized field name
    // (multer code LIMIT_UNEXPECTED_FILE) — a BadRequestException whose
    // message is the fixed, non-user-controlled string "Unexpected
    // field". Checked here (not by isMulterError) because Nest has
    // already converted it away from a raw MulterError by this point.
    if (status === HttpStatus.BAD_REQUEST && !ownMessage && exception.message === 'Unexpected field') {
      return mapped(ErrorCode.FILE_REJECTED, { status, message: 'That file field is not accepted here.' });
    }
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      return mapped(ErrorCode.FILE_REJECTED, { status });
    }
    if (status === HttpStatus.CONFLICT) {
      return mapped(ErrorCode.ALREADY_EXISTS, { status, ...(ownMessage ? { message: ownMessage } : {}) });
    }
    if (status === HttpStatus.NOT_FOUND) {
      // Never forward a message we don't recognize as our own: throw sites
      // across this repo built 404 messages from an id/path, and Nest's
      // own unmatched-route 404 message embeds the request path+query
      // ("Cannot GET /path?..."), neither of which the contract allows.
      return mapped(ErrorCode.NOT_FOUND, { status, ...(ownMessage ? { message: ownMessage } : {}) });
    }
    if (status >= 400 && status < 500) {
      return mapped(ErrorCode.INVALID_INPUT, { status, ...(ownMessage ? { message: ownMessage } : {}) });
    }
    // Any remaining HttpException status (5xx): keep its status, generic
    // message — never forward .message here, same reasoning as the bare-
    // Error fallback below.
    return { code: ErrorCode.INTERNAL, status, message: ErrorCatalogue[ErrorCode.INTERNAL].message };
  }

  // Not an HttpException at all: an unhandled JS error, a Sequelize error
  // type not specifically classified above, a hostile err.message from a
  // library — never forward `.message` here, that is exactly the leak
  // this contract closes.
  return mapped(ErrorCode.INTERNAL);
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const errordetails = exception as any;
    const logid = uuidv4();
    const reference = generateErrorReference();

    const { code, status, message, hint: rawHint, fields } = mapException(exception);

    // INVALID_INPUT's catalogue hint ("Check the highlighted fields.")
    // only makes sense when there ARE highlighted fields. A malformed-JSON
    // body, or an ApiError(INVALID_INPUT) throw site that didn't supply
    // `fields` (there's nothing field-shaped to check — see the ~15
    // converted throw sites), has none: showing that hint anyway would
    // point the user at UI that isn't there.
    const hint =
      code === ErrorCode.INVALID_INPUT && (!fields || fields.length === 0) ? undefined : rawHint;

    // 4xx is expected traffic (bad input, a throttled login burst, a stale
    // token) and logged at warn; 5xx is logged at error. A 429 previously
    // skipped logging altogether to avoid flooding the error log during a
    // sustained burst — same intent, now folded into "warn, not error".
    const level = status >= 500 ? 'error' : 'warn';

    // Route TEMPLATE (e.g. "/question/lesson/:lessonid"), never the full
    // URL with its query string. `request.route` is only set once Nest's
    // router has matched a handler; for an unmatched route (404) or a
    // pre-routing failure (body-parser), fall back to `request.path` —
    // the pathname only, never `.originalUrl`/`.query` (those carry the
    // query string).
    const route = request?.route?.path ?? request?.path;

    // Never log the raw exception message/stack for a malformed-JSON body
    // or an unmatched route: both carry request content (a body fragment,
    // or the URL+query string) that this log ships to the cloud in
    // rpi-api's teacher export. Log the exception's class and a fixed note
    // instead of either field.
    const redact = hasLoggableRequestContent(exception);
    const dbErrorFields = sequelizeDbErrorLogFields(exception);

    Logger[level]('Exception', {
      reference,
      code,
      status,
      method: request?.method,
      route,
      userid: request?.user?.schooluserid,
      exception: dbErrorFields
        ? {
            class: errordetails?.constructor?.name,
            errno: dbErrorFields.errno,
            sqlState: dbErrorFields.sqlState,
          }
        : {
            class: errordetails?.constructor?.name,
            message: redact ? '(withheld: contains request URL/body content)' : errordetails?.message,
            stack: redact ? undefined : errordetails?.stack,
          },
      logid,
    });

    const errorresponse: IErrorResponse = {
      error: true,
      data: false,
      code,
      errormessage: message,
      reference,
    };
    if (hint) {
      errorresponse.hint = hint;
    }
    if (fields && fields.length > 0) {
      errorresponse.fields = fields;
    }
    if (Config.fortyk.api.rpi.debug && errordetails?.stack && !redact && !dbErrorFields) {
      errorresponse.stack = errordetails.stack;
      errorresponse.logid = logid;
    }
    response.status(status).json(errorresponse);
  }
}
