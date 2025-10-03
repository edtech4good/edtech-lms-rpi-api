import { ApiExtraModels, ApiProperty } from '@nestjs/swagger';
import { FileMeta } from './filemeta.model';

@ApiExtraModels(FileMeta)
export class QuestionHeading {
  @ApiProperty({ type: FileMeta })
  headingfile?: FileMeta;
  @ApiProperty()
  headingtext: string = '';
}
