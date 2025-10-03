import { ApiProperty } from '@nestjs/swagger';

export class IPagingResult<T> {
    @ApiProperty()
    pageindex: number = 0;
    @ApiProperty()
    pagesize: number = 0;
    data: Array<T> = [];
    @ApiProperty()
    total: number = 0;
}

