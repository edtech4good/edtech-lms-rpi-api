import { HttpException, HttpStatus } from '@nestjs/common';

export class ValidationException extends HttpException {
  constructor(errormessage: string) {
    super(errormessage, HttpStatus.BAD_REQUEST);
  }
}
