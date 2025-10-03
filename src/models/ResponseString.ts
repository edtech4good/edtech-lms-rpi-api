import { ApiProperty } from '@nestjs/swagger';
import { IResponse } from './IResponse';

export class ResponseString extends IResponse<String> {
    @ApiProperty({ type: String })
    data: string;

    constructor() {
        super();
        this.data = "";
    }
}
