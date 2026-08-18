/* eslint-disable @typescript-eslint/no-explicit-any */
import { forkJoin, from } from "rxjs";
import { curriculumbaseline, lessonpractices, lessonquizzes, levels, studentprogress, studentprogressAttributes, studentprogressquestions, } from "src/models/data-models/init-models";
import { Progress } from "src/models/enums/progress.enum";
import { Token } from "src/models/token.model";
import { v4 as uuidv4 } from 'uuid';
import { LessonBusiness } from "./lesson.business";
import { Transaction, UniqueConstraintError } from "sequelize";
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
            await insertquestion(
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
            await insertquestion(
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
        // starttime is optional on the request (joi.date() without .required());
        // an omitted value must not reach findOrCreate's `where` as undefined
        // (sequelize 6.6.5 throws on that). Normalize once, up front, so every
        // later use of tempprogress.starttime is a real Date. A replay whose
        // starttime was omitted dedupes per-request (new Date() each time) —
        // same as the pre-fix behavior, since there is no natural key to match.
        tempprogress.starttime = tempprogress.starttime ?? new Date();
        const hasTried = await this.hasTried(user, progress?.studentprogressreferenceid);
        // get old points to adjust points
        const oldpoints = await this.getoldpoints(user.studentid, progress?.studentprogressreferenceid, progress.points) ?? null;
        const tnx = await dbinstance.getdbinstance().transaction();
        const lessonbusiness = new LessonBusiness();
        let result: studentprogress;
        let created: boolean;
        try {
            // findOrCreate on the (studentid, studentprogressreferenceid, starttime)
            // natural key so a replayed submission (at-least-once retry queue)
            // returns the existing row instead of creating a duplicate one.
            [result, created] = await studentprogress.findOrCreate({
                where: {
                    studentid: tempprogress.studentid,
                    studentprogressreferenceid: tempprogress.studentprogressreferenceid,
                    starttime: tempprogress.starttime,
                },
                defaults: {
                    ...tempprogress,
                },
                transaction: tnx,
            });
            if (created) {
                await insertquestion(
                    result.studentprogressid,
                    actualanswers,
                    'lessonpracticequestionid',
                    tnx
                );
                if(!hasTried || oldpoints !== null) {
                    await lessonbusiness.updateUserReward(user, lesson.lessonid, progress.points, oldpoints, tnx, tempprogress.starttime)
                }
            }
            await lessonbusiness.setstudentactive(user, progress.studentprogressreferenceid, 2, tnx, tempprogress.starttime);
            await tnx.commit();
        } catch(err: any) {
            await tnx.rollback();
            // A genuinely concurrent replay (two in-flight requests racing
            // on the same submission) can slip past findOrCreate's own
            // retry: our transaction's REPEATABLE READ snapshot is taken
            // on its first read, so the recovery SELECT inside findOrCreate
            // cannot see a sibling row committed by the other request after
            // that point, and it rethrows the raw UniqueConstraintError.
            // The unique index has already done its job (no duplicate row
            // exists) — fetch the winning row with a fresh, untransacted
            // read and treat this exactly like a losing findOrCreate, so
            // the caller still cannot tell a replay from a fresh save.
            if (err instanceof UniqueConstraintError) {
                const existing = await studentprogress.findOne({
                    where: {
                        studentid: tempprogress.studentid,
                        studentprogressreferenceid: tempprogress.studentprogressreferenceid,
                        starttime: tempprogress.starttime,
                    },
                });
                if (existing) {
                    result = existing;
                    created = false;
                } else {
                    throw new BadRequestException({
                        error: true,
                        errormessage: err.message,
                    });
                }
            } else {
                throw new BadRequestException({
                    error: true,
                    errormessage: err?.response?.errormessage || err.message,
                });
            }
        }
        if (created) {
            // Only score a fresh save — a replay must not double-count.
            await lessonbusiness.addstudentscores(user, lesson.lessonid, tempprogress.starttime, 0);
        }
        await lessonbusiness.updateuserdailypoints(lesson.lessonid, user, tempprogress.starttime);
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
        // starttime is optional on the request (joi.date() without .required());
        // an omitted value must not reach findOrCreate's `where` as undefined
        // (sequelize 6.6.5 throws on that). Normalize once, up front, so every
        // later use of tempprogress.starttime is a real Date. A replay whose
        // starttime was omitted dedupes per-request (new Date() each time) —
        // same as the pre-fix behavior, since there is no natural key to match.
        tempprogress.starttime = tempprogress.starttime ?? new Date();
        const hasTried = await this.hasTried(user, progress?.studentprogressreferenceid);
        // get old points to adjust points
        const oldpoints = await this.getoldpoints(user.studentid, progress?.studentprogressreferenceid, progress.points) ?? null;
        const tnx = await dbinstance.getdbinstance().transaction();
        const lessonbusiness = new LessonBusiness();
        let result: studentprogress;
        let created: boolean;
        try {
            // findOrCreate on the (studentid, studentprogressreferenceid, starttime)
            // natural key so a replayed submission (at-least-once retry queue)
            // returns the existing row instead of creating a duplicate one.
            [result, created] = await studentprogress.findOrCreate({
                where: {
                    studentid: tempprogress.studentid,
                    studentprogressreferenceid: tempprogress.studentprogressreferenceid,
                    starttime: tempprogress.starttime,
                },
                defaults: {
                    ...tempprogress,
                },
                transaction: tnx,
            });
            if (created) {
                await insertquestion(
                    result.studentprogressid,
                    actualanswers,
                    'lessonquizquestionid',
                    tnx
                );
                if(!hasTried || oldpoints !== null) {
                    await lessonbusiness.updateUserReward(user, lesson.lessonid, progress.points, oldpoints, tnx, tempprogress.starttime)
                }
            }
            await lessonbusiness.setstudentactive(user, progress.studentprogressreferenceid, 3, tnx, tempprogress.starttime);
            await tnx.commit();
        } catch(err: any) {
            await tnx.rollback();
            // A genuinely concurrent replay (two in-flight requests racing
            // on the same submission) can slip past findOrCreate's own
            // retry: our transaction's REPEATABLE READ snapshot is taken
            // on its first read, so the recovery SELECT inside findOrCreate
            // cannot see a sibling row committed by the other request after
            // that point, and it rethrows the raw UniqueConstraintError.
            // The unique index has already done its job (no duplicate row
            // exists) — fetch the winning row with a fresh, untransacted
            // read and treat this exactly like a losing findOrCreate, so
            // the caller still cannot tell a replay from a fresh save.
            if (err instanceof UniqueConstraintError) {
                const existing = await studentprogress.findOne({
                    where: {
                        studentid: tempprogress.studentid,
                        studentprogressreferenceid: tempprogress.studentprogressreferenceid,
                        starttime: tempprogress.starttime,
                    },
                });
                if (existing) {
                    result = existing;
                    created = false;
                } else {
                    throw new BadRequestException({
                        error: true,
                        errormessage: err.message,
                    });
                }
            } else {
                throw new BadRequestException({
                    error: true,
                    errormessage: err?.response?.errormessage || err.message,
                });
            }
        }
        if (created) {
            // Only score a fresh save — a replay must not double-count
            // (this was the pre-existing replay double-count bug).
            await lessonbusiness.addstudentscores(user, lesson.lessonid, tempprogress.starttime, tempprogress.scores);
        }
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
