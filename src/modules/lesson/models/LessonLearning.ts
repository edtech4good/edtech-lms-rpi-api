import { ApiProperty } from "@nestjs/swagger";
import { FileMeta } from "src/models/filemeta.model";
import { IResponse } from "src/models/IResponse";
import { LessonLearningProgressBase } from "./LessonLearningProgressDto";

/** A document a learning item uses besides its primary one: its link row's role and order, and its file object. */
export class LessonLearningDocumentBase {
    @ApiProperty()
    documentid: string = '';
    @ApiProperty()
    lessonlearningdocumentrole: string = '';
    @ApiProperty()
    lessonlearningdocumentorder: number = 0;
    @ApiProperty({ type: FileMeta })
    lessonlearningfileobject?: FileMeta
}

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
    @ApiProperty({ nullable: true, type: String })
    documentid: string | null = null;
    @ApiProperty()
    lessonlearningorder?: number;
    @ApiProperty()
    points: number = 0;
    @ApiProperty({ description: "The kind of item. Phase 0 knows only 'video'." })
    lessonlearningtype: string = 'video';
    @ApiProperty({ nullable: true, type: Object, description: "The type's own JSON body; null for 'video'." })
    lessonlearningbody?: object | null;
    @ApiProperty({ type: [LessonLearningDocumentBase], description: "The documents this item uses besides its primary one (empty in phase 0)." })
    documents?: LessonLearningDocumentBase[];
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
