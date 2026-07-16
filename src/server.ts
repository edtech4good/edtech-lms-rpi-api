import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Config, Logger, isLocalDev } from './config';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { initModels, setuprelationshipforreport } from './models/data-models/init-models';
import { dbinstance } from "./services/dbservice"
//import { TestApp } from "./test"
async function bootstrap() {
  initModels(dbinstance.getdbinstance());
  await dbinstance.getdbinstance().sync();
  setuprelationshipforreport(dbinstance.getdbinstance());
  /*
  const app1 = new TestApp();
  app1.run().catch(err => console.error(err));
*/

  Logger.info('Connected to DB');
  const app = await NestFactory.create(AppModule);
  //app.setGlobalPrefix("api");
  // Swagger (/docs and /docs-json) is a full map of the API surface — every
  // route, param and DTO. Useful locally, an anonymous recon aid in production.
  // Mounted only in local dev, gated on the same isLocalDev the secret guard
  // and CORS use. To expose it in production later, put it behind auth instead.
  if (isLocalDev) {
    const config = new DocumentBuilder().setTitle('EdTech LMS RPI API').setDescription('Educational Technology Learning Management System RPI API').setVersion("1.0.0").addBearerAuth().build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("docs", app, document);
  } else {
    Logger.info('Swagger /docs disabled (production)');
  }
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  // CORS: an allowlist in production, permissive in local dev.
  //
  // Auth here is a Bearer token, not a cookie, so this is defence in depth.
  // Production browser origins come from CORS_ORIGINS (comma-separated) — for
  // this API that is the Expo web build. Requests with no Origin header — the
  // Expo native app, the central API proxying in (RPI_CLOUD), curl and health
  // checks — are always allowed; CORS only governs browser cross-origin calls.
  //
  // Local dev reflects any origin: Expo web (8081/19006) and physical devices
  // on LAN IPs move around, and dev machines are not the threat model. Gated on
  // the same isLocalDev the secret guard uses.
  const allowedOrigins = new Set<string>(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  );
  if (!isLocalDev && allowedOrigins.size === 0) {
    Logger.warn(
      'CORS: no allowed origins configured (set CORS_ORIGINS). Browser clients ' +
        'will be blocked; no-Origin requests (native app, RPI_CLOUD proxy) still work.'
    );
  }
  Logger.info(
    `CORS: ${
      isLocalDev
        ? 'local dev — reflecting any origin'
        : `allowlist [${[...allowedOrigins].join(', ') || '(none)'}]`
    }`
  );
  app.enableCors({
    origin: isLocalDev
      ? true
      : (origin, callback) => {
          // No Origin header (native app, RPI_CLOUD proxy, curl): allow.
          if (!origin) return callback(null, true);
          return callback(null, allowedOrigins.has(origin));
        },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Accept-Language',
      'Cache-Control',
      'TIMEOFFSET',
    ],
  });
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(Config.fortyk.api.rpi.port);

  Logger.info(`Application is running on: ${await app.getUrl()}`);
  const exitHandler = async () => {
    if (app) {
      await app.close();
      Logger.info('Server closed');
      process.exit(1);
    } else {
      process.exit(1);
    }
  };

  const unexpectedErrorHandler = (error: unknown) => {
    Logger.error(error);
    exitHandler();
  };

  process.on('uncaughtException', unexpectedErrorHandler);
  process.on('unhandledRejection', unexpectedErrorHandler);

  process.on('SIGTERM', () => {
    Logger.info('SIGTERM received');
    if (app) {
      app.close();
    }
  });
}
bootstrap();
