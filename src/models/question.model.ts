import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { FileMeta } from './filemeta.model';
import { QuestionDistractor } from './questiondistractor.model';
import { QuestionHeading } from './questionheading.model';
import { QuestionOption } from './questionoption.model';

@ApiExtraModels(FileMeta)
@ApiExtraModels(QuestionOption)
@ApiExtraModels(QuestionHeading)
@ApiExtraModels(QuestionDistractor)
export class Question {
    @ApiProperty()
    questionid: string = '';
    @ApiProperty()
    questionidentifier: string = '';
    @ApiProperty({ type: QuestionHeading })
    questionheading?: QuestionHeading;
    @ApiProperty({ type: QuestionOption })
    questionoptions: Array<QuestionOption> = [];
    @ApiProperty()
    questiontext?: string; // null for 8
    @ApiProperty({ type: QuestionDistractor })
    questiondistractors?: Array<QuestionDistractor>; // only for 8
    @ApiProperty({ type: FileMeta })
    questionfile?: FileMeta; // only for 1 2 3
    @ApiProperty()
    templatetypeid: number = 0;
    @ApiProperty()
    isdeleted: boolean = false;
    @ApiProperty()
    questionstatus: boolean = true;
    @ApiProperty()
    questiontags: Array<string> = [];
    @ApiProperty()
    questioncorrectvalue?: number = 0;
}

