/* eslint-disable @typescript-eslint/no-explicit-any */
import { forkJoin, from } from "rxjs";
import { curriculumbaseline, lessonpractices, lessonquizzes, levels, studentprogress, studentprogressAttributes, studentprogressquestions, } from "src/models/data-models/init-models";
import { Progress } from "src/models/enums/progress.enum";
import { Token } from "src/models/token.model";
import { v4 as uuidv4 } from 'uuid';
import { LessonBusiness } from "./lesson.business";
import { Transaction } from "sequelize";
import { dbinstance } from "src/services/dbservice";
import { BadRequestException } from "@nestjs/common";

const insertquestion = async (
    studentprogressid: string,
    resultprogressquestions: any,
    referencequestionkey: string,
    transaction: Transaction
) => {
    await forkJoin(
        JSON.parse(resultprogressquestions).map((x: any) => from(
            studentprogressquestions.create({
                ...x,
                studentprogressid,
                studentprogressquestionid: uuidv4(),
                referencequestionid: x[referencequestionkey],
            }, {transaction})
        ))
    ).toPromise();
};
export class ResultBusiness {
    ispass = async (studentid: string, studentprogressreferenceid: string) => {
        const count = await studentprogress.count({
            where: {
                studentid,
                studentprogressreferenceid,
                ispass: true
            }
        });
        return count > 0;
    }

    hasTried = async (user: Token, studentprogressreferenceid: string) => {
        const progress = await studentprogress.findOne({
            where: { studentprogressreferenceid, studentid: user?.studentid }
        });
        return progress
    }

    createlevelquizprogress = async (progress: any, level: levels, user: Token) => {
        const { actualanswers } = progress;
        const tempprogress = { ...progress };
        // tempprogress.endtime = new Date();
        tempprogress.progresstype = Progress.LEVELQUIZ;
        tempprogress.studentprogressid = uuidv4();
        tempprogress.marks = progress.marks;
        tempprogress.points = progress.points;
        tempprogress.fullpoints = progress.fullpoints;
        tempprogress.resultpercentage = progress.passpercentage;
        tempprogress.actualanswers = undefined;
        tempprogress.scores = this.calculatescore(progress.passpercentage);
        const hasTried = await this.hasTried(user, progress?.studentprogressreferenceid);
        // get old points to adjust points
        const oldpoints = await this.getoldpoints(user.studentid, progress?.studentprogressreferenceid, progress.points) ?? null;
        const tnx = await dbinstance.getdbinstance().transaction();
        let result: studentprogress;
        const lessonbusiness = new LessonBusiness();
        try {
            result = await studentprogress.create({
                ...tempprogress,
            }, {transaction: tnx});
            insertquestion(
                result.studentprogressid,
                actualanswers,
                'levelquizquestionid',
                tnx
            );
            if(!hasTried || oldpoints !== null) {
                await lessonbusiness.updateLevelQuizReward(user, level, oldpoints, tnx, tempprogress.starttime)
            }
            await lessonbusiness.setstudentactive(user, progress.studentprogressreferenceid, 4, tnx, tempprogress.starttime);
            await tnx.commit();
        } catch(err: any) {
            await tnx.rollback();
            throw new BadRequestException({
                error: true,
                errormessage: err?.response?.errormessage || err.message,
            });
        }
        await lessonbusiness.addstudentlevelquizscores(user, level, tempprogress.starttime ?? new Date(),  tempprogress.scores);
        await lessonbusiness.updateuserdailypointsBylevelquiz(level.levelid, user, tempprogress.starttime ?? new Date());
        return result;
    };

