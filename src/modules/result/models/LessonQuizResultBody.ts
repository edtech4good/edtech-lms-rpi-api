import { ApiProperty } from '@nestjs/swagger';

export class LessonQuizResult {
    @ApiProperty()
    iscorrect: boolean = false;
    @ApiProperty()
    lessonquizid: string = "";
    @ApiProperty()
    lessonquizquestionid: string = "";
    @ApiProperty()
    questionid: string = "";
    @ApiProperty({ required: false, description: "Optional AnswerV1 payload (src/business/grading) for server-side grading; omitted by old clients." })
    answer?: unknown;
}

export class LessonQuizResultBody {
    @ApiProperty({ type: [LessonQuizResult]})
    result: Array<LessonQuizResult> = [];
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}
