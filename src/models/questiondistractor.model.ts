import { ApiProperty } from '@nestjs/swagger';

export class QuestionDistractor {
    @ApiProperty()
    questiondistractorid: string = '';
    @ApiProperty()
    questiondistractortext: string = '';
}