    createbaselinequestionprogress = async (progress: any, baseline: curriculumbaseline, user: Token) => {
        const { actualanswers } = progress;
        const tempprogress = { ...progress };
        // tempprogress.endtime = new Date();
        tempprogress.progresstype = Progress.BASELINEQUESTION;
        tempprogress.studentprogressid = uuidv4();
        tempprogress.marks = progress.marks;
        tempprogress.points = progress.points;
        tempprogress.fullpoints = progress.fullpoints;
        tempprogress.resultpercentage = progress.passpercentage;
        tempprogress.actualanswers = undefined;
        tempprogress.scores = this.calculatescore(progress.passpercentage);
        const tnx = await dbinstance.getdbinstance().transaction();
        let result: studentprogress;
        const lessonbusiness = new LessonBusiness();
        try {
            result = await studentprogress.create({
                ...tempprogress,
            }, {transaction: tnx});
            insertquestion(
                result.studentprogressid,
                actualanswers,
                'baselinequestionid',
                tnx
            );
            await lessonbusiness.setstudentactive(user, progress.studentprogressreferenceid, 5, tnx, tempprogress.starttime);
            await tnx.commit();
        } catch(err: any) {
            await tnx.rollback();
            throw new BadRequestException({
                error: true,
                errormessage: err?.response?.errormessage || err.message,
            });
        }
        // await lessonbusiness.addstudentlevelquizscores(user, level, tempprogress.starttime ?? new Date(),  tempprogress.scores);
        // await lessonbusiness.updateuserdailypointsBylevelquiz(level.levelid, user, tempprogress.starttime ?? new Date());
        return result;
    };

    createlessonpracticeprogress = async (progress: any, lesson: any, user: Token) => {
        const { actualanswers } = progress;
        const tempprogress: studentprogressAttributes = { ...progress };
        // tempprogress.endtime = new Date();
        tempprogress.progresstype = Progress.LESSONPRACTICE;
        tempprogress.studentprogressid = uuidv4();
        tempprogress.marks = progress.marks;
        tempprogress.points = progress.points;
        tempprogress.fullpoints = progress.fullpoints;
        tempprogress.resultpercentage = progress.passpercentage;
        tempprogress.actualanswers = undefined;
        tempprogress.scores = 0;
        const hasTried = await this.hasTried(user, progress?.studentprogressreferenceid);
        // get old points to adjust points
        const oldpoints = await this.getoldpoints(user.studentid, progress?.studentprogressreferenceid, progress.points) ?? null;
        const tnx = await dbinstance.getdbinstance().transaction();
        const lessonbusiness = new LessonBusiness();
        let result: studentprogress;
        try {
            result = await studentprogress.create({
                ...tempprogress,
            }, {transaction: tnx});
            insertquestion(
                result.studentprogressid,
                actualanswers,
                'lessonpracticequestionid',
                tnx
            );
            if(!hasTried || oldpoints !== null) {
                await lessonbusiness.updateUserReward(user, lesson.lessonid, progress.points, oldpoints, tnx, tempprogress.starttime)
            }
            await lessonbusiness.setstudentactive(user, progress.studentprogressreferenceid, 2, tnx, tempprogress.starttime);
            await tnx.commit();
        } catch(err: any) {
            await tnx.rollback();
            throw new BadRequestException({
                error: true,
                errormessage: err?.response?.errormessage || err.message,
            });
        }
        await lessonbusiness.addstudentscores(user, lesson.lessonid, tempprogress.starttime ?? new Date(), 0);
        await lessonbusiness.updateuserdailypoints(lesson.lessonid, user, tempprogress.starttime ?? new Date());
        return result;
    };
    createlessonquizprogress = async (progress: any, lesson: any, user: Token) => {
        const { actualanswers } = progress;
        const tempprogress = { ...progress };
        // tempprogress.endtime = new Date();
        tempprogress.progresstype = Progress.LESSONQUIZ;
        tempprogress.studentprogressid = uuidv4();
        tempprogress.marks = progress.marks;
        tempprogress.points = progress.points;
        tempprogress.fullpoints = progress.fullpoints;
        tempprogress.resultpercentage = progress.passpercentage;
        tempprogress.actualanswers = undefined;
        tempprogress.scores = this.calculatescore(progress.passpercentage);
        const hasTried = await this.hasTried(user, progress?.studentprogressreferenceid);
        // get old points to adjust points
        const oldpoints = await this.getoldpoints(user.studentid, progress?.studentprogressreferenceid, progress.points) ?? null;
        const tnx = await dbinstance.getdbinstance().transaction();
        const lessonbusiness = new LessonBusiness();
        let result: studentprogress;
        try {
            result = await studentprogress.create({
                ...tempprogress,
            }, {transaction: tnx});
            insertquestion(
                result.studentprogressid,
                actualanswers,
                'lessonquizquestionid',
                tnx
            );
            if(!hasTried || oldpoints !== null) {
                await lessonbusiness.updateUserReward(user, lesson.lessonid, progress.points, oldpoints, tnx, tempprogress.starttime)
            }
            await lessonbusiness.setstudentactive(user, progress.studentprogressreferenceid, 3, tnx, tempprogress.starttime);
            await tnx.commit();
        } catch(err: any) {
            await tnx.rollback();
            throw new BadRequestException({
                error: true,
                errormessage: err?.response?.errormessage || err.message,
            });
        }
        await lessonbusiness.addstudentscores(user, lesson.lessonid, tempprogress.starttime, tempprogress.scores);
        await lessonbusiness.updateuserdailypoints(lesson.lessonid, user, tempprogress.starttime);
        return result;
    }
    
