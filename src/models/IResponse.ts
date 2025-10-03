import { ApiProperty } from '@nestjs/swagger';

export class IResponse<T> {

  data?: T | null;

  @ApiProperty({ type: String })
  errormessage?: string | null;

  @ApiProperty({ type: Boolean })
  error = false;

  @ApiProperty({ type: String })
  logid?: string | null;

  constructor() {
    this.data = null;
    this.errormessage = null;
    this.error = false;
    this.logid = null;
  }
}
