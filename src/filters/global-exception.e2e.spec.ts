import {
  Body,
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import joi from 'joi';
import request from 'supertest';
import { Logger } from '../config';
import { SchemaValidationInterceptor } from '../interceptors';
import { GlobalExceptionFilter } from './global-exception.filter';

/**
 * Real-pipeline tests: a real Nest application (real body-parser, real
 * Joi interceptor, real FileInterceptor/multer, real GlobalExceptionFilter)
 * driven over HTTP with supertest, rather than calling `.catch()` directly
 * with a hand-built exception. This is the only way to prove what actually
 * reaches the filter for a malformed request BODY, a too-large upload, or a
 * real Joi failure — see global-exception.filter.spec.ts's unit tests for
 * everything else in the mapping table.
 */

@Controller('e2e')
class EchoController {
  @Post('echo')
  @UseInterceptors(
    new SchemaValidationInterceptor({
      body: joi.object({
        studentfirstname: joi.string().required(),
      }),
    } as any)
  )
  echo(@Body() body: unknown) {
    return { ok: true, body };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 } }))
  upload(@UploadedFile() file: unknown) {
    return { ok: true, received: !!file };
  }
}

describe('GlobalExceptionFilter (real pipeline: supertest against a real Nest app)', () => {
  let app: INestApplication;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication();
    // Mirrors server.ts: a plain express.json() middleware ahead of Nest's
    // own request pipeline, with a small limit so "too large" is reachable
    // without a multi-MB fixture body.
    app.use(json({ limit: '1kb' }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => Logger as any);
    errorSpy = jest.spyOn(Logger, 'error').mockImplementation(() => Logger as any);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('malformed JSON body: neither the response nor the log ever contains a fragment of the offending body', async () => {
    const res = await request(app.getHttpServer())
      .post('/e2e/echo')
      .set('Content-Type', 'application/json')
      .send('{"password": hunter2secretvalue');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    // V8's JSON.parse SyntaxError truncates its context to a handful of
    // characters around the parse error (see server logs for the real
    // shape: `Unexpected token 'h', ..."assword": hunter2sec"... is not
    // valid JSON`) — assert on that truncated fragment, not the full
    // literal string, which never appears verbatim either way.
    expect(JSON.stringify(res.body)).not.toMatch(/assword|hunter2sec/);

    const allLoggedArgs = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => JSON.stringify(c));
    expect(allLoggedArgs.join('\n')).not.toMatch(/assword|hunter2sec/);
  });

  it('oversized JSON body -> 413 FILE_REJECTED', async () => {
    const res = await request(app.getHttpServer())
      .post('/e2e/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ studentfirstname: 'x'.repeat(5000) }));

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_REJECTED');
  });

  it('an upload past the configured multer fileSize limit -> FILE_REJECTED (413)', async () => {
    const res = await request(app.getHttpServer())
      .post('/e2e/upload')
      .attach('file', Buffer.from('this is definitely more than ten bytes'), 'a.txt');

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_REJECTED');
  });

  it('an upload under an unexpected field name -> FILE_REJECTED with a plain message, not the raw multer "Unexpected field" text', async () => {
    const res = await request(app.getHttpServer())
      .post('/e2e/upload')
      .attach('not_the_expected_field', Buffer.from('small'), 'a.txt');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_REJECTED');
    expect(res.body.errormessage).toBe('That file field is not accepted here.');
  });

  it('a real Joi validation failure reports the field name WITHOUT a leading "body." segment', async () => {
    const res = await request(app.getHttpServer())
      .post('/e2e/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({}));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    expect(res.body.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'studentfirstname' })])
    );
    expect(JSON.stringify(res.body.fields)).not.toMatch(/\bbody\./);
  });

  it('a real Joi "unknown field" failure never puts the client-sent key into the response OR the log, even as a field name', async () => {
    const res = await request(app.getHttpServer())
      .post('/e2e/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ studentfirstname: 'Sokha', 'evil<script>x': 'y' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_INPUT');
    expect(JSON.stringify(res.body)).not.toMatch(/evil/);

    const allLoggedArgs = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => JSON.stringify(c));
    expect(allLoggedArgs.join('\n')).not.toMatch(/evil/);
  });
});
