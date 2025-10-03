import {
  BadRequestException,
  Body,
  Controller, HttpCode,
  HttpStatus, Param,
  Post,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath
} from "@nestjs/swagger";
import { LessonBusiness } from "src/business/lesson.business";
import { ResultBusiness } from "src/business/result.business";
import { Logger } from "src/config";
import { User } from "src/decorators/user.decorator";
import { AccessGuard } from "src/guards/access.guard";
import { SchemaValidationInterceptor } from "src/interceptors";
import { TokenType } from "src/models/enums";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { ResponseBoolean } from "src/models/ResponseBoolean";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { LessonPracticeResultBody } from "./models/LessonPracticeResultBody";
import { LessonQuizResultBody } from "./models/LessonQuizResultBody";
import { LevelQuizResultBody } from "./models/LevelQuizResultBody";
import { resultbaselinequestion, resultlevelquiz, resultpractice, resultquiz } from "./result.request.validator";
import { BaselineQuestionResultBody } from "./models/BaselineQuestionBody";
import { CurriculumBaseLineBusiness } from "src/business/curriculumbaseline.business";

@ApiTags("Result")
@Controller("result")
@ApiBearerAuth()
@UseGuards(AccessGuard(TokenType.ACCESS))
export class ResultController {
  @Post('lesson/practice/:lessonpracticeid')
  @ApiResponse({
    status: 200,
    description: 'Lesson practice result saved successfully',
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: 'Error while saving lesson practice result',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonpracticeid`, type: 'string', required: true })
  @ApiBody({ required: true, type: () => LessonPracticeResultBody })
  @UseInterceptors(new SchemaValidationInterceptor(resultpractice))
  @HttpCode(HttpStatus.OK)
  async savelessonpracticeresult(@Param('lessonpracticeid') lessonpracticeid: string, @Body() result: LessonPracticeResultBody, @User() user: Token): Promise<ResponseBoolean> {
    const rb = new ResultBusiness();
    const lessonbusiness = new LessonBusiness();
    if (await rb.ispass(user.studentid || "", lessonpracticeid)) {
      const lessonpractice = await lessonbusiness.getlessonpractice(lessonpracticeid);
      const oldpoints = await rb.getoldpoints(user.studentid, lessonpractice.lessonpracticeid, lessonpractice.points) ?? null;
      const tnx = await dbinstance.getdbinstance().transaction();
      try {
        await rb.updatePracticePoints(lessonpractice, user, tnx);
        if(oldpoints !== null){
          await lessonbusiness.updateUserReward(user, lessonpractice.lessonid, lessonpractice.points, oldpoints, tnx, result.starttime);
        }
        // set active activity for student
        await lessonbusiness.setstudentactive(user, lessonpractice.lessonpracticeid, 2, tnx, result.starttime);
        await tnx.commit();
      } catch {
        await tnx.rollback();
        throw new BadRequestException({
          error: true,
          errormessage: "Internal Error",
        });
      }
      await lessonbusiness.updateuserdailypoints(lessonpractice.lessonid, user, result.starttime);
      return {
        data: true,
        error: false,
      };
    }
    const data = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    const correct = data.filter((x) => x.iscorrect === true);
    // const lessonpractice = new LessonBusiness().getlessonpractice(lessonpracticeid);
    const passpercentage = correct ? ((correct.length * 100) / data.length).toFixed(2) : 0;
    const { marks, userpoints, fullpoints, lesson} = await lessonbusiness.calculatePracticeScore(lessonpracticeid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass: passpercentage >= 80,
      passpercentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: lessonpracticeid,
      marks,
      points: userpoints,
      fullpoints,
    };
    await rb.createlessonpracticeprogress(progress, lesson, user);
    Logger.info(`<${user.studentfirstname}> submits a practice <${lessonpracticeid}>`, {logaccesstype: LOGTYPE.SUBMITPRACTICE, userid: user.schooluserid});
    return {
      data: true,
      error: false,
    };
  }

  @Post('lesson/quiz/:lessonquizid')
  @ApiResponse({
    status: 200,
    description: 'Lesson quiz Result saved successfully',
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: 'Error while saving lesson quiz result',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `lessonquizid`, type: 'string', required: true })
  @ApiBody({ required: true, type: () => LessonQuizResultBody })
  @UseInterceptors(new SchemaValidationInterceptor(resultquiz))
  @HttpCode(HttpStatus.OK)
  async savelessonquizresult(@Param('lessonquizid') lessonquizid: string, @Body() result: LessonQuizResultBody, @User() user: Token): Promise<ResponseBoolean> {
    const rb = new ResultBusiness();
    const lessonbusiness = new LessonBusiness();
    if (await rb.ispass(user.studentid || "", lessonquizid)) {
      const lessonquiz = await lessonbusiness.getlessonquiz(lessonquizid);
      const oldpoints = await rb.getoldpoints(user.studentid, lessonquiz.lessonquizid, lessonquiz.points) ?? null;
      const tnx = await dbinstance.getdbinstance().transaction();
      try {
        await rb.updateQuizPoints(lessonquiz, user, tnx);
        if(oldpoints !== null){
          await lessonbusiness.updateUserReward(user, lessonquiz.lessonid, lessonquiz.points, oldpoints, tnx, result.starttime);
        }
        // set active activity for student
        await lessonbusiness.setstudentactive(user, lessonquiz.lessonquizid, 3, tnx, result.starttime);
        await tnx.commit();
      } catch(err: any) {
        await tnx.rollback();
        throw new BadRequestException({
          error: true,
          errormessage: err?.response?.errormessage || err.message,
        });
      }
      await lessonbusiness.updateuserdailypoints(lessonquiz.lessonid, user, result.starttime);
      return {
        data: true,
        error: false,
      };
    }
    const data = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    const correct = data.filter((x) => x.iscorrect === true);
    const passpercentage = correct ? ((correct.length * 100) / data.length).toFixed(2) : 0;
    const { marks, userpoints, fullpoints, lesson} = await lessonbusiness.calculateQuizScore(lessonquizid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass: passpercentage >= 80,
      passpercentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: lessonquizid,
      marks,
      points: userpoints,
      fullpoints,
    };
    await rb.createlessonquizprogress(progress, lesson, user);
    Logger.info(`<${user.studentfirstname}> submits a quiz <${lessonquizid}>`, {logaccesstype: LOGTYPE.SUBMITQUIZ, userid: user.schooluserid});
    return {
      data: true,
      error: false,
    };
  }

  @Post('level/quiz/:levelid')
  @ApiResponse({
    status: 200,
    description: 'Level quiz Result saved successfully',
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: 'Error while saving level quiz result',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `levelid`, type: 'string', required: true })
  @ApiBody({ required: true, type: () => LevelQuizResultBody })
  @UseInterceptors(new SchemaValidationInterceptor(resultlevelquiz))
  @HttpCode(HttpStatus.OK)
  async savelevelquizresult(@Param('levelid') levelid: string, @Body() result: LevelQuizResultBody, @User() user: Token): Promise<ResponseBoolean> {
    const rb = new ResultBusiness();
    const lessonbusiness = new LessonBusiness();
    if (await rb.ispass(user.studentid || "", levelid)) {
      const levelquiz = await lessonbusiness.getlevelquiz(levelid);
      const oldpoints = await rb.getoldpoints(user.studentid, levelquiz.levelid, levelquiz.quiz_points) ?? null;
      const tnx = await dbinstance.getdbinstance().transaction();
      try {
        await rb.updateLevelQuizPoints(levelquiz, user, tnx);
        if(oldpoints !== null){
          await lessonbusiness.updateLevelQuizReward(user, levelquiz, oldpoints, tnx, result.starttime);
        }
        // set active activity for student
        await lessonbusiness.setstudentactive(user, levelquiz.levelid, 4, tnx, result.starttime);
        await tnx.commit();
      } catch(err: any) {
        await tnx.rollback();
        throw new BadRequestException({
          error: true,
          errormessage: err?.response?.errormessage || err.message,
        });
      }
      await lessonbusiness.updateuserdailypointsBylevelquiz(levelquiz.levelid, user, result.starttime);
      return {
        data: true,
        error: false,
      };
    }
    const data = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    const correct = data.filter((x) => x.iscorrect === true);
    const passpercentage = correct ? ((correct.length * 100) / data.length).toFixed(2) : 0;
    const { marks, userpoints, fullpoints, level} = await lessonbusiness.calculateLevelQuizScore(levelid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass: passpercentage >= 80,
      passpercentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: levelid,
      marks,
      points: userpoints,
      fullpoints,
    };
    await rb.createlevelquizprogress(progress, level, user);
    Logger.info(`<${user.studentfirstname}> submits a level quiz <${levelid}>`, {logaccesstype: LOGTYPE.SUBMITLEVELQUIZ, userid: user.schooluserid});
    return {
      data: true,
      error: false,
    };
  }

  @Post('baseline/question/:curriculumbaselineid')
  @ApiResponse({
    status: 200,
    description: 'Level quiz Result saved successfully',
    schema: { $ref: getSchemaPath(ResponseBoolean) },
  })
  @ApiResponse({
    status: 400,
    description: 'Error while saving level quiz result',
  })
  @ApiResponse({
    status: 500,
    description: 'Server error',
  })
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: `curriculumbaselineid`, type: 'string', required: true })
  @ApiBody({ required: true, type: () => BaselineQuestionResultBody })
  @UseInterceptors(new SchemaValidationInterceptor(resultbaselinequestion))
  @HttpCode(HttpStatus.OK)
  async savebaselineresult(
    @Param('curriculumbaselineid') curriculumbaselineid: string, 
    @Body() result: BaselineQuestionResultBody, 
    @User() user: Token
    ): Promise<ResponseBoolean> {
    const rb = new ResultBusiness();
    const curriculumBaselineBusiness = new CurriculumBaseLineBusiness();
    const data = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    const correct = data.filter((x) => x.iscorrect === true);
    const passpercentage = correct ? ((correct.length * 100) / data.length).toFixed(2) : 0;
    const { marks, userpoints, fullpoints, baseline} = await curriculumBaselineBusiness.calculateBaselineQuestionScore(curriculumbaselineid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass: passpercentage >= 80,
      passpercentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: curriculumbaselineid,
      marks,
      points: userpoints,
      fullpoints,
    };
    await rb.createbaselinequestionprogress(progress, baseline, user);
    Logger.info(`<${user.studentfirstname}> submits a baseline question <${curriculumbaselineid}>`, {logaccesstype: LOGTYPE.SUBMITLEVELQUIZ, userid: user.schooluserid});
    return {
      data: true,
      error: false,
    };
  }

}