    updateQuizPoints = async (lessonquiz: lessonquizzes, user: Token, transaction: Transaction) => {
        const lesson = await lessonquiz.getLesson();
        const points = lessonquiz.points ?? 0;
        const studentquizprogress = await studentprogress.findOne({
            where: {
                studentid: user.studentid,
                studentprogressreferenceid: lessonquiz.lessonquizid,
                ispass: 1
            }
        });
        if(studentquizprogress){
            studentquizprogress.points = points;
            studentquizprogress.fullpoints = lesson.quizzes_points;
            await studentquizprogress.save({fields: ['points', 'fullpoints'], transaction});
        }
    }
    updatePracticePoints = async (lessonpractice: lessonpractices, user: Token, transaction: Transaction) => {
        const lesson = await lessonpractice.getLesson();
        const points = lessonpractice.points ?? 0;
        const studentpracticeprogress = await studentprogress.findOne({
            where: {
                studentid: user.studentid,
                studentprogressreferenceid: lessonpractice.lessonpracticeid,
                ispass: 1
            }
        });
        if(studentpracticeprogress){
            studentpracticeprogress.points = points;
            studentpracticeprogress.fullpoints = lesson.practices_points;
            await studentpracticeprogress.save({fields: ['points', 'fullpoints'], transaction});
        }
    }
    updateLevelQuizPoints = async (level: levels, user: Token, transaction: Transaction) => {
        const points = level.quiz_points ?? 0;
        const studentlevelquizprogress = await studentprogress.findOne({
            where: {
                studentid: user.studentid,
                studentprogressreferenceid: level.levelid,
                ispass: 1
            }
        });
        if(studentlevelquizprogress){
            studentlevelquizprogress.points = points;
            studentlevelquizprogress.fullpoints = level.points;
            await studentlevelquizprogress.save({fields: ['points', 'fullpoints'], transaction});
        }
    }

    getoldpoints = async (studentid: string | undefined, referenceid: string, newpoints: number) => {
        const lastprogress = await studentprogress.findOne({
            where: { studentid: studentid, studentprogressreferenceid: referenceid },
            order: [['starttime', 'DESC']]
        });
        // if the points is changed
        const oldpoints = lastprogress && (lastprogress?.points !== newpoints) ? lastprogress?.points : null;
        return oldpoints;
    }

    calculatescore = (percentage: number) => {
        if(
            percentage &&
            percentage >= 80 &&
            percentage < 91
        ){
            return 1;
        } else if(
            percentage &&
            percentage >= 91 &&
            percentage < 96
        ) {
            return 2;
        } else if(
            percentage &&
            percentage >= 96
        ) {
            return 3;
        } else {
            return 0;
        }
    }
}
