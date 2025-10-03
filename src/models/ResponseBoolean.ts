import { ApiProperty } from '@nestjs/swagger';
import { IResponse } from './IResponse';

export class ResponseBoolean extends IResponse<Boolean> {
    @ApiProperty({ type: Boolean })
    data: Boolean;

    constructor() {
        super();
        this.data = false;
    }
}
