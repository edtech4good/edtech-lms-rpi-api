import { ApiProperty } from '@nestjs/swagger';
import { IResponse } from './IResponse';

export class IErrorResponse extends IResponse<Boolean> {
  @ApiProperty({ type: Boolean })
  data?: Boolean = false;

  @ApiProperty()
  stack?: string;
}
