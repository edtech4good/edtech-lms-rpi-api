import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { MulterError } from 'multer';
import {
  ConnectionError,
  ConnectionRefusedError,
  DatabaseError,
  ForeignKeyConstraintError,
  TimeoutError as SequelizeTimeoutError,
  UniqueConstraintError,
  ValidationError as SequelizeValidationError,
  ValidationErrorItem,
} from 'sequelize';
import { Config, Logger } from '../config';
import { ApiError } from '../models/ApiError';
import { ErrorCode } from '../models/enums/errorcode.enum';
import { ErrorCatalogue } from '../models/error-catalogue';
import { ValidationException } from '../models/ValidationException';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Guards the 25 Sep 2026 error contract (docs/api-errors.md) end to end:
 * the global filter is the single place every exception in the app is
 * classified into `{code, errormessage, hint, reference}`, and it is the
 * place that closes audit gap #1 ("Exception filter leaks internal
 * errors" — a non-HttpException's raw `.message`, including SQL text,
 * used to reach the client verbatim).
 */

const REFERENCE_PATTERN = /^E-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

const makeHost = (request: Record<string, unknown> = {}) => {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', route: { path: '/question/lesson/:lessonid' }, ...request }),
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

const catchAndGetBody = (exception: unknown, request: Record<string, unknown> = {}) => {
  const { host, response } = makeHost(request);
  new GlobalExceptionFilter().catch(exception, host);
  const status = (response.status as jest.Mock).mock.calls[0][0];
  const body = (response.json as jest.Mock).mock.calls[0][0];
  return { status, body };
};

describe('GlobalExceptionFilter', () => {
  const originalDebug = Config.fortyk.api.rpi.debug;

  afterEach(() => {
    Config.fortyk.api.rpi.debug = originalDebug;
    jest.restoreAllMocks();
  });

  it('is defined', () => {
    expect(new GlobalExceptionFilter()).toBeDefined();
  });

  it('every response carries a reference, in the E-XXXXXX shape, even outside debug mode', () => {
    Config.fortyk.api.rpi.debug = false;
    const { body } = catchAndGetBody(new Error('boom'));
    expect(body.reference).toMatch(REFERENCE_PATTERN);
  });

  it('two errors in a row get different references (crypto-random, not a counter or constant)', () => {
    const { body: a } = catchAndGetBody(new Error('one'));
    const { body: b } = catchAndGetBody(new Error('two'));
    expect(a.reference).not.toEqual(b.reference);
  });

  describe('mapping table (docs/api-errors.md)', () => {
    it('ApiError passes its own code/status/message/hint straight through', () => {
      const { status, body } = catchAndGetBody(
        new ApiError(ErrorCode.NOT_FOUND, { message: 'Custom not-found text.' })
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({
        error: true,
        data: false,
        code: ErrorCode.NOT_FOUND,
        errormessage: 'Custom not-found text.',
      });
      expect(body.hint).toBeDefined();
    });

    it('ValidationException (Joi) -> INVALID_INPUT 400 with a fields array, AND the "check the highlighted fields" hint (fields ARE present)', () => {
      const { status, body } = catchAndGetBody(
        new ValidationException([{ field: 'email', message: 'Enter a valid email address for email.' }])
      );
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(body.fields).toEqual([{ field: 'email', message: 'Enter a valid email address for email.' }]);
      expect(body.hint).toBe(ErrorCatalogue[ErrorCode.INVALID_INPUT].hint);
    });

    it('an INVALID_INPUT with no fields (malformed JSON, or an ApiError(INVALID_INPUT) throw site with none) omits the "check the highlighted fields" hint — there is nothing to highlight', () => {
      const malformed = catchAndGetBody(new BadRequestException('some other 400 with no fields'));
      expect(malformed.body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(malformed.body.hint).toBeUndefined();

      const apiError = catchAndGetBody(new ApiError(ErrorCode.INVALID_INPUT, { message: "Content length can't be 0." }));
      expect(apiError.body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(apiError.body.hint).toBeUndefined();
    });

    it('ThrottlerException -> TOO_MANY_ATTEMPTS 429', () => {
      const { status, body } = catchAndGetBody(new ThrottlerException());
      expect(status).toBe(429);
      expect(body.code).toBe(ErrorCode.TOO_MANY_ATTEMPTS);
    });

    it('MulterError LIMIT_FILE_SIZE -> FILE_REJECTED 413', () => {
      const { status, body } = catchAndGetBody(new MulterError('LIMIT_FILE_SIZE', 'importfile'));
      expect(status).toBe(413);
      expect(body.code).toBe(ErrorCode.FILE_REJECTED);
    });

    it('MulterError of any other kind -> FILE_REJECTED 400', () => {
      const { status, body } = catchAndGetBody(new MulterError('LIMIT_UNEXPECTED_FILE', 'importfile'));
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.FILE_REJECTED);
    });

    it.each([
      ['ConnectionError', new ConnectionError(new Error('ECONNREFUSED 10.0.0.1:3306'))],
      ['ConnectionRefusedError', new ConnectionRefusedError(new Error('ECONNREFUSED'))],
      [
        'Sequelize TimeoutError',
        new SequelizeTimeoutError({ message: 'ETIMEDOUT', sql: '' } as any),
      ],
    ])('Sequelize %s -> SERVICE_UNAVAILABLE 503, without leaking the underlying message', (_name, exception) => {
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(503);
      expect(body.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
      expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.1|ECONNREFUSED|ETIMEDOUT/);
    });

    it('Sequelize UniqueConstraintError -> ALREADY_EXISTS 409', () => {
      const exception = new UniqueConstraintError({
        message: 'Duplicate entry for key studentprogress.uq_natural_key',
      } as any);
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(409);
      expect(body.code).toBe(ErrorCode.ALREADY_EXISTS);
      expect(JSON.stringify(body)).not.toMatch(/uq_natural_key|Duplicate entry/);
    });

    it('Sequelize ForeignKeyConstraintError -> INVALID_INPUT 400', () => {
      const exception = new ForeignKeyConstraintError({
        message: 'Cannot add or update a child row: a foreign key constraint fails',
      } as any);
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(JSON.stringify(body)).not.toMatch(/foreign key constraint fails/);
    });

    it('UnauthorizedException -> SIGN_IN_REQUIRED 401', () => {
      const { status, body } = catchAndGetBody(new UnauthorizedException());
      expect(status).toBe(401);
      expect(body.code).toBe(ErrorCode.SIGN_IN_REQUIRED);
    });

    it('ForbiddenException -> NOT_ALLOWED 403', () => {
      const { status, body } = catchAndGetBody(new ForbiddenException());
      expect(status).toBe(403);
      expect(body.code).toBe(ErrorCode.NOT_ALLOWED);
    });

    it('NotFoundException with a plain string message (Nest\'s own default body — every throw site in this repo now uses ApiError instead) never forwards it: ids/paths must not reach the client', () => {
      // `new NotFoundException('...')` produces Nest's OWN default
      // `{statusCode, message, error}` shape, not this repo's own
      // `{error:true, errormessage}` object — the exact shape an
      // unmatched route's 404 also uses (see the "unknown route" test
      // below). This is the actual leak risk; a hand-authored
      // `{error:true, errormessage}` body is deliberately trusted instead
      // (see the next test) since every real NOT_FOUND throw site in this
      // repo now goes through `ApiError`, not a raw `NotFoundException`.
      const { status, body } = catchAndGetBody(new NotFoundException('lesson 8f14e-secret-id not found'));
      expect(status).toBe(404);
      expect(body.code).toBe(ErrorCode.NOT_FOUND);
      expect(body.errormessage).not.toMatch(/8f14e-secret-id/);
    });

    it("an unmatched route's own 404 (Nest's default 'Cannot GET /path?query' message) never leaks the path or query string", () => {
      const { status, body } = catchAndGetBody(
        new NotFoundException("Cannot GET /student/secret-student-id?token=abc123")
      );
      expect(status).toBe(404);
      expect(body.code).toBe(ErrorCode.NOT_FOUND);
      expect(JSON.stringify(body)).not.toMatch(/secret-student-id|token=abc123|Cannot GET/);
    });

    it("this repo's own {error:true, errormessage} object shape (~15 first-party throw sites, e.g. import.controller.ts's FILE_REJECTED messages) IS trusted and forwarded", () => {
      const { status, body } = catchAndGetBody(
        new BadRequestException({ error: true, errormessage: "Content length can't be 0." })
      );
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(body.errormessage).toBe("Content length can't be 0.");
    });

    it('a malformed-JSON body (arrives as a plain BadRequestException whose message quotes the offending body) never echoes that fragment in the response', () => {
      // The exact shape observed from a real Nest app + supertest for
      // `POST` with invalid JSON: Nest's own default body, `.message` set
      // to the underlying JSON.parse SyntaxError's message.
      const exception = new BadRequestException(
        `Unexpected token 'h', ..."assword": hunter2sec"... is not valid JSON`
      );
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(JSON.stringify(body)).not.toMatch(/hunter2sec/);
    });

    it('a malformed-JSON body whose SyntaxError message does NOT start with "Unexpected" (detection must not depend on that exact wording) is still recognized', () => {
      // A different, equally real V8 JSON.parse phrasing (e.g. a missing
      // comma), still containing "JSON" and still a 400 in Nest's default
      // body shape. If detection were keyed off `/^Unexpected/`, this
      // would slip through as an ordinary HttpException and get its
      // message forwarded (it wouldn't leak a secret here, but it proves
      // the detection is message-wording-independent, not that this exact
      // string is safe).
      const exception = new BadRequestException(
        `Expected ',' or '}' after property value in JSON at position 12`
      );
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(body.errormessage).toBe(ErrorCatalogue[ErrorCode.INVALID_INPUT].message);
    });

    it('any other HttpException status: 4xx -> INVALID_INPUT (generic unless own-shape), 5xx -> INTERNAL (generic, code never contradicts status)', () => {
      const forbiddenLike = catchAndGetBody(new BadRequestException('some 4xx that is not one of the specific classes'));
      expect(forbiddenLike.status).toBe(400);
      expect(forbiddenLike.body.code).toBe(ErrorCode.INVALID_INPUT);

      class CustomServerError extends BadRequestException {
        constructor() {
          super('boom');
          // Force a 5xx status while remaining an HttpException, to prove
          // the fallback is keyed off the STATUS, not the exception class.
          Object.defineProperty(this, 'status', { value: 502 });
        }
        getStatus() {
          return 502;
        }
      }
      const serverError = catchAndGetBody(new CustomServerError());
      expect(serverError.status).toBe(502);
      expect(serverError.body.code).toBe(ErrorCode.INTERNAL);
      expect(serverError.body.errormessage).toBe('Something went wrong on our side.');
    });

    it("a raw (non-HttpException) body-too-large error from body-parser's own middleware (app.use(json(...)) in server.ts, thrown before Nest's pipeline) -> FILE_REJECTED 413", () => {
      const bodyParserError: any = new Error('request entity too large');
      bodyParserError.type = 'entity.too.large';
      bodyParserError.status = 413;
      bodyParserError.statusCode = 413;
      const { status, body } = catchAndGetBody(bodyParserError);
      expect(status).toBe(413);
      expect(body.code).toBe(ErrorCode.FILE_REJECTED);
    });

    it('Nest\'s own PayloadTooLargeException (e.g. multer LIMIT_FILE_SIZE, already converted by FileInterceptor before this filter sees it) -> FILE_REJECTED 413', () => {
      const { status, body } = catchAndGetBody(new PayloadTooLargeException('File too large'));
      expect(status).toBe(413);
      expect(body.code).toBe(ErrorCode.FILE_REJECTED);
    });

    it("Nest's own multer-unexpected-field conversion (BadRequestException('Unexpected field')) -> FILE_REJECTED 400 with a plain message", () => {
      const { status, body } = catchAndGetBody(new BadRequestException('Unexpected field'));
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.FILE_REJECTED);
      expect(body.errormessage).toBe('That file field is not accepted here.');
    });

    it('a raw MulterError (name-based detection: @nestjs/platform-express vendors its own multer copy, so instanceof fails across the two) still maps correctly', () => {
      const raw: any = new Error('File too large');
      raw.name = 'MulterError';
      raw.code = 'LIMIT_FILE_SIZE';
      const { status, body } = catchAndGetBody(raw);
      expect(status).toBe(413);
      expect(body.code).toBe(ErrorCode.FILE_REJECTED);
    });

    it('Sequelize ValidationError -> INVALID_INPUT 400', () => {
      const exception = new SequelizeValidationError('Validation error', [
        { message: 'studentfirstname cannot be null', path: 'studentfirstname' } as unknown as ValidationErrorItem,
      ]);
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(JSON.stringify(body)).not.toMatch(/studentfirstname/);
    });

    it("Sequelize DatabaseError for data that can NEVER be saved (MySQL errno 1406, data too long) -> INVALID_INPUT 400, not a 500 or a retried 503", () => {
      const exception = new DatabaseError({
        message: "Data too long for column 'studentfirstname' at row 1",
        sql: '',
        errno: 1406,
      } as any);
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(JSON.stringify(body)).not.toMatch(/studentfirstname/);
    });

    it('Sequelize DatabaseError for an unrecognized errno -> INTERNAL 500 (falls through to the generic bucket, not 400 or 503)', () => {
      const exception = new DatabaseError({
        message: 'Some other MySQL fault',
        sql: '',
        errno: 9999,
      } as any);
      const { status, body } = catchAndGetBody(exception);
      expect(status).toBe(500);
      expect(body.code).toBe(ErrorCode.INTERNAL);
    });

    it('anything else (a bare Error, e.g. from an unwrapped throw site) -> INTERNAL 500 with a GENERIC message; the real message/stack never reaches the body', () => {
      const { status, body } = catchAndGetBody(
        new Error("SELECT * FROM schoolusers WHERE schoolusername = 'x' OR 1=1; --")
      );
      expect(status).toBe(500);
      expect(body.code).toBe(ErrorCode.INTERNAL);
      expect(body.errormessage).toBe('Something went wrong on our side.');
      expect(JSON.stringify(body)).not.toMatch(/SELECT|schoolusers|OR 1=1/);
    });
  });

  describe('debug mode', () => {
    it('never includes a stack when NOT in debug mode', () => {
      Config.fortyk.api.rpi.debug = false;
      const { body } = catchAndGetBody(new Error('boom'));
      expect(body.stack).toBeUndefined();
      expect(body.logid).toBeUndefined();
    });

    it('includes stack + logid when in debug mode', () => {
      Config.fortyk.api.rpi.debug = true;
      const { body } = catchAndGetBody(new Error('boom'));
      expect(typeof body.stack).toBe('string');
      expect(typeof body.logid).toBe('string');
    });
  });

  describe('logging', () => {
    it('a Sequelize DatabaseError/ValidationError is logged by errno/sqlState/class only — the driver message (which can quote the offending VALUE, e.g. errno 1366) never reaches the log', () => {
      const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => Logger as any);
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);

      const marker = 'DBVALUESECRET';
      const dbException = new DatabaseError({
        message: `Incorrect integer value: '${marker}' for column 'age' at row 1`,
        sql: '',
        errno: 9999,
        code: 'ER_TRUNCATED_WRONG_VALUE',
      } as any);

      catchAndGetBody(dbException);

      const allLoggedArgs = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => JSON.stringify(c));
      expect(allLoggedArgs.join('\n')).not.toMatch(new RegExp(marker));

      const [, meta]: any = errorSpy.mock.calls[0] ?? warnSpy.mock.calls[0];
      expect(meta.exception.errno).toBe(9999);
      expect(meta.exception.sqlState).toBe('ER_TRUNCATED_WRONG_VALUE');
      expect(meta.exception.message).toBeUndefined();
      expect(meta.exception.stack).toBeUndefined();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('a Sequelize UniqueConstraintError (extends ValidationError) is also logged by errno/class only, not its message (which can name the duplicate value)', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);

      const marker = 'DUPLICATEVALUESECRET';
      const exception = new UniqueConstraintError({
        message: `Duplicate entry '${marker}' for key 'schoolusers.email'`,
        parent: { errno: 1062, code: 'ER_DUP_ENTRY' } as any,
      } as any);

      catchAndGetBody(exception);

      const loggedArgs = JSON.stringify(warnSpy.mock.calls[0]);
      expect(loggedArgs).not.toMatch(new RegExp(marker));

      warnSpy.mockRestore();
    });

    it('logs 4xx at warn and 5xx at error, exactly once, with the reference/code/status/route/userid — never the request body, password, Authorization header or cookies', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);
      const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => Logger as any);

      catchAndGetBody(new UnauthorizedException(), {
        method: 'POST',
        user: { schooluserid: 'u1' },
        body: { password: 'hunter2', email: 'student@example.com' },
        headers: { authorization: 'Bearer secret-token', cookie: 'session=abc' },
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
      const loggedArgs = JSON.stringify(warnSpy.mock.calls[0]);
      expect(loggedArgs).not.toMatch(/hunter2|secret-token|session=abc/);

      const [, meta]: any = warnSpy.mock.calls[0];
      expect(meta.code).toBe(ErrorCode.SIGN_IN_REQUIRED);
      expect(meta.status).toBe(401);
      expect(meta.userid).toBe('u1');
      expect(meta.reference).toMatch(REFERENCE_PATTERN);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('logs a 500 at error, not warn', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);
      const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => Logger as any);

      catchAndGetBody(new Error('boom'));

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('logs request.route.path (the TEMPLATE) when a route matched, never request.originalUrl or the query string', () => {
      const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => Logger as any);

      catchAndGetBody(new Error('boom'), {
        route: { path: '/question/lesson/:lessonid' },
        path: '/question/lesson/abc-123',
        originalUrl: '/question/lesson/abc-123?token=super-secret',
        url: '/question/lesson/abc-123?token=super-secret',
      });

      const [, meta]: any = errorSpy.mock.calls[0];
      expect(meta.route).toBe('/question/lesson/:lessonid');
      expect(JSON.stringify(meta)).not.toMatch(/super-secret|abc-123/);

      errorSpy.mockRestore();
    });

    it('falls back to request.path (never originalUrl/query) when no route matched (e.g. a 404 on an unknown path)', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);

      catchAndGetBody(new NotFoundException('Cannot GET /nope?token=super-secret'), {
        route: undefined,
        path: '/nope',
        originalUrl: '/nope?token=super-secret',
      });

      const [, meta]: any = warnSpy.mock.calls[0];
      expect(meta.route).toBe('/nope');
      expect(JSON.stringify(meta)).not.toMatch(/super-secret/);

      warnSpy.mockRestore();
    });

    it('the reference written to the log is the exact same reference sent in the response', () => {
      const errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => Logger as any);

      const { body } = catchAndGetBody(new Error('boom'));

      const [, meta]: any = errorSpy.mock.calls[0];
      expect(meta.reference).toBe(body.reference);

      errorSpy.mockRestore();
    });

    it('never logs the body fragment from a malformed-JSON exception (the log ships to the cloud in the teacher export)', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);

      catchAndGetBody(
        new BadRequestException(`Unexpected token 'h', ..."assword": hunter2sec"... is not valid JSON`)
      );

      const loggedArgs = JSON.stringify(warnSpy.mock.calls[0]);
      expect(loggedArgs).not.toMatch(/hunter2sec/);

      warnSpy.mockRestore();
    });

    it('never logs the message/stack for a malformed-JSON exception phrased differently than "Unexpected ..." (detection is not wording-dependent)', () => {
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);

      catchAndGetBody(
        new BadRequestException(`Expected ',' or '}' after property value in JSON at position 12`)
      );

      const [, meta]: any = warnSpy.mock.calls[0];
      expect(meta.exception.message).not.toMatch(/property value/);
      expect(meta.exception.stack).toBeUndefined();

      warnSpy.mockRestore();
    });
  });
});
