import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { FileMeta } from './filemeta.model';
import { QuestionAssociate } from './questionassociate.model';

@ApiExtraModels(FileMeta)
@ApiExtraModels(QuestionAssociate)
export class QuestionOption {
    @ApiProperty()
    questionoptionid: string = '';
    @ApiProperty({ type: FileMeta })
    questionoptionfile?: FileMeta;
    @ApiProperty()
    questionoptiontext?: string;
    @ApiProperty()
    questionoptioniscorrect?: boolean;
    @ApiProperty()
    questionoptionsequence?: number;
    @ApiProperty({ type: QuestionAssociate })
    questionassociate?: QuestionAssociate;
    @ApiProperty()
    questionoptionisstaticfile?: boolean;
    @ApiProperty()
    questionoptionvalue?: number;
    @ApiProperty()
    questionoptionnumeratorvalue?: string;
    @ApiProperty()
    questionoptionnumeratorisstatic?: boolean;
    @ApiProperty()
    questionoptiondenominatorvalue?: string;
    @ApiProperty()
    questionoptiondenominatorisstatic?: boolean;
    @ApiProperty()
    questionoptionisfraction?: boolean;
    @ApiProperty()
    questionoptionistext?: boolean;
}