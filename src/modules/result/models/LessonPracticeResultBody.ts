import { ApiProperty } from '@nestjs/swagger';

export class LessonPracticeResult {
    @ApiProperty()
    iscorrect: boolean = false;
    @ApiProperty()
    lessonpracticeid: string = "";
    @ApiProperty()
    lessonpracticequestionid: string = "";
    @ApiProperty()
    questionid: string = "";
    @ApiProperty()
    tries: boolean = false;
}

export class LessonPracticeResultBody {
    @ApiProperty({type: [LessonPracticeResult]})
    result: Array<LessonPracticeResult> = []
    @ApiProperty({ type: Number, example: new Date().getTime() })
    starttime: Date = new Date()
    @ApiProperty({ type: Number, example: new Date().getTime() })
    endtime: Date = new Date()
}
