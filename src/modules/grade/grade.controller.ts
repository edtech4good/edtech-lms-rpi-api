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
import { GradeBusiness } from "src/business/grade.business";
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
import { DeleteCurriculum } from "../curriculum/curriculum.business.validator";
import { showcurriculum } from "../curriculum/curriculum.request.validator";
import { DeleteGrade } from "./grade.business.validator";
import { showgradeid } from "./grade.request.validator";

@ApiTags("Grade")
@Controller("grade")
@ApiBearerAuth()
@UseGuards(AccessGuard(TokenType.ACCESS))
export class GradeController {

  @Get('all')
  @ApiResponse({
    status: 200,
    description: "Fetched grades successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching grades",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiQuery({ name: "grade", required: false, type: 'string' })
  @ApiQuery({ name: "curid", required: false, type: 'string' })
  @ApiQuery({ name: "standardid", required: false, type: 'string' })
  @ApiQuery({ name: "schoolname", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllGrades(
    @Query("grade") gradename: string = '',
    @Query("curid") curid: string = '',
    @Query("standardid") standardid: string = '',
    @Query("schoolname") schoolname: string = '',
  ): Promise<any> {
    const data = await new GradeBusiness().getGradesWithFilter(gradename, curid, standardid, schoolname);
    return {
        data: data,
        error: false,
    };
  }
  
  @Get("/curriculum/:curriculumid")
  @ApiResponse({
    status: 200,
    description: "Grades fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching grades",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showcurriculum),
    new BusinessValidationInterceptor([DeleteCurriculum])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `curriculumid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getgradesbycurriculumid(
    @Param("curriculumid") curriculumid: string,
    @User() user: Token
    ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all grades <${curriculumid}>`, {logaccesstype: LOGTYPE.GETGRADES, userid: user.schooluserid});
    return {
      data: await new GradeBusiness().getgradesbycurriculumid(curriculumid, user),
      error: false,
    };
  }

  @Get("progress/curriculum/:curriculumid")
  @ApiResponse({
    status: 200,
    description: "Grades fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching grades",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showcurriculum),
    new BusinessValidationInterceptor([DeleteCurriculum])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `curriculumid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getuesrgradesprogess(
    @Param("curriculumid") curriculumid: string,
    @User() user: Token
    ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all grades progress <${curriculumid}>`, {logaccesstype: LOGTYPE.GETGRADESPROGRESS, userid: user.schooluserid});
    return {
      data: await new GradeBusiness().getusergradesprogess(curriculumid, user),
      error: false,
    };
  }

  @Get("totalgradeprogress/:gradeid")
  @ApiResponse({
    status: 200,
    description: "Fetched student progress successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching student progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showgradeid),
    new BusinessValidationInterceptor([DeleteGrade])
  )
  @ApiParam({ name: `gradeid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async totalgradeprogress(
    @Param("gradeid") gradeid: string,
    @User() user: Token
  ): Promise<any> {
    return {
      data: await new GradeBusiness().gettotalprogressofgrade(user, gradeid),
      error: false,
    };
  }
}
