import {
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
import { Logger, gradingMode, requireGradedAnswers } from "src/config";
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
import { getpracticegradablequestions, scorepractice } from "src/business/practicescore";
import {
  getbaselinegradablequestions,
  getlessonquizgradablequestions,
  getlevelquizgradablequestions,
  scorebaseline,
  scorelessonquiz,
  scorelevelquiz,
} from "src/business/quizscore";
import { gradeSubmissionItems, logGradingDisagreements } from "src/business/gradesubmission";

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
      } catch (err) {
        await tnx.rollback();
        // Rethrow so a DB failure on this result save maps to 503
        // (retried by the client), not a 400 the app treats as bad data.
        throw err;
      }
      await lessonbusiness.updateuserdailypoints(lessonpractice.lessonid, user, result.starttime);
      return {
        data: true,
        error: false,
      };
    }
    const rawdata = (result.result ?? []).map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    // Server-grade each item against the practice's active questions
    // (the server-grading protocol). In shadow mode (default) this only records
    // answer/clientiscorrect/servergrade; `iscorrect` (used below for
    // scoring) stays the client's claim. Practice's pass is never gated by
    // REQUIRE_GRADED_ANSWERS — only quizzes, level quizzes and baseline are.
    const practiceactivequestions = await getpracticegradablequestions(lessonpracticeid);
    const mode = gradingMode();
    const graded = gradeSubmissionItems(rawdata, practiceactivequestions, "lessonpracticequestionid", mode);
    logGradingDisagreements(
      "lesson-practice",
      graded.items,
      practiceactivequestions,
      rawdata.map((x) => x.lessonpracticequestionid),
    );
    const data = graded.items;
    // Shadow mode must score EXACTLY like main did before this protocol
    // shipped: every submitted item goes to the scorer, which does its own
    // active-id filter and "any item correct" dedup, same as always. Only
    // in enforce does a duplicate item become dangerous (a bare or
    // malformed claim riding along with a real, server-graded-wrong
    // answer) — so only enforce restricts scoring to the first submitted
    // item per active question (`scoringItems`). `verified` and the
    // REQUIRE_GRADED_ANSWERS gate are already enforce-only, for the same
    // reason.
    const scoringinput = mode === "enforce" ? graded.scoringItems : data;
    const correct = scoringinput.filter((x) => x.iscorrect === true);
    // const lessonpractice = new LessonBusiness().getlessonpractice(lessonpracticeid);
    // Pass, percentage and marks are scored against this practice's active
    // questions (see practicescore.ts); points still come from calculatePracticeScore.
    const score = await scorepractice(lessonpracticeid, scoringinput);
    const { userpoints, fullpoints, lesson} = await lessonbusiness.calculatePracticeScore(lessonpracticeid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass: score.ispass,
      passpercentage: score.percentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: lessonpracticeid,
      marks: score.marks,
      points: userpoints,
      fullpoints,
      verified: graded.verified,
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
        throw err;
      }
      await lessonbusiness.updateuserdailypoints(lessonquiz.lessonid, user, result.starttime);
      return {
        data: true,
        error: false,
      };
    }
    const rawdata = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    // Server-grade each item against the quiz's active questions
    // (the server-grading protocol). In enforce mode, a gradable server grade
    // replaces the client's `iscorrect` below for both scoring and points.
    const quizactivequestions = await getlessonquizgradablequestions(lessonquizid);
    const mode = gradingMode();
    const graded = gradeSubmissionItems(rawdata, quizactivequestions, "lessonquizquestionid", mode);
    logGradingDisagreements(
      "lesson-quiz",
      graded.items,
      quizactivequestions,
      rawdata.map((x) => x.lessonquizquestionid),
    );
    const data = graded.items;
    // Shadow mode must score EXACTLY like main did before this protocol
    // shipped (see the lesson-practice route above for the full reasoning):
    // only enforce restricts scoring to the first submitted item per active
    // question.
    const scoringinput = mode === "enforce" ? graded.scoringItems : data;
    const correct = scoringinput.filter((x) => x.iscorrect === true);
    // Pass, percentage and marks are scored against this quiz's active
    // questions (see quizscore.ts); points still come from calculateQuizScore.
    const score = await scorelessonquiz(lessonquizid, scoringinput);
    // REQUIRE_GRADED_ANSWERS (default off): an unverified result can never
    // count as a pass once this is on. Old-format results (no `answer` at
    // all) are still accepted and stored — just unverified, never rejected.
    // Only meaningful in enforce mode: `verified` is false by definition in
    // shadow (shadow never scores from the server), so gating on it there
    // would force every shadow-mode result to fail regardless of this flag.
    const ispass = mode === "enforce" && requireGradedAnswers() && !graded.verified ? false : score.ispass;
    const { userpoints, fullpoints, lesson} = await lessonbusiness.calculateQuizScore(lessonquizid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass,
      passpercentage: score.percentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: lessonquizid,
      marks: score.marks,
      points: userpoints,
      fullpoints,
      verified: graded.verified,
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
        throw err;
      }
      await lessonbusiness.updateuserdailypointsBylevelquiz(levelquiz.levelid, user, result.starttime);
      return {
        data: true,
        error: false,
      };
    }
    const rawdata = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    // Server-grade each item against the level quiz's active questions
    // (the server-grading protocol) — same shadow/enforce behaviour as the lesson quiz.
    const levelquizactivequestions = await getlevelquizgradablequestions(levelid);
    const mode = gradingMode();
    const graded = gradeSubmissionItems(rawdata, levelquizactivequestions, "levelquizquestionid", mode);
    logGradingDisagreements(
      "level-quiz",
      graded.items,
      levelquizactivequestions,
      rawdata.map((x) => x.levelquizquestionid),
    );
    const data = graded.items;
    // Shadow mode must score EXACTLY like main did before this protocol
    // shipped (see the lesson-practice route above for the full reasoning):
    // only enforce restricts scoring to the first submitted item per active
    // question.
    const scoringinput = mode === "enforce" ? graded.scoringItems : data;
    const correct = scoringinput.filter((x) => x.iscorrect === true);
    // Pass, percentage and marks are scored against this level quiz's active
    // questions (see quizscore.ts); points still come from calculateLevelQuizScore.
    const score = await scorelevelquiz(levelid, scoringinput);
    // REQUIRE_GRADED_ANSWERS (default off): an unverified result can never
    // count as a pass once this is on. Only meaningful in enforce (see the
    // lesson-quiz route above for why shadow must not be gated on it).
    const ispass = mode === "enforce" && requireGradedAnswers() && !graded.verified ? false : score.ispass;
    const { userpoints, fullpoints, level} = await lessonbusiness.calculateLevelQuizScore(levelid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass,
      passpercentage: score.percentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: levelid,
      marks: score.marks,
      points: userpoints,
      fullpoints,
      verified: graded.verified,
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
    const rawdata = result.result.map((x) => ({
      ...x,
      iscorrect: x.iscorrect || false,
      question: undefined,
    }));
    // Server-grade each item against the baseline's active questions
    // (the server-grading protocol) — same shadow/enforce behaviour as the quizzes.
    const baselineactivequestions = await getbaselinegradablequestions(curriculumbaselineid);
    const mode = gradingMode();
    const graded = gradeSubmissionItems(rawdata, baselineactivequestions, "baselinequestionid", mode);
    logGradingDisagreements(
      "baseline",
      graded.items,
      baselineactivequestions,
      rawdata.map((x) => x.baselinequestionid),
    );
    const data = graded.items;
    // Shadow mode must score EXACTLY like main did before this protocol
    // shipped (see the lesson-practice route above for the full reasoning):
    // only enforce restricts scoring to the first submitted item per active
    // question.
    const scoringinput = mode === "enforce" ? graded.scoringItems : data;
    const correct = scoringinput.filter((x) => x.iscorrect === true);
    // Pass, percentage and marks are scored against this baseline's active,
    // renderable questions (see quizscore.ts); points still come from
    // calculateBaselineQuestionScore (baseline carries no points today).
    const score = await scorebaseline(curriculumbaselineid, scoringinput);
    // REQUIRE_GRADED_ANSWERS (default off): an unverified result can never
    // count as a pass once this is on. Only meaningful in enforce (see the
    // lesson-quiz route above for why shadow must not be gated on it).
    const ispass = mode === "enforce" && requireGradedAnswers() && !graded.verified ? false : score.ispass;
    const { userpoints, fullpoints, baseline} = await curriculumBaselineBusiness.calculateBaselineQuestionScore(curriculumbaselineid, correct);
    const progress = {
      studentid: user.studentid,
      starttime: result.starttime,
      endtime: result.endtime,
      ispass,
      passpercentage: score.percentage,
      actualanswers: JSON.stringify(data),
      studentprogressreferenceid: curriculumbaselineid,
      marks: score.marks,
      points: userpoints,
      fullpoints,
      verified: graded.verified,
    };
    await rb.createbaselinequestionprogress(progress, baseline, user);
    Logger.info(`<${user.studentfirstname}> submits a baseline question <${curriculumbaselineid}>`, {logaccesstype: LOGTYPE.SUBMITLEVELQUIZ, userid: user.schooluserid});
    return {
      data: true,
      error: false,
    };
  }

}
