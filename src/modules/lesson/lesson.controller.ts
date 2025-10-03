import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiParam, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { LessonBusiness } from "src/business/lesson.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import {
  SchemaValidationInterceptor,
  BusinessValidationInterceptor,
} from "src/interceptors";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { Token } from "src/models/token.model";
import { DeleteLevel } from "../level/level.business.validator";
import { showlevelid } from "../level/level.request.validator";
import { DeleteLesson } from "./lesson.business.validator";
import { lessonidparams } from "./lesson.request.validator";

@ApiTags("Lesson")
@Controller("Lesson")
@ApiBearerAuth()
@UseGuards(AccessGuard(TokenType.ACCESS))
export class LessonController {

  @Get('all')
  @ApiResponse({
    status: 200,
    description: "Fetched lessons successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching lessons",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiQuery({ name: "levelid", required: false, type: 'string' })
  @ApiQuery({ name: "lesson", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllLessons(
    @Query("levelid") levelid: string = '',
    @Query("lesson") lessonname: string = ''
  ): Promise<any> {
    const data = await new LessonBusiness().getLessonsWithFilter(levelid, lessonname);
    return {
        data: data,
        error: false,
    };
  }

  @Get("/level/:levelid")
  @ApiResponse({
    status: 200,
    description: "Lessons fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching lessons",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showlevelid),
    new BusinessValidationInterceptor([DeleteLevel])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `levelid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getlessonbylevelid(
    @Param("levelid") levelid: string,
    @User() user: Token
  ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all lessons <${levelid}>`, {logaccesstype: LOGTYPE.GETLESSONS, userid: user.schooluserid});
    return {
      data: await new LessonBusiness().getlessonsbylevelid(levelid, user),
      error: false,
    };
  }

  @Get("progress/level/:levelid")
  @ApiResponse({
    status: 200,
    description: "Lessons fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching lessons",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showlevelid),
    new BusinessValidationInterceptor([DeleteLevel])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `levelid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getuserlessonsprogress(
    @Param("levelid") levelid: string,
    @User() user: Token
  ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all lessons progress <${levelid}>`, {logaccesstype: LOGTYPE.GETLESSONSPROGRESS, userid: user.schooluserid});
    return {
      data: await new LessonBusiness().getuserlessonsprogress(levelid, user),
      error: false,
    };
  }

  @Get(":lessonid/progress")
  @ApiResponse({
    status: 200,
    description: "User Lesson Progress fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching user lesson progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(lessonidparams),
    new BusinessValidationInterceptor([DeleteLesson])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getuserlessonprogress(
    @Param("lessonid") lessonid: string,
    @User() user: Token
  ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all lessons progress <${lessonid}>`, {logaccesstype: LOGTYPE.GETLESSONSPROGRESS, userid: user.schooluserid});
    return {
      data: await new LessonBusiness().getuserlessonprogress(lessonid, user),
      error: false,
    };
  }
}
