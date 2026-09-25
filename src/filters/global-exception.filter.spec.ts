import { ArgumentsHost, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { MulterError } from 'multer';
import {
  ConnectionError,
  ConnectionRefusedError,
  ForeignKeyConstraintError,
  TimeoutError as SequelizeTimeoutError,
  UniqueConstraintError,
} from 'sequelize';
import { Config, Logger } from '../config';
import { ApiError } from '../models/ApiError';
import { ErrorCode } from '../models/enums/errorcode.enum';
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

    it('ValidationException (Joi) -> INVALID_INPUT 400 with a fields array', () => {
      const { status, body } = catchAndGetBody(
        new ValidationException([{ field: 'email', message: 'Enter a valid email address for email.' }])
      );
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(body.fields).toEqual([{ field: 'email', message: 'Enter a valid email address for email.' }]);
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

    it('NotFoundException -> NOT_FOUND 404, and never forwards the exception message (ids/paths in the message must not reach the client)', () => {
      const { status, body } = catchAndGetBody(
        new NotFoundException({ error: true, errormessage: 'lesson 8f14e-secret-id not found' }, 'lesson 8f14e-secret-id not found')
      );
      expect(status).toBe(404);
      expect(body.code).toBe(ErrorCode.NOT_FOUND);
      expect(body.errormessage).not.toMatch(/8f14e-secret-id/);
    });

    it('a plain BadRequestException (existing ~30 throw sites) keeps its own plain-language message, mapped to INVALID_INPUT 400', () => {
      const { status, body } = catchAndGetBody(
        new BadRequestException({ error: true, errormessage: "Content length can't be 0." })
      );
      expect(status).toBe(400);
      expect(body.code).toBe(ErrorCode.INVALID_INPUT);
      expect(body.errormessage).toBe("Content length can't be 0.");
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
  });
});
