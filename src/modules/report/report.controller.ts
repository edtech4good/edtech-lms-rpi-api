import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiResponse, ApiBody, ApiQuery } from "@nestjs/swagger";
import { ReportBusiness } from "src/business/report.business";
import { IMultiPaging } from "src/models/IPaging";

@ApiTags("Report")
@Controller("report")
@ApiBearerAuth()
// @UseGuards(AccessGuard(TokenType.ACCESS))
export class ReportController {
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
  async getStudentsProgress(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentsScoresData(body);
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

  @Post('studentprogress/class')
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
  async getClassProgress(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getClassScoresData(body);
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

  @Post('studentlastcompletedquiz')
  @ApiResponse({
    status: 200,
    description: "Fetched students last completed successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students last completed quiz",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getStudentsLastProgress(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentLastCompletedQuiz(body, false, 2);
    return {
      error: false,
      data: {
        data: data.lastcompletedlessonquiz,
        total: data.count,
        pageindex: body?.pageindex || 0,
        pagesize: body?.pagesize || 0,
      },
    };
  }

  @Post('studentlevelquiz')
  @ApiResponse({
    status: 200,
    description: "Fetched students level quiz successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students level quiz",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getLevelQuiz(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getLevelQuizScoresData(body);
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

  @Post('studentlevelquiz/class')
  @ApiResponse({
    status: 200,
    description: "Fetched students level quiz successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students level quiz",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getClassLevelQuiz(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getClassLevelQuizScoresData(body);
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

  @Post('studentstatus')
  @ApiResponse({
    status: 200,
    description: "Fetched students status successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students status",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getStudentStatus(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentStatus({
      pageindex: body?.pageindex || 0,
      pagesize: body?.pagesize || 0,
      filter: body?.filter || [],
    });
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

  @Post('student-grade-progress')
  @ApiResponse({
    status: 200,
    description: "Fetched student grade progress successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching student grade progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getStudentGradeProgress(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentGradeProgress({
      pageindex: body?.pageindex || 0,
      pagesize: body?.pagesize || 0,
      filter: body?.filter || [],
    });
    return {
      error: false,
      data: {
        data: data.rows,
        total: data.count,
        // student: data.student,
        pageindex: body?.pageindex || 0,
        pagesize: body?.pagesize || 0,
      },
    };
  }

  @Post('student-level-progress')
  @ApiResponse({
    status: 200,
    description: "Fetched student level progress successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching student level progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getStudentLevelProgress(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentLevelProgress({
      pageindex: body?.pageindex || 0,
      pagesize: body?.pagesize || 0,
      filter: body?.filter || [],
    });
    return {
      error: false,
      data: {
        data: data.rows,
        total: data.count,
        student: data.student,
        pageindex: body?.pageindex || 0,
        pagesize: body?.pagesize || 0,
      },
    };
  }

  @Post('student-lesson-progress')
  @ApiResponse({
    status: 200,
    description: "Fetched student lesson progress successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching student lesson progress",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async getStudentLessonProgress(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentLessonProgress({
      pageindex: body?.pageindex || 0,
      pagesize: body?.pagesize || 0,
      filter: body?.filter || [],
    });
    return {
      error: false,
      data: {
        data: data.rows,
        total: data.count,
        student: data.student,
        pageindex: body?.pageindex || 0,
        pagesize: body?.pagesize || 0,
      },
    };
  }

  @Get('offlineonline')
  @ApiResponse({
    status: 200,
    description: "Fetched students offline-online successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error fetching students offline-online",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiQuery({ name: "schoolname", required: false, type: 'string' })
  @ApiQuery({ name: "countryid", required: false, type: 'string' })
  @HttpCode(HttpStatus.OK)
  async getStudentsOfflineOnline(
    @Query("schoolname") schoolname: string = '',
    @Query("countryid") countryid: string = '',
  ): Promise<any> {
    const data = await new ReportBusiness().getStudentsOfflineOnline(schoolname, countryid);
    return {
        data: data,
        error: false,
    };
  }

  @Post('studentprogress/download')
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
  async getStudentsQuizzes(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentsScoresData(body, true);
    return {
      error: false,
      data: data.rows,
    };
  }

  @Post("studentlastcompletedquiz/download")
  @ApiResponse({
    status: 200,
    description: "download current level sucesfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while exporting current level",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @ApiBody({ required: false, type: IMultiPaging })
  @HttpCode(HttpStatus.OK)
  async downloadOfflineCurrentLevel(
    @Body() body: IMultiPaging,
  ) {
    const data = await new ReportBusiness().getStudentLastCompletedQuiz(body, true, 2);
    return {
      error: false,
      data: data.lastcompletedlessonquiz,
    };
  }

  @Post('studentlevelquiz/download')
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
  async getStudentsLevelQuizzes(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getLevelQuizScoresData(body, true);
    return {
      error: false,
      data: data.rows,
    };
  }

  @Post('studentlevelquiz/class/download')
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
  async getClassLevelQuizzes(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getClassLevelQuizScoresData(body, true);
    return {
      error: false,
      data: data.rows,
    };
  }

  @Post('studentstatus/download')
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
  async getStudentsActivity(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getStudentStatus(body, true);
    return {
      error: false,
      data: data.rows,
    };
  }

  @Post('studentprogress/class/download')
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
  async getClassActivity(@Body() body: IMultiPaging): Promise<any> {
    const data = await new ReportBusiness().getClassScoresData(body, true);
    return {
      error: false,
      data: data.rows,
    };
  }
}
