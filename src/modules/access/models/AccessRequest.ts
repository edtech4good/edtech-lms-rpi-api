import { ApiProperty } from "@nestjs/swagger";

export class AccessBody {
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}