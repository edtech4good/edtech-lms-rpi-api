import { ApiProperty } from "@nestjs/swagger";
import { FileMeta } from "src/models/filemeta.model";
import { IResponse } from "src/models/IResponse";
import { LessonLearningProgressBase } from "./LessonLearningProgressDto";

export class LessonLearningBase {
    @ApiProperty()
    lessonlearningid: string = '';
    @ApiProperty()
    lessonlearningname: string = '';
    @ApiProperty()
    lessonlearningdescription: string = '';
    @ApiProperty()
    lessonlearningstatus: boolean = true;
    @ApiProperty()
    lessonid: string = '';
    @ApiProperty()
    documentid: string = '';
    @ApiProperty()
    lessonlearningorder?: number;
    @ApiProperty()
    points: number = 0;
    @ApiProperty({ type: LessonLearningProgressBase })
    studentlearningprogress?: LessonLearningProgressBase;
    @ApiProperty({ type: FileMeta })
    lessonlearningfileobject?: FileMeta
}

export class LessonLearningResponse extends IResponse<LessonLearningBase> {
    @ApiProperty({ type: LessonLearningBase })
    data?: LessonLearningBase | null;
  
    constructor() {
      super();
    }
  }