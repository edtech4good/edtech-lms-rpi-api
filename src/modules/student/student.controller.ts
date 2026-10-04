import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { OrgPolicy } from "src/decorators/orgPolicy.decorator";
import { ApiTags, ApiBearerAuth, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { ReportScope } from "src/business/report-scope";
import { schoolScopeFromToken } from "src/business/school-identity";
import { StudentBusiness } from "src/business/student.business";
import { ReportScopeGuard, ReportScopeOf } from "src/guards/report-scope.guard";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { AccessOrServerSyncGuard } from "src/guards/access-or-server-sync.guard";
import {
  SchemaValidationInterceptor,
  BusinessValidationInterceptor,
} from "src/interceptors";
import { TokenType } from "src/models/enums";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { Token } from "src/models/token.model";
import { UpdateProfileBody } from "./models/StudentRequest";
import { StudentExist } from "./student.business.validator";
import { studentprofile } from "./student.request.validator";

@ApiTags("Student")
@Controller("student")
@ApiBearerAuth()
export class StudentController {

  // Admins/superadmins only — a Teacher may not read other learners' PII on
  // the rpi either (matches the central API's 16 Jul PILOT.md decision).
  // A class-level guard would also cover this route and run passport twice
  // (controller guard + method guard, same jwt-access strategy) for no
  // benefit, since no other route here needs a role restriction — so each
  // route below carries its own single guard instead of one at class level.
  @Get('all')
  @OrgPolicy("teacher", { note: "The learners are the token's school's; a school in the query can only narrow that.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Fetched students successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(
    AccessGuard(
      TokenType.ACCESS,
      SchoolRole.ADMIN,
      SchoolRole.SUPERADMIN
    )
  )
  @ApiQuery({ name: "userid", required: false, type: 'string' })
  @ApiQuery({ name: "schoolname", required: false, type: 'string' })
  @ApiQuery({ name: "schoolid", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllCurriculums(
    @Query("userid") userid: string = '',
    @Query("schoolname") schoolname: string = '',
    @Query("schoolid") schoolid: string = '',
    @User() user?: Token,
  ): Promise<any> {
    // The learners are the token's school's; a school named in the query can only narrow that.
    const data = await new StudentBusiness().getStudentsWithFilter(userid, schoolname, schoolid, await schoolScopeFromToken(user));
    return {
        data: data,
        error: false,
    };
  }

  @Post("profile")
  @OrgPolicy("learner", { note: "Updates only the token's own learner record.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Profile update successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while updating profile",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @UseInterceptors(
    new SchemaValidationInterceptor(studentprofile),
    new BusinessValidationInterceptor([StudentExist])
  )
  @HttpCode(HttpStatus.OK)
  async updatestudentprofile(
    @Body() body: UpdateProfileBody,
    @User() user: Token
  ): Promise<any> {
    return {
      data: await new StudentBusiness().updateProfile(body.filename, user),
      error: false,
    };
  }

  @Get("progress")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
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
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async getStudentProgress(
    @User() user: Token
  ): Promise<any> {
    return {
      data: await new StudentBusiness().getprogress(user),
      error: false,
    };
  }

  @Get("progress/summary")
  @OrgPolicy("learner", { enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "Fetched student progress summary successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching student progress summary",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async getStudentProgressSummary(
    @User() user: Token
  ): Promise<any> {
    return {
      data: await new StudentBusiness().getprogresssummary(user),
      error: false,
    };
  }

  @Post("logintime")
  @OrgPolicy("learner", { note: "Central calls it with the server key; a learner token gets its own login only.", enforcedBy: "src/modules/org-boundary.leak.spec.ts" })
  @ApiResponse({
    status: 200,
    description: "get student last login successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while fetching last login",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  // Central proxies this route server-to-server (`student.business.ts`'s
  // getStudentLoginTime call there) with the sync key — see
  // edtech4good/workspace#45.
  @UseGuards(AccessOrServerSyncGuard(TokenType.ACCESS), ReportScopeGuard)
  @HttpCode(HttpStatus.OK)
  async getlogintime(
    @Body() body: any,
    @ReportScopeOf() scope: ReportScope | null,
  ): Promise<any> {
    return {
      data: await new StudentBusiness().getlogintime(body, scope),
      error: false,
    };
  }
}
