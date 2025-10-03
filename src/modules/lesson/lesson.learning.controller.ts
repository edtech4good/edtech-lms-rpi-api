import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiResponse,
  getSchemaPath,
  ApiParam,
  ApiBody,
  ApiExtraModels,
} from "@nestjs/swagger";
import { LessonBusiness } from "src/business/lesson.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { SchemaValidationInterceptor } from "src/interceptors";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { ResponseBoolean } from "src/models/ResponseBoolean";
import { Token } from "src/models/token.model";
import { lessonquestions } from "../question/question.request.validator";
import { lessonlearningprogress } from "./lesson.request.validator";
import { LessonLearningResponse } from "./models/LessonLearning";
import {
  LessonLearningProgressAll,
  LessonLearningProgressBody,
  LessonLearningProgressResponse,
} from "./models/LessonLearningProgressDto";
import { LessonPlanResponse } from "./models/LessonPlan";

@ApiTags("Lesson")
@Controller("lesson")
@ApiExtraModels(
    LessonLearningProgressResponse,
    LessonLearningProgressAll,
    LessonLearningResponse
)
@ApiBearerAuth()
@UseGuards(AccessGuard(TokenType.ACCESS))
export class LessonLearningController {
  @Post("learning/:lessonlearningid/progress")
  @ApiResponse({
    status: 200,
    description: "Lesson learning progress updated successfully",
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while saving learning progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonlearningid`, type: "string", required: true })
  @ApiBody({ required: true, type: () => LessonLearningProgressBody })
  @UseInterceptors(new SchemaValidationInterceptor(lessonlearningprogress))
  @HttpCode(HttpStatus.OK)
  async savelearningprogress(
    @Param("lessonlearningid") lessonlearningid: string,
    @Body() progress: LessonLearningProgressBody,
    @User() user: Token
  ) {
    await new LessonBusiness().updatelearningprogress(
      lessonlearningid,
      progress,
      user
    );
    Logger.info(`<${user.studentfirstname}> watch a learning video <${lessonlearningid}>`, {logaccesstype: LOGTYPE.POSTLEARNING, userid: user.schooluserid});
    return {
      data: true,
      error: false,
    };
  }

  @Get(":lessonid/learning/progress")
  @ApiResponse({
    status: 200,
    description: "Lesson learning fetched successfully",
    schema: { $ref: getSchemaPath(LessonLearningProgressAll) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while saving lesson quiz result",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonid`, type: "string", required: true })
  async getalllearningprogress(
    @Param("lessonid") lessonid: string,
    @User() user: Token
  ): Promise<LessonLearningProgressAll> {
    const data = await new LessonBusiness().getalllearningprogress(lessonid, user);
    return {
      data: data,
      error: false,
    };
  }

  @Get("learning/:lessonlearningid/progress")
  @ApiResponse({
    status: 200,
    description: "Lesson learning fetched successfully",
    schema: { $ref: getSchemaPath(LessonLearningProgressResponse) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while saving lesson quiz result",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonlearningid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getlearningprogress(
    @Param("lessonlearningid") lessonlearningid: string,
    @User() user: Token
  ): Promise<LessonLearningProgressResponse> {
    const data = await new LessonBusiness().getlearningprogress(lessonlearningid, user);
    return {
      data: data,
      error: false,
    };
  }

  @Get("learning/:lessonlearningid")
  @ApiResponse({
    status: 200,
    description: "Lesson learning fetched successfully",
    schema: { $ref: getSchemaPath(LessonLearningResponse) },
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching lesson learning",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonlearningid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getlearning(
    @Param("lessonlearningid") lessonlearningid: string,
    @User() user: Token
  ): Promise<LessonLearningResponse> {
    const data = await new LessonBusiness().getlearninglesson(lessonlearningid, user);
    Logger.info(`<${user.studentfirstname}> get progress of learning video <${lessonlearningid}>`, {logaccesstype: LOGTYPE.GETLEARNINGPROGRESS, userid: user.schooluserid});
    return {
      data: data,
      error: false,
    };
  }

  @Get(':lessonid/learning')
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
  async getlessonbricks(
    @Param('lessonid') lessonid: string,
    @User() user: Token
  ): Promise<any> {
    const question = await new LessonBusiness().getlessonbricks(lessonid, user);
    if (!question) {
      throw new NotFoundException({
        error: true,
        errormessage: `lesson ${lessonid} not found`
      }, `lesson ${lessonid} not found`);
    }
    Logger.info(`<${user.studentfirstname}> get all learnings by lesson <${lessonid}>`, {logaccesstype: LOGTYPE.GETALLLEARNINGS, userid: user.schooluserid});
    return {
      data: question,
      error: false,
    };
  }

  @Get("plan/:lessonplanid")
  @ApiResponse({
    status: 200,
    description: "Lesson plan fetched successfully",
    schema: { $ref: getSchemaPath(LessonPlanResponse) },
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching lesson plan",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonplanid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getplan(
    @Param("lessonplanid") lessonplanid: string,
    @User() user: Token
  ): Promise<LessonPlanResponse> {
    const data = await new LessonBusiness().getplanlesson(lessonplanid, user);
    Logger.info(`<${user.studentfirstname}> get lesson plan <${lessonplanid}>`, {logaccesstype: LOGTYPE.GETLEARNINGPROGRESS, userid: user.schooluserid});
    return {
      data: data,
      error: false,
    };
  }
}
