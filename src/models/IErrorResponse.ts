import { ApiProperty } from '@nestjs/swagger';
import { IResponse } from './IResponse';
import { ErrorCode } from './enums/errorcode.enum';
import { FieldError } from './FieldError';

export class IErrorResponse extends IResponse<Boolean> {
  @ApiProperty({ type: Boolean })
  data?: Boolean = false;

  /** Always present. Clients translate by this, not by `errormessage` text. */
  @ApiProperty({ enum: ErrorCode })
  code?: ErrorCode;

  /** Present when there is something useful to try. */
  @ApiProperty({ type: String, required: false })
  hint?: string;

  /**
   * Always present, in production too, shown to every user. `E-` plus 6
   * unambiguous characters. Logged with the full detail server-side.
   */
  @ApiProperty({ type: String })
  reference?: string;

  /** Only for INVALID_INPUT: one entry per invalid field. */
  @ApiProperty({ type: [Object], required: false })
  fields?: FieldError[];

  @ApiProperty()
  stack?: string;
}
