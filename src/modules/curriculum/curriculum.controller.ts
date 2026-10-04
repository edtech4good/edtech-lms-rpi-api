import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { OrgPolicy } from "src/decorators/orgPolicy.decorator";
import { ApiBearerAuth, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CurriculumBusiness } from "src/business/curriculum.business";
import { CurriculumBaseLineBusiness } from "src/business/curriculumbaseline.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { ContentAccessGuard } from "src/guards/content-access.guard";
import { ReportScopeGuard, ReportScopeOf } from "src/guards/report-scope.guard";
import { ReportScope } from "src/business/report-scope";
import { AccessOrServerSyncGuard } from "src/guards/access-or-server-sync.guard";
import {
  BusinessValidationInterceptor,
  SchemaValidationInterceptor,
} from "src/interceptors";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { Token } from "src/models/token.model";
import { DeleteCurriculum, DeleteCurriculumBaseline } from "./curriculum.business.validator";
import { showcurriculum, showschoolname } from "./curriculum.request.validator";
import { schoolScopeFromToken } from "src/business/school-identity";
import { callerKindOf } from "src/business/content-access";
import { StudentBusiness } from "src/business/student.business";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { CurriculumBaselineDate } from "./models/CurriculumBaseline";
@ApiTags("Curriculum")
@Controller("curriculum")
@ApiBearerAuth()
export class CurriculumController {
  @Get()
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessGuard(TokenType.ACCESS))
  async getall(@User() user: Token): Promise<any> {
    return {
      data: await new CurriculumBusiness().findallcurriculum(user),
      error: false,
    };
  }

  @Get('all')
  @OrgPolicy("learner", { note: "Learner, school and organisation come from the token; the query can only narrow inside them.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Fetched curriculums successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching curriculums",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiQuery({ name: "cur", required: false, type: 'string' })
  @ApiQuery({ name: "studentid", required: false, type: 'string' })
  @ApiQuery({ name: "standardid", required: false, type: 'string' })
  @ApiQuery({ name: "schoolname", required: false, type: 'string' })
  @ApiQuery({ name: "schoolid", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllCurriculums(
    @Query("cur") cur: string = '',
    @Query("studentid") studentid: string = '',
    @Query("standardid") standardid: string = '',
    @Query("schoolname") schoolname: string = '',
    @Query("schoolid") schoolid: string = '',
    @User() user?: Token,
  ): Promise<any> {
    // The learner, school and organisation are the token's; what the query names can only narrow inside them.
    const data = await new CurriculumBusiness().getCurriculumsWithFilter(cur, studentid, standardid, schoolname, schoolid, user);
    return {
        data: data,
        error: false,
    };
  }

  @Get('subjects')
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Fetched curriculums successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching curriculums",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async getAllCurriculumsWithSubjects(
    @User() user: Token
  ): Promise<any> {
    Logger.info(`<${user.studentfirstname}> get all curriculum-subject`, {logaccesstype: LOGTYPE.GETCURRICULUM, userid: user.schooluserid});
    const data = await new CurriculumBusiness().getCurriculumsWithSubject(user);
    return {
        data: data,
        error: false,
    };
  }

  @Get(":curriculumid")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Curriculum fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching curriculum",
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
  @UseGuards(AccessGuard(TokenType.ACCESS), ContentAccessGuard("curriculum", "curriculumid"))
  @ApiParam({ name: `curriculumid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async get(@Param("curriculumid") curriculumid: string): Promise<any> {
    return {
      data: await new CurriculumBusiness().findcurriculum(curriculumid),
      error: false,
    };
  }
  
  @Get(":curriculumid/map")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Curriculum map fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching curriculum map",
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
  @UseGuards(AccessGuard(TokenType.ACCESS), ContentAccessGuard("curriculum", "curriculumid"))
  @ApiParam({ name: `curriculumid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getmap(
    @Param("curriculumid") curriculumid: string,
    @User() user: Token
  ): Promise<any> {
    return {
      data: await new CurriculumBusiness().findcurriculumgrades(curriculumid, user),
      error: false,
    };
  }

  // @Get(":curriculumid/:studentid/baseline")
  // @ApiResponse({
  //   status: 200,
  //   description: "Curriculum baseline fetch successfully",
  // })
  // @ApiResponse({
  //   status: 400,
  //   description: "Error while fetching curriculum map",
  // })
  // @ApiResponse({
  //   status: 500,
  //   description: "Server error",
  // })
  // @UseInterceptors(
  //   new SchemaValidationInterceptor(showcurriculumbaseline),
  //   new BusinessValidationInterceptor([DeleteCurriculum])
  // )
  // @HttpCode(HttpStatus.OK)
  // @ApiParam({ name: `curriculumid`, type: "string", required: true })
  // @ApiParam({ name: `studentid`, type: "string", required: true })
  // @HttpCode(HttpStatus.OK)
  // async getcurriculumbaseline(
  //   @Param("curriculumid") curriculumid: string,
  //   @Param("studentid") studentid: string,
  //   @User() user: Token
  // ): Promise<any> {
  //   const cbl = new CurriculumBaseLineBusiness();
  //   const baselinebusiness = await cbl.getBaseLine(curriculumid);
  //   let baseline = null;
  //   let baselinepassed = false;
  //   if (baselinebusiness && baselinebusiness.baselineid) {
  //     baseline = baselinebusiness.baselineid;
  //     const passed = await cbl.getStudentBaselineProgress(baseline, studentid);
  //     baselinepassed = (passed[0] as any).passresult > 0;
  //   }
  //   Logger.info(`<${user.schoolusername}> get baseline curriculum`, {logaccesstype: LOGTYPE.GETBASELINE, userid: user.schooluserid});
  //   return {
  //     data: {
  //       baseline,
  //       baselinepassed,
  //     },
  //     error: false,
  //   };
  // }

  @Post("baseline/:curriculumid/:schoolname/:studentid")
  @OrgPolicy("learner", { note: "The school and learner in the path are not read: the token's are.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Curriculum baseline fetch successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching curriculum map",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(showschoolname),
    new BusinessValidationInterceptor([DeleteCurriculumBaseline])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `schoolname`, type: "string", required: true })
  @ApiParam({ name: `studentid`, type: "string", required: true })
  @UseGuards(AccessGuard(TokenType.ACCESS), ContentAccessGuard("curriculum", "curriculumid"))
  @HttpCode(HttpStatus.OK)
  async getCurriculumBaseline(
    @Param("curriculumid") curriculumid: string,
    @Param("schoolname") _schoolname: string,
    @Param("studentid") studentid: string,
    @User() user: Token,
    @Body() body?: CurriculumBaselineDate,
  ): Promise<any> {
    // The learner, the school and the organisation are the token's. The school and learner named in the path are
    // not read (a school named there is never looked up, so it cannot be used to widen the answer): a learner
    // asks about itself; a staff token may name a learner, but only one of its own school.
    const schoolscope = await schoolScopeFromToken(user);
    const schoolid = schoolscope && "schoolid" in schoolscope ? schoolscope.schoolid : null;
    let learnerid: string | undefined = user.studentid;
    if (callerKindOf(user) === "staff") {
      learnerid = schoolscope && (await new StudentBusiness().studentIsInSchool(studentid, schoolscope)) ? studentid : undefined;
    }
    const baseline = await new CurriculumBaseLineBusiness().getCurriculumBaseline(curriculumid,schoolid);
    const data = learnerid
      ? await new CurriculumBaseLineBusiness().GetStudentBaseline(
          curriculumid,learnerid,
          schoolid,
          body && body.date ? parseInt(body.date) : (new Date(new Date().toUTCString())).getTime()
        )
      : undefined;
    let curriculumbaselineid = null;
    let baselinepass = false;
    if(data){
      curriculumbaselineid = baseline?.curriculumbaselineid;
      baselinepass = true;
    }else{
      curriculumbaselineid = baseline?.curriculumbaselineid;
      baselinepass = false;
    }
    Logger.info(`<${user.schoolusername}> get baseline curriculum`, {logaccesstype: LOGTYPE.GETBASELINE, userid: user.schooluserid});
    return {
      data: {
        baselinename: baseline?.baselinename,
        curriculumbaselineid: curriculumbaselineid,
        baselinepass: baselinepass,
      },
      error: false,
    };
  }

  @Get(":curriculumbaselineid/getstudentresult")
  @OrgPolicy("teacher", { note: "Central calls it with the server key; scoped by the organisation header, and by the school for a token.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Student result exported sucesfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while exporting student result",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiParam({ name: `curriculumbaselineid`, type: "string", required: true })
  // Central proxies this route server-to-server (`curriculum/:id/getstudentresult`
  // in curriculumbaseline.controller.ts there) with the sync key — see
  // edtech4good/workspace#45.
  @UseGuards(
    AccessOrServerSyncGuard(
      TokenType.ACCESS,
      SchoolRole.ADMIN,
      SchoolRole.SUPERADMIN,
      SchoolRole.TEACHER
    ),
    ReportScopeGuard
  )
  @HttpCode(HttpStatus.OK)
  async getStudentBaselineEndlineResults(
    @Param("curriculumbaselineid") curriculumbaselineid: string,
    @ReportScopeOf() scope: ReportScope | null,
  ): Promise<any> {
    const studentresults = await new CurriculumBaseLineBusiness().getStudentBaselineEndlineResults(curriculumbaselineid, scope)
    return studentresults;
  }

}
