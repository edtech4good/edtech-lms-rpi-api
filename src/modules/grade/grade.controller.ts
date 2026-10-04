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
import { OrgPolicy } from "src/decorators/orgPolicy.decorator";
import { ApiTags, ApiBearerAuth, ApiParam, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { GradeBusiness } from "src/business/grade.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { ContentAccessGuard } from "src/guards/content-access.guard";
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
  @OrgPolicy("learner", { note: "The curriculum, class and school in the query can only narrow inside the token's scope.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
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
  @ApiQuery({ name: "schoolid", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllGrades(
    @Query("grade") gradename: string = '',
    @Query("curid") curid: string = '',
    @Query("standardid") standardid: string = '',
    @Query("schoolname") schoolname: string = '',
    @Query("schoolid") schoolid: string = '',
    @User() user?: Token,
  ): Promise<any> {
    const data = await new GradeBusiness().getGradesWithFilter(gradename, curid, standardid, schoolname, schoolid, user);
    return {
        data: data,
        error: false,
    };
  }
  
  @Get("/curriculum/:curriculumid")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  
  @UseGuards(ContentAccessGuard("curriculum", "curriculumid"))
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
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @UseGuards(ContentAccessGuard("curriculum", "curriculumid"))
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
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @UseGuards(ContentAccessGuard("grade", "gradeid"))
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
