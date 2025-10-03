import { BadRequestException } from "@nestjs/common";
import { isAfter } from "date-fns";
import { maxBy, minBy } from "lodash";
import { col, fn, Op, WhereOptions } from "sequelize";
import { countries } from "src/models/data-models/countries";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { lessons } from "src/models/data-models/lessons";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { levels } from "src/models/data-models/levels";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { standards } from "src/models/data-models/standards";
import { studentappusages } from "src/models/data-models/studentappusage";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentprogress } from "src/models/data-models/studentprogress";
import { students, studentsAttributes } from "src/models/data-models/students";
import { Default_Test_Student_ID } from "src/models/enums/user.enum";
import { IMultiPaging } from "src/models/IPaging";
import { buildCustomWhere } from "src/services/util.service";

export interface ChartItemFormat {
    name: Date | string;
    value: number;
}

export interface LineChartFormat {
    name: string;
    series: Array<ChartItemFormat>;
}

export class ReportBusiness {

    getStudentsScoresData = async (
        paging: IMultiPaging,
        download: boolean = false
    ) => {
        // const limit = paging.pagesize || 20;
        // let offset = 0;
        // if ((paging.pageindex || 1) > 1) {
        //     offset = limit * ((paging.pageindex || 1) - 1);
        // }
        const where: any = {};
        const lessonwhere: any = {lessonstatus: true, isdeleted: false};
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'curriculumid', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'gradeid', fields: '$level.grade.gradeid$', where: lessonwhere});
        buildCustomWhere(paging.filter ?? [], {key: 'levelid', fields: '$level.levelid$', where: lessonwhere});
        buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'lessonid', where: lessonwhere});
        let student: students | null = null;
        if(!where.standard && !where.studentid) {
            student = await students.findOne({
                where: { studentid: Default_Test_Student_ID },
                include: [
                    {
                        model: schoolusers,
                        as: 'schooluser',
                        required: true,
                        attributes: ['schoolusername']
                    }
                ]
            });
            if(!student) return { rows: [], count: 0};
            where.standard = student.standard;
            where.studentid = student.studentid;
        } else if(!where.studentid) {
            student = await students.findOne({
                where: { standard: where.standard },
                include: [
                    {
                        model: schoolusers,
                        as: 'schooluser',
                        required: true,
                        attributes: ['schoolusername']
                    }
                ]
            });
            if(student) where.studentid = student.studentid;
        } else if (where.studentid) {
            student = await students.findOne({
                where: { studentid: where.studentid },
                include: [
                    {
                        model: schoolusers,
                        as: 'schooluser',
                        required: true,
                        attributes: ['schoolusername']
                    }
                ]
            });
        }
        if(!student) return { rows: [], count: 0};
        const curwhere: any = {};
        if(student?.curriculumid) curwhere.curriculumid = student?.curriculumid;
        const options: any = { where: lessonwhere };
        // if(!download) {
        //     options.limit = limit;
        //     options.offset = offset;
        // }
        const alllessons = await lessons.findAndCountAll({
            ...options,
            include: [
                {
                    model: studentlessonsprogress,
                    required: false,
                    where: { studentid: where.studentid },
                    attributes: ['lessonid'],
                },
                {
                    model: levels,
                    as: 'level',
                    required: true,
                    attributes: ['levelname'],
                    include: [
                        {
                            model: grades,
                            as: 'grade',
                            required: true,
                            attributes: ['gradename'],
                            include: [
                                {
                                    model: curriculums,
                                    as: 'curriculum',
                                    required: true,
                                    where: { curriculumid: (where.curriculumid ? where.curriculumid : student?.curriculumid) },
                                    attributes: ['curriculumname']
                                }
                            ]
                        },
                    ]
                }
            ]
        }).then((async lss => {
            for await (const ls of lss.rows) {
                const stdlessonpg = (ls as any).studentlessonsprogresses as studentlessonsprogress[];
                if(stdlessonpg.length > 0) {
                    const studentlessonprogress = stdlessonpg[0];
                    let quiz = await studentprogress.findOne({
                        order: [['starttime', 'ASC']],
                        where: {
                            studentid: student?.studentid,
                            ispass: 1
                        },
                        attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass', 'starttime'],
                        include: [
                            {
                                model: lessonquizzes,
                                required: true,
                                attributes: [],
                                where: { lessonid: studentlessonprogress.lessonid }
                            },
                        ]
                    });
                    if(!quiz) {
                        quiz = await studentprogress.findOne({
                            order: [['starttime', 'DESC']],
                            where: {
                                studentid: student?.studentid,
                                ispass: 0
                            },
                            attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass', 'starttime'],
                            include: [
                                {
                                    model: lessonquizzes,
                                    required: true,
                                    attributes: [],
                                    where: { lessonid: studentlessonprogress.lessonid }
                                },
                            ]
                        });
                    }
                    if(quiz) {
                        const totalquestions = await lessonquizquestions.count({
                            where: { lessonquizid: quiz.studentprogressreferenceid }
                        });
                        quiz.setDataValue('totalquestions', totalquestions);
                        ls.setDataValue('laststudentprogress', quiz);
                        ls.setDataValue('starttime', quiz.starttime);
                    }
                }
                const level = await levels.findOne({
                    where: { levelid: ls.levelid },
                    attributes: ['levelname'],
                    include: [
                        {
                            model: grades,
                            as: 'grade',
                            required: true,
                            attributes: ['gradename'],
                            include: [
                                {
                                    model: curriculums,
                                    as: 'curriculum',
                                    required: true,
                                    attributes: ['curriculumname']
                                }
                            ]
                        }
                    ]
                })
                if(level) ls.setDataValue('level', level);
                const standard = await standards.findOne({
                    where: { standardid: student?.standard },
                    attributes: ['standardname']
                });
                const schoolcountry = await schools.findOne({
                    where: { schoolname: student?.schoolname },
                    attributes: ['schoolname'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                });
                if(schoolcountry) student?.setDataValue('school', schoolcountry);
                if(standard) student?.setDataValue('class', standard);
                ls.setDataValue('student', student ?? undefined);
            }
            for (let i = 1; i < lss.rows.length; i++) {
                const starttime = lss.rows[i].getDataValue('starttime') ?? 0;
                for (let j = 0; j < i; j++) {
                    const starttimeloop = lss.rows[j].getDataValue('starttime') ?? 0;
                    if (isAfter(starttime, starttimeloop)) {
                        const x = lss.rows[i];
                        lss.rows[i] = lss.rows[j];
                        lss.rows[j] = x;
                    }
                }
            }
            return lss;
        }));
        return alllessons;
    };

    getClassScoresData = async (
        paging: IMultiPaging,
        download: boolean = false
    ) => {
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        const where: any = {
            is_teacher_acc: false
        };
        const lessonwhere: any = {};
        buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'lessonid', where: lessonwhere});
        // buildCustomWhere(paging.filter ?? [], {fields: 'gradeid', where: lessonwhere});
        // buildCustomWhere(paging.filter ?? [], {fields: 'levelid', where: lessonwhere});
        let student: students | null = null;
        if(!where.standard && !where.studentid) {
            student = await students.findOne({
                where: { studentid: Default_Test_Student_ID }
            });
            if(!student) throw new BadRequestException('school has no student!');
            where.standard = student?.standard;
            // where.studentid = student.studentid;
        } else if(!where.studentid) {
            student = await students.findOne({
                where: { standard: where.standard }
            });
            if(student) where.standard = student?.standard;
        } else if (where.studentid) {
            student = await students.findOne({
                where: { studentid: where.studentid }
            });
            if(student) where.standard = student?.standard;
        }
        if(!student) return { rows: [], count: 0};
        // find a lesson to show
        if(!lessonwhere.lessonid && student?.curriculumid) {
            const curriculum = await curriculums.findOne({
                where: { curriculumid: student?.curriculumid, curriculumstatus: true, isdeleted: false },
                attributes: ['curriculumid', 'curriculumname'],
                include: [
                    {
                        model: grades,
                        as: 'grades',
                        required: true,
                        where: { gradestatus: true, isdeleted: false },
                        attributes: ['gradename', 'gradeorder'],
                        include: [
                            {
                                model: levels,
                                as: 'levels',
                                required: true,
                                where: { levelstatus: true, isdeleted: false },
                                attributes: ['levelid', 'levelname', 'levelorder'],
                                include: [
                                    {
                                        model: lessons,
                                        as: 'lessons',
                                        required: true,
                                        where: { lessonstatus: true, isdeleted: false },
                                        attributes: ['lessonid', 'lessonorder'],
                                    },
                                ]
                            },
                        ]
                    },
                ]
            });
            const bestgrade = minBy(curriculum?.grades, 'gradeorder');
            const bestlevel = minBy(bestgrade?.levels, 'levelorder');
            const bestlesson = minBy(bestlevel?.lessons, 'lessonorder');
            lessonwhere.lessonid = bestlesson?.lessonid;
        }
        const lesson = await lessons.findOne({
            attributes: ['lessonname'],
            where: {lessonid: lessonwhere.lessonid, lessonstatus: true, isdeleted: false},
            include: [
                {
                    model: levels,
                    as: 'level',
                    required: true,
                    where: {levelstatus: true, isdeleted: false},
                    attributes: ['levelname'],
                    include: [
                        {
                            model: grades,
                            as: 'grade',
                            required: true,
                            where: {gradestatus: true, isdeleted: false},
                            attributes: ['gradename'],
                            include: [
                                {
                                    model: curriculums,
                                    as: 'curriculum',
                                    required: true,
                                    where: { curriculumstatus: true, isdeleted: false},
                                    attributes: ['curriculumname']
                                }
                            ]
                        }
                    ]
                },
                
            ]
        });
        // lessonwhere.curriculumid = student?.curriculumid;
        const options: any = { where };
        if(!download) {
            options.limit = limit;
            options.offset = offset;
        }
        const alllessons = await students.findAndCountAll({
            ...options,
            include: [
                {
                    model: studentlessonsprogress,
                    required: false,
                    where: lessonwhere,
                    attributes: ['lessonid'],
                },
            ],
        }).then((async stds => {
            for await (const std of stds.rows) {
                const stdlessonpg = (std as any).studentlessonsprogresses as studentlessonsprogress[];
                if(stdlessonpg.length > 0) {
                    const studentlessonprogress = stdlessonpg[0];
                    let quiz = await studentprogress.findOne({
                        order: [['starttime', 'ASC']],
                        where: {
                            studentid: std?.studentid,
                            ispass: 1
                        },
                        attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass'],
                        include: [
                            {
                                model: lessonquizzes,
                                required: true,
                                attributes: [],
                                where: { lessonid: studentlessonprogress.lessonid }
                            },
                        ]
                    });
                    if(!quiz) {
                        quiz = await studentprogress.findOne({
                            order: [['starttime', 'DESC']],
                            where: {
                                studentid: std?.studentid,
                                ispass: 0
                            },
                            attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass'],
                            include: [
                                {
                                    model: lessonquizzes,
                                    required: true,
                                    attributes: [],
                                    where: { lessonid: studentlessonprogress.lessonid }
                                },
                            ]
                        });
                    }
                    if(quiz) {
                        const totalquestions = await lessonquizquestions.count({
                            where: { lessonquizid: quiz.studentprogressreferenceid }
                        });
                        quiz.setDataValue('totalquestions', totalquestions);
                        std.setDataValue('laststudentprogress', quiz);
                    }
                }
                if(lesson) std.setDataValue('lesson', lesson);
                const standard = await standards.findOne({
                    where: { standardid: std?.standard },
                    attributes: ['standardname']
                });
                const schoolcountry = await schools.findOne({
                    where: { schoolname: std?.schoolname },
                    attributes: ['schoolname'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                });
                const schooluser = await schoolusers.findOne({
                    where: { schooluserid: std.schooluserid }
                });
                if(schoolcountry) std.setDataValue('school', schoolcountry);
                if(standard) std.setDataValue('class', standard);
                if(schooluser) std.setDataValue('schooluser', schooluser);
            }
            return stds;
        }));
        return alllessons;
    };

    getAllStudentsWithProgress = async (type: number, paging?: {where: any, order: any, limit: any, offset: any}) => {
        const where: any = {
            ...paging?.where,
        }
        if(!where.studentid && !where.standard) where.studentid = Default_Test_Student_ID;
        const progress = await students.findAndCountAll({
            attributes: ['studentfirstname', 'country', 'standard', 'curriculumid'],
            where,
            include:[
                {
                    model: studentprogress,
                    required: false,
                    where: { progresstype: type },
                    include: [
                        {
                            model: lessonquizzes,
                            required: false,
                            attributes: ['lessonquizid', 'lessonquizorder'],
                            include: [
                                {
                                    model: lessons,
                                    as: 'lesson',
                                    required: false,
                                    attributes: ['lessonname', 'lessonorder'],
                                    include: [
                                        {
                                            model: levels,
                                            as: 'level',
                                            required: false,
                                            attributes: ['levelname', 'levelorder'],
                                            include: [
                                                {
                                                    model: grades,
                                                    as: 'grade',
                                                    required: false,
                                                    attributes: ['gradename', 'gradeorder'],
                                                    include: [
                                                        {
                                                            model: curriculums,
                                                            as: 'curriculum',
                                                            required: false,
                                                            attributes: ['curriculumname']
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                    ]
                },
                {
                    model: schoolusers,
                    as: 'schooluser',
                    required: true,
                    attributes: ['schoolusername']
                },
                {
                    model: standards,
                    as: 'class',
                    required: false,
                    attributes: ['standardname']
                },
                {
                    model: schools,
                    required: false,
                    attributes: ['schoolid', 'schoolname', 'countryid'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                }
            ]
        });
        let curriculum: curriculums | null = null;
        if(progress.rows.length > 0) {
            const student = progress.rows[0];
            if(student) {
                curriculum = await curriculums.findOne({
                    attributes: ['curriculumname'],
                    where: { curriculumid: student.curriculumid },
                });
            }
        }
        return {progress, curriculum};
    }

    getStudentLastCompletedQuiz = async (paging: IMultiPaging, download: boolean = false, type: number) => {
        const where: WhereOptions<studentsAttributes> = {
            is_teacher_acc: false,
        };
        const order = ["lastupdated"];
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        buildCustomWhere(paging.filter ?? [], {key: 'curriculumid', fields: '$studentprogresses.lessonquiz.lesson.level.grade.curriculum.curriculumid$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'gradeid', fields: '$studentprogresses.lessonquiz.lesson.level.grade.gradeid$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'levelid', fields: '$studentprogresses.lessonquiz.lesson.level.levelid$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'lessonid', fields: '$studentprogresses.lessonquiz.lesson.lessonid$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'countryid', fields: '$school.countryid$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'schoolid', fields: '$school.schoolid$', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
        const {progress, curriculum} = await this.getAllStudentsWithProgress(type, {where, order, limit, offset});
        const lastcompletedlessonquiz: Array<students | undefined> = [];
        for (const student of progress.rows) {
            student.setDataValue('curriculum', curriculum ?? undefined);
            const groupUserProgress = student.getDataValue('studentprogresses');
            if(!groupUserProgress || groupUserProgress.length <= 0) {
                lastcompletedlessonquiz.push(student);
                continue;
            }
            // const sortGroupUserProgress = sortBy(groupUserProgress, 'starttime');
            const maxGradeOrder = maxBy(groupUserProgress, 'lessonquiz.lesson.level.grade.gradeorder');
            if(maxGradeOrder && groupUserProgress) {
                const lastGradeProgress = groupUserProgress.filter(gup => gup.lessonquiz?.lesson.level.grade.gradeorder === maxGradeOrder.lessonquiz?.lesson.level.grade.gradeorder)
                const maxLevelOrder = maxBy(lastGradeProgress, 'lessonquiz.lesson.level.levelorder');
                if(maxLevelOrder) {
                    const lastLevelProgress = lastGradeProgress.filter(gup => gup.lessonquiz?.lesson.level.levelorder === maxLevelOrder.lessonquiz?.lesson.level.levelorder)
                    const maxLessonOrder = maxBy(lastLevelProgress, 'lessonquiz.lesson.lessonorder');
                    if(maxLessonOrder) {
                        const lastLessonProgress = lastLevelProgress.filter(gup => gup.lessonquiz?.lesson.lessonorder === maxLessonOrder.lessonquiz?.lesson.lessonorder)
                        const maxLessonQuizOrder = maxBy(lastLessonProgress, 'lessonquiz.lessonquizorder');
                        if(maxLessonQuizOrder) {
                            const lastLessonQuizProgress = lastLessonProgress.filter(gup => gup.lessonquiz?.lessonquizorder === maxLessonQuizOrder.lessonquiz?.lessonquizorder);
                            student.setDataValue('studentprogresses', []);
                            student.setDataValue('laststudentprogress', maxBy(lastLessonQuizProgress, 'starttime'));
                            lastcompletedlessonquiz.push(student);
                        }
                    }
                }
            }
        }
        const tempArr = lastcompletedlessonquiz.slice();
        tempArr.splice(0, offset);
        const paginationArr = !download ? tempArr.splice(0, limit) : lastcompletedlessonquiz;
        return {lastcompletedlessonquiz: paginationArr, count: lastcompletedlessonquiz.length}
    }

    getStudentStatus = async (
        paging: IMultiPaging,
        download: boolean = false
    ) => {
        const where: WhereOptions<studentsAttributes> = {
            is_teacher_acc: false,
        };
        let whereUsage: any = {};
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        buildCustomWhere(paging.filter ?? [], {key: 'countryid', fields: '$school.countryid$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'schoolname', fields: '$school.schoolname$', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'schoolid', fields: '$school.schoolid$', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'startDate', where: whereUsage});
        buildCustomWhere(paging.filter ?? [], {fields: 'endDate', where: whereUsage});
        const options: any = { where };
        // check if there no search, download only part of all 
        if(!download || (download && !paging.filter?.some(f => f.key != 'schoolid' && f.value))) {
            options.limit = limit;
            options.offset = offset;
        }
        const allstudents = await students.findAndCountAll({
            ...options,
            attributes: ['studentid', 'country', 'schoolname', 'standard', 'schooluserid'],
            include: [
                {
                    model: schoolusers,
                    as: 'schooluser',
                    required: true,
                    attributes: ['schoolusername'],
                },
                {
                    model: schools,
                    required: true,
                    attributes: ['schoolid','schoolname','countryid'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                },
                {
                    model: standards,
                    as: 'class',
                    required: false,
                    attributes: ['standardname']
                },
                {
                    model: curriculums,
                    as: 'curriculum',
                    required: true,
                    attributes: ['curriculumname']
                }
            ]
        });
        if(whereUsage.startDate) {
            const endDate = whereUsage.endDate ? whereUsage.endDate : new Date();
            whereUsage = {
                created_at: {
                    [Op.between] : [whereUsage.startDate, endDate]
                }
            }
        }
        for await (const st of allstudents.rows) {
            whereUsage.schooluserid = st.schooluserid;
            const logins = await rpiuseraccess.findOne({
                order: [['logintime', 'DESC']],
                limit: 1,
                where: { userid: st.schooluserid }
            });
            const appusages = await studentappusages.findAll({
                where: whereUsage,
                attributes: [[fn("sum", col("time_spent")), "time_spent"]],
            });
            const totalusages = appusages[0]?.time_spent ?? 0;
            st.setDataValue('status', logins ? true : false);
            st.setDataValue('lastLogin', logins?.logintime);
            st.setDataValue('totalusages', Math.ceil(totalusages/60) ?? 0);
            (st as any).lastLogin = logins?.logintime;
        }
        return allstudents;
    }

    getStudentGradeProgress = async (paging: IMultiPaging) => {
        students.hasMany(studentgradesprogress, {
            foreignKey: "studentid",
            sourceKey: "studentid",
        });
        studentgradesprogress.belongsTo(students, {
            foreignKey: "studentid",
        });
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        const where: any = {};
        const gradewhere: any = {};
        buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'gradeid', where: gradewhere});
        let student: students | null = null;
        if(!where.standard && !where.studentid) {
            student = await students.findOne({
                where: { studentid: Default_Test_Student_ID }
            });
            if(!student) throw new BadRequestException('school has no student!');
            where.standard = student?.standard;
            // where.studentid = student.studentid;
        } else if(!where.studentid) {
            student = await students.findOne({
                where: { standard: where.standard }
            });
            // if(student) where.studentid = student.studentid;
        } else if (where.studentid) {
            student = await students.findOne({
                where: { studentid: where.studentid }
            });
        }
        // find a lesson to show
        if(!gradewhere.gradeid && student?.curriculumid) {
            const curriculum = await curriculums.findOne({
                where: { curriculumid: student?.curriculumid, curriculumstatus: true, isdeleted: false },
                attributes: ['curriculumid', 'curriculumname'],
                include: [
                    {
                        model: grades,
                        as: 'grades',
                        required: true,
                        where: { gradestatus: true, isdeleted: false },
                        attributes: ['gradeid', 'gradename', 'gradeorder'],
                        include: [
                            {
                                model: levels,
                                as: 'levels',
                                required: true,
                                where: { levelstatus: true, isdeleted: false },
                                attributes: ['levelname', 'levelorder'],
                                include: [
                                    {
                                        model: lessons,
                                        as: 'lessons',
                                        required: true,
                                        where: { lessonstatus: true, isdeleted: false },
                                        attributes: ['lessonid', 'lessonorder'],
                                    },
                                ]
                            },
                        ]
                    },
                ]
            });
            const bestgrade = minBy(curriculum?.grades, 'gradeorder');
            gradewhere.gradeid = bestgrade?.gradeid;
        }
        const stds = await students.findAndCountAll({
            where, limit, offset,
            include: [
                {
                    model: studentgradesprogress,
                    required: false,
                    where: gradewhere,
                    attributes: ['gradeid', 'progress', 'scores'],
                },
            ]
        }).then((async stds => {
            for await (const student of stds.rows) {
                // const stdlevelpg = (student as any).studentlevelsprogresses as studentlevelsprogress[];
                // if(stdlevelpg.length > 0) {
                //     const studentlevelprogress = stdlevelpg[0];
                //     let quiz = await studentprogress.findOne({
                //         order: [['starttime', 'ASC']],
                //         where: {
                //             studentid: student?.studentid,
                //             ispass: 1
                //         },
                //         attributes: ['scores', 'resultpercentage', 'marks', 'ispass'],
                //         include: [
                //             {
                //                 model: levels,
                //                 required: true,
                //                 attributes: [],
                //                 where: { levelid: studentlevelprogress.levelid }
                //             },
                //         ]
                //     });
                //     if(!quiz) {
                //         quiz = await studentprogress.findOne({
                //             order: [['starttime', 'DESC']],
                //             where: {
                //                 studentid: student?.studentid,
                //                 ispass: 0
                //             },
                //             attributes: ['scores', 'resultpercentage', 'marks', 'ispass'],
                //             include: [
                //                 {
                //                     model: levels,
                //                     required: true,
                //                     attributes: [],
                //                     where: { levelid: studentlevelprogress.levelid }
                //                 },
                //             ]
                //         });
                //     }
                //     if(quiz) {
                //         const totalquestions = Math.round(((quiz.marks/quiz.resultpercentage*100 ?? 0) + Number.EPSILON) * 100) / 100 ?? 0;
                //         quiz.setDataValue('totalquestions', totalquestions);
                //         student.setDataValue('laststudentprogress', quiz);
                //     }
                // }
                const grade = await grades.findOne({
                    where: { gradeid: gradewhere.gradeid },
                    attributes: ['gradename'],
                    include: [
                        {
                            model: curriculums,
                            as: 'curriculum',
                            required: true,
                            attributes: ['curriculumname']
                        }
                    ]
                })
                if(grade) student.setDataValue('grade', grade);
                const standard = await standards.findOne({
                    where: { standardid: student?.standard },
                    attributes: ['standardname']
                });
                const schoolcountry = await schools.findOne({
                    where: { schoolname: student?.schoolname },
                    attributes: ['schoolname'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                });
                if(schoolcountry) student?.setDataValue('school', schoolcountry);
                if(standard) student?.setDataValue('class', standard);
            }
            return stds;
        }));
        return stds;
    }

    getStudentGradeProgress2 = async (paging: IMultiPaging) => {
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        const where:any = {};
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        if(!where.studentid) {
            where.studentid = Default_Test_Student_ID;
        }
        const student = await students.findOne({
            where: {
                studentid: where.studentid
            },
            attributes: ['studentfirstname'],
            include: [
                {
                    model: curriculums,
                    required: true,
                    as: 'curriculum',
                    attributes: ['curriculumid']
                }
            ]
        });
        if(!student) return { rows: [], count: 0, student: null };
        const studentgradeprogresses = await grades.findAndCountAll({
            where: { gradestatus: true, isdeleted: false },
            order: ['gradename'],
            limit, offset,
            attributes: ['gradeid', 'gradename'],
            include: [
                {
                    model: curriculums,
                    as: 'curriculum',
                    required: true,
                    where: { curriculumid: student.curriculum.curriculumid, curriculumstatus: true, isdeleted: false },
                    attributes: ['curriculumid','curriculumname'],
                },
            ]
        }).then(async gradescount => {
            for await (const grade of gradescount.rows) {
                const studentgradeprogress = await studentgradesprogress.findOne({
                    where: { studentid: where.studentid, gradeid: grade.gradeid }
                });
                if(studentgradeprogress) grade.setDataValue('studentgradeprogress', studentgradeprogress);
            }
            return gradescount;
        });

        return {...studentgradeprogresses, student};
    }

    getStudentLevelProgress = async (paging: IMultiPaging) => {
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        const where:any = {};
        const levelwhere:any = { levelstatus: true, isdeleted: false };
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'gradeid', where: levelwhere});
        if(!where.studentid) {
            where.studentid = Default_Test_Student_ID;
        }
        const student = await students.findOne({
            where: {
                studentid: where.studentid
            },
            attributes: ['studentfirstname'],
            include: [
                {
                    model: curriculums,
                    required: true,
                    as: 'curriculum',
                    attributes: ['curriculumid']
                }
            ]
        });
        if(!student) return { rows: [], count: 0, student: null };
        const studentlevelprogresses = await levels.findAndCountAll({
            where: levelwhere,
            order: ['levelname'],
            limit, offset,
            attributes: ['levelid', 'levelname'],
            include: [
                {
                    model: grades,
                    as: 'grade',
                    required: true,
                    where: { gradestatus: true, isdeleted: false},
                    attributes: ['gradeid','gradename'],
                    include: [
                        {
                            model: curriculums,
                            as: 'curriculum',
                            required: true,
                            where: { curriculumid: student.curriculum.curriculumid, curriculumstatus: true, isdeleted: false },
                            attributes: ['curriculumid','curriculumname'],
                        },
                    ]
                },
            ]
        }).then(async levelscount => {
            for await (const level of levelscount.rows) {
                const studentlevelprogress = await studentlevelsprogress.findOne({
                    where: { studentid: where.studentid, levelid: level.levelid }
                });
                if(studentlevelprogress) level.setDataValue('studentlevelprogress', studentlevelprogress);
            }
            return levelscount;
        });
        return {...studentlevelprogresses, student};
    }

    getStudentLessonProgress = async (paging: IMultiPaging) => {
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        const where:any = {};
        const levelwhere:any = { levelstatus: true, isdeleted: false };
        const lessonwhere:any = { lessonstatus: true, isdeleted: false };
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'gradeid', where: levelwhere});
        buildCustomWhere(paging.filter ?? [], {fields: 'levelid', where: lessonwhere});
        if(!where.studentid) {
            where.studentid = Default_Test_Student_ID;
        }
        const student = await students.findOne({
            where: {
                studentid: where.studentid
            },
            attributes: ['studentfirstname'],
            include: [
                {
                    model: curriculums,
                    required: true,
                    as: 'curriculum',
                    attributes: ['curriculumid']
                }
            ]
        });
        if(!student) return { rows: [], count: 0, student: null };
        const studentlessonprogresses = await lessons.findAndCountAll({
            where: lessonwhere,
            order: ['lessonname'],
            limit, offset,
            attributes: ['lessonid', 'lessonname'],
            include: [
                {
                    model: levels,
                    as: 'level',
                    required: true,
                    where: levelwhere,
                    attributes: ['levelid','levelname'],
                    include: [
                        {
                            model: grades,
                            as: 'grade',
                            required: true,
                            where: { gradestatus: true, isdeleted: false },
                            attributes: ['gradeid','gradename'],
                            include: [
                                {
                                    model: curriculums,
                                    as: 'curriculum',
                                    required: true,
                                    where: { curriculumid: student.curriculum.curriculumid, curriculumstatus: true, isdeleted: false },
                                    attributes: ['curriculumid','curriculumname'],
                                },
                            ]
                        },
                    ]
                },
            ]
        }).then(async lessonscount => {
            for await (const lesson of lessonscount.rows) {
                const studentlessonprogress = await studentlessonsprogress.findOne({
                    where: { studentid: where.studentid, lessonid: lesson.lessonid }
                });
                if(studentlessonprogress) lesson.setDataValue('studentlessonprogress', studentlessonprogress);
            }
            return lessonscount;
        });
        return {...studentlessonprogresses, student};
    }

    getStudentsOfflineOnline = async (schoolname: string, countryid: string) => {
        const where: WhereOptions<studentsAttributes> = {
            isactive: 1,
        }
        const wherecountry: any = {};
        if(schoolname) where.schoolname = schoolname;
        if(countryid && countryid !== 'all') wherecountry.countryid = countryid;
        const numberOfOnline = await students.count({
            where,
            include: [
                {
                    model: schools,
                    required: true,
                    where: wherecountry
                }
            ]
        });
        const chartFormat: Array<ChartItemFormat> = [];
        chartFormat.push({ name: 'Online', value: numberOfOnline });
        return { name: 'Online', value: numberOfOnline };
    }

    getLevelQuizScoresData = async (
        paging: IMultiPaging,
        download: boolean = false
    ) => {
        levels.hasMany(studentprogress, {
            foreignKey: "studentprogressreferenceid",
            sourceKey: "levelid",
        });
        studentprogress.belongsTo(levels, {
            foreignKey: "studentprogressreferenceid",
        });
        levels.hasMany(studentlevelsprogress, {
            foreignKey: "levelid",
            sourceKey: "levelid",
        });
        studentlevelsprogress.belongsTo(levels, {
            foreignKey: "levelid",
        });
        // const limit = paging.pagesize || 20;
        // let offset = 0;
        // if ((paging.pageindex || 1) > 1) {
        //     offset = limit * ((paging.pageindex || 1) - 1);
        // }
        const where: any = {};
        const levelwhere: any = {levelstatus: true, isdeleted: false};
        buildCustomWhere(paging.filter ?? [], {fields: 'curriculumid', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'studentid', where: where});
        buildCustomWhere(paging.filter ?? [], {key: 'gradeid', fields: '$grade.gradeid$', where: levelwhere});
        buildCustomWhere(paging.filter ?? [], {fields: 'levelid', where: levelwhere});
        let student: students | null = null;
        if(!where.standard && !where.studentid) {
            student = await students.findOne({
                where: { studentid: Default_Test_Student_ID },
                include: [
                    {
                        model: schoolusers,
                        as: 'schooluser',
                        required: true,
                        attributes: ['schoolusername']
                    }
                ]
            });
            if(!student) return { rows: [], count: 0};
            where.standard = student?.standard;
            where.studentid = student.studentid;
        } else if(!where.studentid) {
            student = await students.findOne({
                where: { standard: where.standard },
                include: [
                    {
                        model: schoolusers,
                        as: 'schooluser',
                        required: true,
                        attributes: ['schoolusername']
                    }
                ]
            });
            if(student) where.studentid = student.studentid;
        } else if (where.studentid) {
            student = await students.findOne({
                where: { studentid: where.studentid },
                include: [
                    {
                        model: schoolusers,
                        as: 'schooluser',
                        required: true,
                        attributes: ['schoolusername']
                    }
                ]
            });
        }
        if(!student) return { rows: [], count: 0};
        const options: any = { where: levelwhere };
        // if(!download) {
        //     options.limit = limit;
        //     options.offset = offset;
        // }
        const alllevels = await levels.findAndCountAll({
            ...options,
            include: [
                {
                    model: studentlevelsprogress,
                    required: false,
                    where: { studentid: student?.studentid },
                    attributes: ['levelid'],
                },
                {
                    model: grades,
                    as: 'grade',
                    required: true,
                    attributes: ['gradename'],
                    include: [
                        {
                            model: curriculums,
                            as: 'curriculum',
                            required: true,
                            where: { curriculumid: (where.curriculumid ? where.curriculumid : student?.curriculumid) },
                            attributes: ['curriculumname']
                        }
                    ]
                },
            ]
        }).then((async lvs => {
            for await (const lv of lvs.rows) {
                const stdlevelpg = (lv as any).studentlevelsprogresses as studentlevelsprogress[];
                if(stdlevelpg.length > 0) {
                    const studentlevelprogress = stdlevelpg[0];
                    let quiz = await studentprogress.findOne({
                        order: [['starttime', 'ASC']],
                        where: {
                            studentid: student?.studentid,
                            ispass: 1
                        },
                        attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass', 'starttime'],
                        include: [
                            {
                                model: levels,
                                required: true,
                                attributes: [],
                                where: { levelid: studentlevelprogress.levelid }
                            },
                        ]
                    });
                    if(!quiz) {
                        quiz = await studentprogress.findOne({
                            order: [['starttime', 'DESC']],
                            where: {
                                studentid: student?.studentid,
                                ispass: 0
                            },
                            attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass', 'starttime'],
                            include: [
                                {
                                    model: levels,
                                    required: true,
                                    attributes: [],
                                    where: { levelid: studentlevelprogress.levelid }
                                },
                            ]
                        });
                    }
                    if(quiz) {
                        const totalquestions = await levelquizquestions.count({
                            where: { levelid: quiz.studentprogressreferenceid }
                        });
                        quiz.setDataValue('totalquestions', totalquestions);
                        lv.setDataValue('laststudentprogress', quiz);
                        lv.setDataValue('starttime', quiz.starttime);
                    }
                }
                const grade = await grades.findOne({
                    where: { gradeid: lv.gradeid },
                    attributes: ['gradename'],
                    include: [
                        {
                            model: curriculums,
                            as: 'curriculum',
                            required: true,
                            attributes: ['curriculumname']
                        }
                    ]
                })
                if(grade) lv.setDataValue('grade', grade);
                const standard = await standards.findOne({
                    where: { standardid: student?.standard },
                    attributes: ['standardname']
                });
                const schoolcountry = await schools.findOne({
                    where: { schoolname: student?.schoolname },
                    attributes: ['schoolname'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                });
                if(schoolcountry) student?.setDataValue('school', schoolcountry);
                if(standard) student?.setDataValue('class', standard);
                lv.setDataValue('student', student ?? undefined);
            }
            for (let i = 1; i < lvs.rows.length; i++) {
                const starttime = lvs.rows[i].getDataValue('starttime') ?? 0;
                for (let j = 0; j < i; j++) {
                    const starttimeloop = lvs.rows[j].getDataValue('starttime') ?? 0;
                    if (isAfter(starttime, starttimeloop)) {
                        const x = lvs.rows[i];
                        lvs.rows[i] = lvs.rows[j];
                        lvs.rows[j] = x;
                    }
                }
            }
            return lvs;
        }));
        return alllevels;
    };

    getClassLevelQuizScoresData = async (
        paging: IMultiPaging,
        download: boolean = false
    ) => {
        levels.hasMany(studentprogress, {
            foreignKey: "studentprogressreferenceid",
            sourceKey: "levelid",
        });
        studentprogress.belongsTo(levels, {
            foreignKey: "studentprogressreferenceid",
        });
        const limit = paging.pagesize || 20;
        let offset = 0;
        if ((paging.pageindex || 1) > 1) {
            offset = limit * ((paging.pageindex || 1) - 1);
        }
        const where: any = {
            is_teacher_acc: false
        };
        const levelwhere: any = {};
        buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
        buildCustomWhere(paging.filter ?? [], {fields: 'levelid', where: levelwhere});
        let student: students | null = null;
        if(!where.standard && !where.studentid) {
            student = await students.findOne({
                where: { studentid: Default_Test_Student_ID },
            });
            if(!student) throw new BadRequestException('school has no student!');
            where.standard = student?.standard;
        } else if(!where.studentid) {
            student = await students.findOne({
                where: { standard: where.standard },
            });
            // if(student) where.studentid = student.studentid;
        } else if (where.studentid) {
            student = await students.findOne({
                where: { studentid: where.studentid },
            });
            if(student) where.standard = student?.standard;
        }
        if(!student) return { rows: [], count: 0};
        // find a lesson to show
        if(!levelwhere.levelid && student?.curriculumid) {
            const curriculum = await curriculums.findOne({
                where: { curriculumid: student?.curriculumid, curriculumstatus: true, isdeleted: false },
                attributes: ['curriculumid', 'curriculumname'],
                include: [
                    {
                        model: grades,
                        as: 'grades',
                        required: true,
                        where: { gradestatus: true, isdeleted: false },
                        attributes: ['gradename', 'gradeorder'],
                        include: [
                            {
                                model: levels,
                                as: 'levels',
                                required: true,
                                where: { levelstatus: true, isdeleted: false },
                                attributes: ['levelid','levelname', 'levelorder'],
                                include: [
                                    {
                                        model: lessons,
                                        as: 'lessons',
                                        required: true,
                                        where: { lessonstatus: true, isdeleted: false },
                                        attributes: ['lessonid', 'lessonorder'],
                                    },
                                ]
                            },
                        ]
                    },
                ]
            });
            const bestgrade = minBy(curriculum?.grades, 'gradeorder');
            const bestlevel = minBy(bestgrade?.levels, 'levelorder');
            levelwhere.levelid = bestlevel?.levelid;
        }
        const level = await levels.findOne({
            where: { levelid: levelwhere.levelid },
            attributes: ['levelname'],
            include: [
                {
                    model: grades,
                    as: 'grade',
                    required: true,
                    attributes: ['gradename'],
                    include: [
                        {
                            model: curriculums,
                            as: 'curriculum',
                            required: true,
                            attributes: ['curriculumname']
                        }
                    ]
                }
            ]
        });
        const options: any = { where };
        if(!download) {
            options.limit = limit;
            options.offset = offset;
        }
        const alllevels = await students.findAndCountAll({
            ...options,
            include: [
                {
                    model: studentlevelsprogress,
                    required: false,
                    where: levelwhere,
                    attributes: ['levelid'],
                },
            ]
        }).then((async stds => {
            for await (const std of stds.rows) {
                const stdlevelpg = (std as any).studentlevelsprogresses as studentlevelsprogress[];
                if(stdlevelpg.length > 0) {
                    const studentlevelprogress = stdlevelpg[0];
                    let quiz = await studentprogress.findOne({
                        order: [['starttime', 'ASC']],
                        where: {
                            studentid: std?.studentid,
                            ispass: 1
                        },
                        attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass', 'starttime'],
                        include: [
                            {
                                model: levels,
                                required: true,
                                attributes: [],
                                where: { levelid: studentlevelprogress.levelid }
                            },
                        ]
                    });
                    if(!quiz) {
                        quiz = await studentprogress.findOne({
                            order: [['starttime', 'DESC']],
                            where: {
                                studentid: std?.studentid,
                                ispass: 0
                            },
                            attributes: ['studentprogressreferenceid', 'scores', 'resultpercentage', 'marks', 'ispass', 'starttime'],
                            include: [
                                {
                                    model: levels,
                                    required: true,
                                    attributes: [],
                                    where: { levelid: studentlevelprogress.levelid }
                                },
                            ]
                        });
                    }
                    if(quiz) {
                        const totalquestions = await levelquizquestions.count({
                            where: { levelid: quiz.studentprogressreferenceid }
                        });
                        quiz.setDataValue('totalquestions', totalquestions);
                        std.setDataValue('laststudentprogress', quiz);
                    }
                }
                if(level) std.setDataValue('level', level);
                const standard = await standards.findOne({
                    where: { standardid: std?.standard },
                    attributes: ['standardname']
                });
                const schoolcountry = await schools.findOne({
                    where: { schoolname: std?.schoolname },
                    attributes: ['schoolname'],
                    include: [
                        {
                            model: countries,
                            as: 'countries',
                            attributes: ['countryname'],
                        },
                    ]
                });
                const schooluser = await schoolusers.findOne({
                    where: { schooluserid: std.schooluserid },
                    attributes: ['schoolusername']
                });
                if(schoolcountry) std?.setDataValue('school', schoolcountry);
                if(standard) std?.setDataValue('class', standard);
                if(schooluser) std?.setDataValue('schooluser', schooluser);
            }
            return stds;
        }));
        return alllevels;
    };
}