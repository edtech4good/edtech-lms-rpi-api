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
    @ApiProperty({ required: false, description: "Optional AnswerV1 payload (src/business/grading) for server-side grading; omitted by old clients." })
    answer?: unknown;
}
export class LevelQuizResultBody {
    @ApiProperty({ type: [LevelQuizResult]})
    result: Array<LevelQuizResult> = [];
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}
