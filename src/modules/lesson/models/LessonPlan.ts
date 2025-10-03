import { ApiProperty } from "@nestjs/swagger";
import { FileMeta } from "src/models/filemeta.model";
import { IResponse } from "src/models/IResponse";

export class LessonPlanBase {
    @ApiProperty()
    lessonplanid: string = '';
    @ApiProperty()
    lessonplanname: string = '';
    @ApiProperty()
    lessonplandescription: string = '';
    @ApiProperty()
    lessonplanstatus: boolean = true;
    @ApiProperty()
    lessonid: string = '';
    @ApiProperty()
    documentid: string = '';
    @ApiProperty()
    lessonplanorder?: number;
    @ApiProperty()
    points: number = 0;
    @ApiProperty({ type: FileMeta })
    lessonplanfileobject?: FileMeta
}

export class LessonPlanResponse extends IResponse<LessonPlanBase> {
    @ApiProperty({ type: LessonPlanBase })
    data?: LessonPlanBase | null;
  
    constructor() {
      super();
    }
  }