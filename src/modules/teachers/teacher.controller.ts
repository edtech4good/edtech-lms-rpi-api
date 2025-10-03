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
import { ApiBearerAuth, ApiBody, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import "multer";
import { StandardBusiness } from "src/business/standard.business";
import { StudentBusiness } from "src/business/student.business";
import { TeacherBusiness } from "src/business/teacher.business";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import {
  BusinessValidationInterceptor,
  SchemaValidationInterceptor,
} from "src/interceptors";
import { TokenType } from "src/models/enums";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { IMultiPaging } from "src/models/IPaging";
import { Token } from "src/models/token.model";
import { TeacherStudent } from "./teacher.business.validator";
import { studentstats } from "./teacher.request.validator";

@ApiTags("Teacher")
@Controller("teacher")
@ApiBearerAuth()
@UseGuards(
  AccessGuard(
    TokenType.ACCESS,
    SchoolRole.ADMIN,
    SchoolRole.SUPERADMIN,
    SchoolRole.TEACHER
  )
)
@ApiResponse({
  status: 400,
  description: "Error in request",
})
@ApiResponse({
  status: 500,
  description: "Server error",
})
export class TeacherController {
  @Get("standards")
  @ApiResponse({
    status: 200,
    description: "Teacher standard fetch successfully",
  })
  @HttpCode(HttpStatus.OK)
  async getallstandards(@User() user: Token): Promise<any> {
    return {
      data: await new TeacherBusiness().getTeacherStandard(
        user.schoolname || ""
      ),
      error: false,
    };
  }

  @Get("stats")
  @ApiResponse({
    status: 200,
    description: "Teacher stats fetch successfully",
  })
  @HttpCode(HttpStatus.OK)
  async getallstats(@User() user: Token): Promise<any> {
    const tb = new TeacherBusiness();
    return {
      data: {
        total: await tb.getTeacherStudentsCount(user.schoolname || ""),
        gendercount: await tb.getTeacherStudentsGenderCount(
          user.schoolname || ""
        ),
      },
      error: false,
    };
  }

  @Get("students")
  @ApiResponse({
    status: 200,
    description: "Teacher students fetch successfully",
  })
  @HttpCode(HttpStatus.OK)
  async getallstudents(@User() user: Token): Promise<any> {
    const tb = new StudentBusiness();
    return {
      data: await tb.getstudentbyschool(user.schoolname || ""),
      error: false,
    };
  }

  @Get("profile")
  @ApiResponse({
    status: 200,
    description: "Teacher profiles fetch successfully",
  })
  @ApiQuery({ name: "standard", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getteacherprofile(
    @User() user: Token,
    @Query("standard") standard: string = '',
  ): Promise<any> {
    const tb = new TeacherBusiness();
    return {
      data: await tb.getTeacherProfile(user, standard),
      error: false,
    };
  }

  @Get("stats/student/:studentid")
  @ApiResponse({
    status: 200,
    description: "Student stats fetch successfully",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(studentstats),
    new BusinessValidationInterceptor([TeacherStudent])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `studentid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getstudentstats(@Param("studentid") studentid: string): Promise<any> {
    const tb = new StudentBusiness();
    return {
      data: (await tb.getstudentstats(studentid))[0],
      error: false,
    };
  }

  @Get("stats/student/:studentid/practice")
  @ApiResponse({
    status: 200,
    description: "Student practice stats fetch successfully",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(studentstats),
    new BusinessValidationInterceptor([TeacherStudent])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `studentid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getstudentpracticestats(
    @Param("studentid") studentid: string
  ): Promise<any> {
    const tb = new StudentBusiness();
    return {
      data: await tb.getstudentpracticestats(studentid),
      error: false,
    };
  }

  @Get("stats/student/:studentid/quiz")
  @ApiResponse({
    status: 200,
    description: "Student quiz stats fetch successfully",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(studentstats),
    new BusinessValidationInterceptor([TeacherStudent])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `studentid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getstudentquizstats(
    @Param("studentid") studentid: string
  ): Promise<any> {
    const tb = new StudentBusiness();
    return {
      data: await tb.getstudentquizstats(studentid),
      error: false,
    };
  }

  @Get("stats/student/:studentid/level")
  @ApiResponse({
    status: 200,
    description: "Student level stats fetch successfully",
  })
  @UseInterceptors(
    new SchemaValidationInterceptor(studentstats),
    new BusinessValidationInterceptor([TeacherStudent])
  )
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `studentid`, type: "string", required: true })
  @HttpCode(HttpStatus.OK)
  async getstudentlevelstats(
    @Param("studentid") studentid: string
  ): Promise<any> {
    const tb = new StudentBusiness();
    return {
      data: await tb.getstudentlevelstats(studentid),
      error: false,
    };
  }

  @Get('standard/all')
  @ApiResponse({
    status: 200,
    description: "Fetched standards successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching standards",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiQuery({ name: "standard", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getAllLessons(
    @Query("standard") standardname: string = '',
    @User() user: Token
  ): Promise<any> {
    const data = await new StandardBusiness().getStandardsWithFilter(user.schoolname ?? '', standardname);
    return {
        data: data,
        error: false,
    };
  }

  @Post('studentprogress')
  @ApiResponse({
    status: 200,
    description: "Fetched students progress successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getStudentsProgress(
    @Body() body: IMultiPaging,
    @User() user: Token
  ): Promise<any> {
    const data = await new TeacherBusiness().getStudentsScoresData(user, body);
    return {
      error: false,
      data: {
        data: data.rows,
        total: data.count,
        pageindex: body?.pageindex || 0,
        pagesize: body?.pagesize || 0,
      },
    };
  }

  @Get('studentinfo')
  @ApiResponse({
    status: 200,
    description: "Fetched standards successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching standards",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseGuards(AccessGuard(TokenType.ACCESS))
  @ApiQuery({ name: "studentid", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getStudentInfo(
    @Query("studentid") studentid: string = '',
  ): Promise<any> {
    const data = await new TeacherBusiness().getStudentLastCompletedQuiz(studentid ?? '', 2);
    return {
        data: data,
        error: false,
    };
  }
}
