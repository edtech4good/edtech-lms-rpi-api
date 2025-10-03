import { ApiProperty } from '@nestjs/swagger';

export class BaselineQuestionResult {
    @ApiProperty()
    iscorrect: boolean = false;
    @ApiProperty()
    curriculumbaselineid: string = "";
    @ApiProperty()
    baselinequestionid: string = "";
    @ApiProperty()
    questionid: number = 0;
}
export class BaselineQuestionResultBody {
    @ApiProperty({ type: [BaselineQuestionResult]})
    result: Array<BaselineQuestionResult> = [];
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}
