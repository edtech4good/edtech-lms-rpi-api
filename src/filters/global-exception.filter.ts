import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ValidationException } from '../models/ValidationException';
import { Config, Logger } from '../config';
import { IErrorResponse } from 'src/models/IErrorResponse';
import { CustomForbiddenException } from 'src/models/CustomForbiddenException';
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    // const request = ctx.getRequest();
    const errordetails = exception as any;
    const logid = uuidv4();
    const isvalidationError = exception instanceof ValidationException;
    if (!isvalidationError) {
      Logger.error('Exception', { exception: errordetails, logid });
    }
    if (exception instanceof CustomForbiddenException) {
      response.status((exception as CustomForbiddenException).getStatus()).json('invalid');
      return;
    }
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorresponse: IErrorResponse = {
      error: true,
      errormessage: errordetails?.response?.errormessage || errordetails.message,
      data: false,
    };
    if (Config.fortyk.api.rpi.debug && errordetails.stack && !isvalidationError) {
      errorresponse.stack = errordetails.stack;
      errorresponse.logid = logid;
    }
    response.status(status).json(errorresponse);
  }
}
