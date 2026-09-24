// import { TokenType, Claim as claimenum } from '@armax_cloud/fortyk-entities/build/models/enums';
import { Controller, Get } from '@nestjs/common';
import { ApiExtraModels, ApiTags } from '@nestjs/swagger';
import { IErrorResponse } from './models/IErrorResponse';
import { IResponse } from './models/IResponse';
import { ResponseBoolean } from './models/ResponseBoolean';
import { LessonPracticeResultBody } from './modules/result/models/LessonPracticeResultBody';
import { LessonQuizResultBody } from './modules/result/models/LessonQuizResultBody';
import { LevelQuizResultBody } from './modules/result/models/LevelQuizResultBody';
//import { RegisterResponse } from './modules/auth';
// import { RegisterResponse } from './modules/auth';

// import { Claim } from './decorators/claim.decorator';
// import { AccessGuard } from './guards/access.guard';

@ApiExtraModels(IResponse, ResponseBoolean, IErrorResponse, LessonPracticeResultBody, LessonQuizResultBody, LevelQuizResultBody)
@Controller()
@ApiTags('Basic')
export class AppController {
  // @ApiBearerAuth()
  // @UseGuards(AccessGuard(TokenType.ACCESS))
  // @Claim(claimenum.access, claimenum.activateuser)
  @Get()
  getbase(): string {
    return 'FORTYK API !!!';
  }

  @Get('version')
  getversion(): string {
    return "1.0.0";
  }
}
