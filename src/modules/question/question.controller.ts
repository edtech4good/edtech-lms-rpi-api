import {
  Controller,
  Get, HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { QuestionBusiness } from "src/business/question.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { SchemaValidationInterceptor } from "src/interceptors";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { Token } from "src/models/token.model";
import { baselinequestion, lessonpractices, lessonquestions, lessonquizzes, levelquestions } from "./question.request.validator";

@ApiTags("Question")
@Controller("question")
@ApiBearerAuth()
@UseGuards(AccessGuard(TokenType.ACCESS))
export class QuestionController {
  @Get('lesson/:lessonid')
  @ApiResponse({
    status: 200,
    description: 'Lesson Question fetch successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Error while fetching lesson question',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(new SchemaValidationInterceptor(lessonquestions))
  @ApiParam({ name: `lessonid`, type: 'string', required: true })
  @HttpCode(HttpStatus.OK)
  async getlessonquestion(
    @Param('lessonid') lessonid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new QuestionBusiness().getlessonquestions(lessonid, user);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `lesson ${lessonid} not found`
      }, `lesson ${lessonid} not found`);
    }
    return {
      data: question,
      error: false,
    };
  }

  @Get('level/:levelid')
  @ApiResponse({
    status: 200,
    description: 'Level Question fetch successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Error while fetching level question',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(new SchemaValidationInterceptor(levelquestions))
  @ApiParam({ name: `levelid`, type: 'string', required: true })
  @HttpCode(HttpStatus.OK)
  async getlevelquestion(
    @Param('levelid') levelid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new QuestionBusiness().getlevelquestions(levelid);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `level ${levelid} not found`
      }, `level ${levelid} not found`);
    }
    Logger.info(`<${user.schoolusername}> get level quiz <${levelid}>`, {logaccesstype: LOGTYPE.GETLEVELQUIZ, userid: user.schooluserid});
    return {
      data: question,
      error: false,
    };
  }

  @Get('practice/:lessonpracticeid')
  @ApiResponse({
    status: 200,
    description: 'Practice Questions fetch successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Error while fetching practice questions',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(new SchemaValidationInterceptor(lessonpractices))
  @ApiParam({ name: `lessonpracticeid`, type: 'string', required: true })
  @HttpCode(HttpStatus.OK)
  async getpracticequestion(
    @Param('lessonpracticeid') lessonpracticeid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new QuestionBusiness().getpracticequestions(lessonpracticeid);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `lessonpractice ${lessonpracticeid} not found`
      }, `lessonpractice ${lessonpracticeid} not found`);
    }
    Logger.info(`<${user.schoolusername}> get lesson practice <${lessonpracticeid}>`, {logaccesstype: LOGTYPE.GETLESSONPRACTICE, userid: user.schooluserid});
    return {
      data: question,
      error: false,
    };
  }

  @Get('quiz/:lessonquizid')
  @ApiResponse({
    status: 200,
    description: 'Quiz Questions fetch successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Error while fetching quiz questions',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(new SchemaValidationInterceptor(lessonquizzes))
  @ApiParam({ name: `lessonquizid`, type: 'string', required: true })
  @HttpCode(HttpStatus.OK)
  async getquizquestion(
    @Param('lessonquizid') lessonquizid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new QuestionBusiness().getquizquestions(lessonquizid);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `lessonquiz ${lessonquizid} not found`
      }, `lessonquiz ${lessonquizid} not found`);
    }
    Logger.info(`<${user.schoolusername}> get lesson quiz <${lessonquizid}>`, {logaccesstype: LOGTYPE.GETLESSONQUIZ, userid: user.schooluserid});
    return {
      data: question,
      error: false,
    };
  }

  @Get('baseline/:curriculumbaselineid')
  @ApiResponse({
    status: 200,
    description: 'Baseline Questions fetch successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Error while fetching baseline questions',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(new SchemaValidationInterceptor(baselinequestion))
  @ApiParam({ name: `curriculumbaselineid`, type: 'string', required: true })
  @HttpCode(HttpStatus.OK)
  async getbaselinequestion(
    @Param('curriculumbaselineid') curriculumbaselineid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new QuestionBusiness().getbaselinequestions(curriculumbaselineid);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `baselinequestion ${curriculumbaselineid} does't have question yet`
      }, `baselinequestion ${curriculumbaselineid} not found`);
    }
    Logger.info(`<${user.schoolusername}> get baseline question <${curriculumbaselineid}>`, {logaccesstype: LOGTYPE.GETLESSONQUIZ, userid: user.schooluserid});
    return {
      data: question,
      error: false,
    };
  }

  @Get('level/:levelid/answers')
  @ApiResponse({
    status: 200,
    description: 'Level Question fetch successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Error while fetching level question',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(new SchemaValidationInterceptor(levelquestions))
  @ApiParam({ name: `levelid`, type: 'string', required: true })
  @HttpCode(HttpStatus.OK)
  async getlevelquestionanswers(
    @Param('levelid') levelid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new QuestionBusiness().getlevelquestionsanswers(levelid, user);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `No level-quiz result is found`
      }, `level ${levelid} not found`);
    }
    Logger.info(`<${user.schoolusername}> get level quiz <${levelid}> question answers`, {logaccesstype: LOGTYPE.GETLEVELQUIZ, userid: user.schooluserid});
    return {
      data: question,
      error: false,
    };
  }
}
