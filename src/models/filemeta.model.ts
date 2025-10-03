import { ApiProperty } from '@nestjs/swagger';

export class FileMeta {
    @ApiProperty()
    filetype: number = 0;
    @ApiProperty()
    filename: string = "";
    @ApiProperty()
    fileext: string = "";
}
