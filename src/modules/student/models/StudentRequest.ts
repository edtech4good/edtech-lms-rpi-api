import { ApiProperty } from "@nestjs/swagger";

export class UpdateProfileBody {
    @ApiProperty()
    filename: string = '';
}