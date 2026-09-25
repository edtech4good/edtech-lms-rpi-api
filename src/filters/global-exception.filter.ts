import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { MulterError } from 'multer';
import {
  ConnectionAcquireTimeoutError,
  ConnectionError,
  ConnectionRefusedError,
  ForeignKeyConstraintError,
  TimeoutError as SequelizeTimeoutError,
  UniqueConstraintError,
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
 * Nest's HttpException stores the thrown value verbatim in `getResponse()`
 * — a plain string, `{ statusCode, message, error }` (the framework's own
 * shape for `new BadRequestException('x')`), or this repo's long-standing
 * `{ error: true, errormessage }` object literal (~30 throw sites, pre-dating
 * this contract). `.message` alone is unreliable: for the object-literal
 * form Nest leaves it as the generic "Bad Request Exception". Prefer the
 * body's own `errormessage`/`message`, and only fall back to `.message`.
 */
function httpExceptionMessage(exception: HttpException): string {
  const body: any = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  if (body && typeof body === 'object') {
    if (typeof body.errormessage === 'string') {
      return body.errormessage;
    }
    if (typeof body.message === 'string') {
      return body.message;
    }
  }
  return exception.message;
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
 * Classifies any thrown value into the error contract (docs/api-errors.md,
 * "Mapping rules"). Order matters: more specific checks (ApiError,
 * ValidationException, known Sequelize/Multer/Throttler types) must run
 * before the generic HttpException / "anything else" fallbacks, since e.g.
 * a Sequelize UniqueConstraintError is not an HttpException at all and a
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

  if (exception instanceof MulterError) {
    // LIMIT_FILE_SIZE / LIMIT_FILE_COUNT etc are all "the upload doesn't
    // fit the rule", regardless of multer's own status (it always throws
    // without an HTTP status attached) — 413 for the size case, 400 for
    // everything else (bad field name, too many parts, ...).
    const status = exception.code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST;
    return mapped(ErrorCode.FILE_REJECTED, { status });
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

  if (exception instanceof UnauthorizedException) {
    return mapped(ErrorCode.SIGN_IN_REQUIRED);
  }

  if (exception instanceof ForbiddenException) {
    return mapped(ErrorCode.NOT_ALLOWED);
  }

  if (exception instanceof NotFoundException) {
    // Never forward the exception's own message: throw sites across this
    // repo built it from an id/path ("lesson <id> not found"), which the
    // contract forbids in a response.
    return mapped(ErrorCode.NOT_FOUND);
  }

  if (exception instanceof HttpException) {
    // Any other HttpException (a plain BadRequestException, etc.) that
    // isn't one of the specific types above. Its own message is used as-is
    // — these are hand-written throw sites already rewritten in plain
    // language, not internal/library detail — but it always gets a generic
    // INVALID_INPUT-shaped 400 unless it already carries its own status.
    const status = exception.getStatus();
    if (status === HttpStatus.BAD_REQUEST) {
      return mapped(ErrorCode.INVALID_INPUT, { status, message: httpExceptionMessage(exception) });
    }
    if (status === HttpStatus.CONFLICT) {
      return mapped(ErrorCode.ALREADY_EXISTS, { status, message: httpExceptionMessage(exception) });
    }
    // Any remaining HttpException status: keep its status, generic message.
    return { code: ErrorCode.INTERNAL, status, message: ErrorCatalogue[ErrorCode.INTERNAL].message };
  }

  // Not an HttpException at all: an unhandled JS error, a Sequelize error
  // type not listed above, a hostile err.message from a library — never
  // forward `.message` here, that is exactly the leak this contract closes.
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

    const { code, status, message, hint, fields } = mapException(exception);

    // 4xx is expected traffic (bad input, a throttled login burst, a stale
    // token) and logged at warn; 5xx is logged at error. A 429 previously
    // skipped logging altogether to avoid flooding the error log during a
    // sustained burst — same intent, now folded into "warn, not error".
    const level = status >= 500 ? 'error' : 'warn';
    Logger[level]('Exception', {
      reference,
      code,
      status,
      method: request?.method,
      // Route template (e.g. "/question/lesson/:lessonid"), never the full
      // URL with its query string — see "Never logged" in the spec.
      route: request?.route?.path,
      userid: request?.user?.schooluserid,
      exception: {
        class: errordetails?.constructor?.name,
        message: errordetails?.message,
        stack: errordetails?.stack,
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
    if (Config.fortyk.api.rpi.debug && errordetails?.stack) {
      errorresponse.stack = errordetails.stack;
      errorresponse.logid = logid;
    }
    response.status(status).json(errorresponse);
  }
}
