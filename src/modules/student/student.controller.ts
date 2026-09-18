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
import { ApiTags, ApiBearerAuth, ApiResponse, ApiQuery } from "@nestjs/swagger";
import { StudentBusiness } from "src/business/student.business";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
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
  @HttpCode(HttpStatus.OK)
  async getAllCurriculums(
    @Query("userid") userid: string = '',
    @Query("schoolname") schoolname: string = '',
  ): Promise<any> {
    const data = await new StudentBusiness().getStudentsWithFilter(userid, schoolname);
    return {
        data: data,
        error: false,
    };
  }

  @Post("profile")
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

  @Post("logintime")
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
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @HttpCode(HttpStatus.OK)
  async getlogintime(
    @Body() body: any,
  ): Promise<any> {
    return {
      data: await new StudentBusiness().getlogintime(body),
      error: false,
    };
  }
}
