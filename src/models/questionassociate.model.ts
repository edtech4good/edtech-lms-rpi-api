import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { FileMeta } from './filemeta.model';

@ApiExtraModels(FileMeta)
export class QuestionAssociate {
    @ApiProperty()
    questionoptionid: string = '';
    @ApiProperty({ type: FileMeta })
    questionassociatefile?: FileMeta;
    @ApiProperty()
    questionassociatetext?: string;
}

