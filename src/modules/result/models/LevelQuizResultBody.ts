import { ApiProperty } from '@nestjs/swagger';

export class LevelQuizResult {
    @ApiProperty()
    iscorrect: boolean = false;
    @ApiProperty()
    levelid: string = "";
    @ApiProperty()
    levelquizquestionid: string = "";
    @ApiProperty()
    questionid: number = 0;
}
export class LevelQuizResultBody {
    @ApiProperty({ type: [LevelQuizResult]})
    result: Array<LevelQuizResult> = [];
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}
