import { ApiProperty } from "@nestjs/swagger";
import { IResponse } from "src/models/IResponse";

export class LessonLearningProgressBody {
  @ApiProperty()
  content_length: number = 0;
  @ApiProperty()
  time: number = 0;
  @ApiProperty()
  ended: boolean = false;
  @ApiProperty({ type: Number, example: new Date().getTime() })
  date: Date = new Date()
}

export class LessonLearning {
  @ApiProperty()
  lessonlearningid: string = "";
}

export class LessonLearningProgressBase {
  @ApiProperty()
  studentlearningprogressid: string = "";
  @ApiProperty()
  studentid: string = "";
  @ApiProperty()
  userid?: string = "";
  @ApiProperty()
  lessonlearningid: string = "";
  @ApiProperty()
  progress?: number = 0;
  @ApiProperty()
  progress_percentage?: number = 0;
  @ApiProperty()
  content_length?: number = 0;
  @ApiProperty()
  viewed?: number = 0;
  @ApiProperty()
  lastupdated?: Date = new Date();
}

export class LessonLearningProgressResponse extends IResponse<LessonLearningProgressBase> {
  @ApiProperty({ type: LessonLearningProgressBase })
  data?: LessonLearningProgressBase | null;

  constructor() {
    super();
  }
}

export class LessonLearningProgressAll extends IResponse<
  Array<LessonLearningProgressBase>
> {
  @ApiProperty({ type: [LessonLearningProgressBase] })
  data?: Array<LessonLearningProgressBase>;

  constructor() {
    super();
    this.data = [];
  }
}
