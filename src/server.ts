import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Config, Logger } from './config';
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
  const config = new DocumentBuilder().setTitle('EdTech LMS RPI API').setDescription('Educational Technology Learning Management System RPI API').setVersion("1.0.0").addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("docs", app, document);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  app.enableCors();
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
