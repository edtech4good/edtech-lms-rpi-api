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
}

export class LessonQuizResultBody {
    @ApiProperty({ type: [LessonQuizResult]})
    result: Array<LessonQuizResult> = [];
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}
