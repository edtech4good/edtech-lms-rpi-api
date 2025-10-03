import { ApiProperty } from "@nestjs/swagger";
import { IResponse } from "src/models/IResponse";

export class LessonPlanProgressBody {
  @ApiProperty()
  content_length: number = 0;
  @ApiProperty()
  time: number = 0;
  @ApiProperty()
  ended: boolean = false;
  @ApiProperty({ type: Number, example: new Date().getTime() })
  date: Date = new Date()
}

export class LessonPlan {
  @ApiProperty()
  lessonplanid: string = "";
}

export class LessonPlanProgressBase {
  @ApiProperty()
  studentplanprogressid: string = "";
  @ApiProperty()
  studentid: string = "";
  @ApiProperty()
  userid?: string = "";
  @ApiProperty()
  lessonplanid: string = "";
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

export class LessonPlanProgressResponse extends IResponse<LessonPlanProgressBase> {
  @ApiProperty({ type: LessonPlanProgressBase })
  data?: LessonPlanProgressBase | null;

  constructor() {
    super();
  }
}

export class LessonPlanProgressAll extends IResponse<
  Array<LessonPlanProgressBase>
> {
  @ApiProperty({ type: [LessonPlanProgressBase] })
  data?: Array<LessonPlanProgressBase>;

  constructor() {
    super();
    this.data = [];
  }
}
