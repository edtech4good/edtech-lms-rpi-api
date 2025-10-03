/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op } from "sequelize";
import { curriculumbaseline, documents, lessonlearnings, lessonpracticequestions, lessonpractices, lessonquizquestions, lessonquizzes, lessons, levelquizquestions, levels, questions, studentprogress, studentprogressquestions } from "src/models/data-models/init-models";
import { LearningPathType } from "src/models/enums/learningpathtype.enum";
import { FileMeta } from "src/models/filemeta.model";
import { Token } from "src/models/token.model";
import { rawfilenameextractor } from "src/services/util.service";
import { LessonBusiness } from "./lesson.business";
import { baselinequestion } from "src/models/data-models/baselinequestion";
export class QuestionBusiness {
    getlessonquestions = async (lessonid: string, user: Token) => {


        lessons.hasMany(lessonlearnings, {
            foreignKey: 'lessonid',
            sourceKey: 'lessonid',
        });
        lessonlearnings.belongsTo(lessons, {
            foreignKey: 'lessonid',
        });

        // lesson practice
        lessons.hasMany(lessonpractices, {
            foreignKey: 'lessonid',
            sourceKey: 'lessonid',
        });
        lessonpractices.belongsTo(lessons, {
            foreignKey: 'lessonid',
        });

        lessonpractices.hasMany(lessonpracticequestions, {
            foreignKey: 'lessonpracticeid',
            sourceKey: 'lessonpracticeid',
        });
        lessonpracticequestions.belongsTo(lessonpractices, {
            foreignKey: 'lessonpracticeid',
        });

        lessonpracticequestions.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(lessonpracticequestions, {
            foreignKey: 'questionid',
        });

        // lesson quiz
        lessons.hasMany(lessonquizzes, {
            foreignKey: 'lessonid',
            sourceKey: 'lessonid',
        });
        lessonquizzes.belongsTo(lessons, {
            foreignKey: 'lessonid',
        });

        lessonquizzes.hasMany(lessonquizquestions, {
            foreignKey: 'lessonquizid',
            sourceKey: 'lessonquizid',
        });
        lessonquizquestions.belongsTo(lessonquizzes, {
            foreignKey: 'lessonquizid',
        });

        lessonquizquestions.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(lessonquizquestions, {
            foreignKey: 'questionid',
        });

        const question = await lessons.findOne({
            where: { lessonid, lessonstatus: true, isdeleted: false },
            attributes: {
                exclude: [],
            },
            include: [
                {
                    where: {
                        lessonid: { [Op.ne]: null },
                        lessonlearningstatus: true,
                    },
                    model: lessonlearnings,
                    required: false,
                    order: [['lessonlearningorder', 'ASC']],
                },
                {
                    where: {
                        lessonpracticeid: { [Op.ne]: null },
                        lessonpracticestatus: true,
                    },
                    required: false,
                    model: lessonpractices,
                    order: [['lessonpracticeorder', 'ASC']],
                },
                {
                    where: {
                        lessonquizid: { [Op.ne]: null },
                        lessonquizstatus: true,
                    },
                    required: false,
                    model: lessonquizzes,
                    order: [['lessonquizorder', 'ASC']],
                },
            ],
        });
        if (question) {

            const lpq = await lessonpracticequestions.findAll({
                where: {
                    lessonpracticeid: {
                        [Op.in]: question.lessonpractices.map(
                            (x) => x.lessonpracticeid
                        ),
                    },
                    lessonpracticequestionstatus: true,
                },
                include: [
                    {
                        where: { questionid: { [Op.ne]: null } },
                        required: false,
                        model: questions,
                    },
                ],
            });

            const lqq = await lessonquizquestions.findAll({
                where: {
                    lessonquizid: {
                        [Op.in]: question.lessonquizzes.map((x) => x.lessonquizid),
                    },
                    lessonquizquestionstatus: true,
                },
                include: [
                    {
                        where: { questionid: { [Op.ne]: null } },
                        required: false,
                        model: questions,
                    },
                ],
            });
            let questionobject: any = {
                ...question.get({ plain: true }),
            };
            const learningdocuments = await documents.findAll({
                where: {

                    documentid: {
                        [Op.in]: questionobject.lessonlearnings.map((x: any) => x.documentid)
                    },
                },

            });


            questionobject.lessonlearnings = questionobject.lessonlearnings.map((x: lessonlearnings & { lessonlearningfileobject: FileMeta }) => {
                return {
                    ...x, lessonlearningfileobject: rawfilenameextractor(learningdocuments.find(y => y.documentid === x.documentid)?.documentname || "")
                };
            });
            questionobject.lessonlearningprogress = await new LessonBusiness().getalllearningprogress(lessonid, user);
            questionobject = {
                ...questionobject,
                learningpath: [
                    ...questionobject.lessonlearnings.map((x: lessonlearnings & { lessonlearningfileobject: FileMeta }) => ({
                        ...x,
                        learningpathtype: LearningPathType.LEARNING,
                        learningpathname: x.lessonlearningname,
                        learningpathdescription: x.lessonlearningdescription,
                        learningpathid: x.lessonlearningid,
                        learningpathorder: x.lessonlearningorder,
                    })),
                    ...questionobject.lessonpractices.map((x: lessonpractices) => ({
                        ...x,
                        learningpathtype: LearningPathType.PRACTICE,
                        learningpathname: x.lessonpracticename,
                        learningpathid: x.lessonpracticeid,
                        learningpathorder: x.lessonpracticeorder,
                        learningpathdescription: x.lessonpracticeorder,
                        lessonpracticequestions: lpq.filter(
                            (xx) => xx.lessonpracticeid === x.lessonpracticeid
                        ),
                    })),
                    ...questionobject.lessonquizzes.map((x: lessonquizzes) => ({
                        ...x,
                        learningpathtype: LearningPathType.QUIZ,
                        learningpathname: x.lessonquizname,
                        learningpathid: x.lessonquizid,
                        learningpathorder: x.lessonquizorder,
                        learningpathdescription: x.lessonquizorder,
                        lessonquizquestions: lqq.filter(
                            (xx) => xx.lessonquizid === x.lessonquizid
                        ),
                    })),
                ],
            };
            return questionobject;
        }
        return null;
    };
    getlevelquestions = async (levelid: string) => {
        levels.hasMany(levelquizquestions, {
            foreignKey: 'levelid',
            sourceKey: 'levelid',
        });
        levelquizquestions.belongsTo(levels, {
            foreignKey: 'levelid',
        });

        levelquizquestions.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(levelquizquestions, {
            foreignKey: 'questionid',
        });

        const question = await levels.findOne({
            where: { levelid, levelstatus: true },
            attributes: {
                exclude: [],
            },
            include: [
                {
                    where: {
                        levelquizquestionid: { [Op.ne]: null },
                        levelquizquestionstatus: true,
                    },
                    model: levelquizquestions,
                    order: [['levelquizquestionorder', 'ASC']],
                    include: [
                        {
                            where: { questionid: { [Op.ne]: null } },
                            model: questions,
                        },
                    ],
                },
            ],
        });
        if (question) {
            let questionobject: any = question.get({ plain: true });
            questionobject = {
                ...questionobject,
                learningpath: [
                    ...questionobject.levelquizquestions.map((x: levelquizquestions) => ({
                        ...x,
                        learningpathtype: LearningPathType.QUIZ,
                        learningpathname: x.levelquizquestionorder,
                        learningpathid: x.levelquizquestionid,
                        learningpathorder: x.levelquizquestionorder,
                        learningpathdescription: x.levelquizquestionorder,
                    })),
                ],
            };
            return questionobject;
        }
        return null;
    };

    getlevelquestionsanswers = async (levelid: string, user: Token) => {
        levels.hasMany(levelquizquestions, {
            foreignKey: 'levelid',
            sourceKey: 'levelid',
        });
        levelquizquestions.belongsTo(levels, {
            foreignKey: 'levelid',
        });

        levelquizquestions.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(levelquizquestions, {
            foreignKey: 'questionid',
        });
        lessons.belongsTo(levelquizquestions, {
            foreignKey: 'lessonid',
        });
        levelquizquestions.hasOne(lessons, {
            foreignKey: 'lessonid',
            sourceKey: 'lessonid',
        });
        const result = await studentprogress.findOne({
            where: {
                studentprogressreferenceid: levelid,
                studentid: user.studentid
            },
            order: [['starttime', 'DESC']]
        });
        if(result) {
            const studentanswers = await studentprogressquestions.findAll({
                where: {
                    studentprogressid: result.studentprogressid
                }
            });
            const question = await levels.findOne({
                where: { levelid, levelstatus: true },
                attributes: {
                    exclude: [],
                },
                include: [
                    {
                        where: {
                            levelquizquestionid: { [Op.ne]: null },
                            levelquizquestionstatus: true,
                        },
                        model: levelquizquestions,
                        order: [['levelquizquestionorder', 'ASC']],
                        include: [
                            {
                                where: { questionid: { [Op.ne]: null } },
                                model: questions,
                            },
                            {
                                model: lessons,
                                attributes: ['lessonid', 'lessonname']
                            },
                        ],
                    },
                ],
            });
            if (question) {
                let questionobject: any = question.get({ plain: true });
                questionobject = [
                    ...questionobject.levelquizquestions.map((x: levelquizquestions) => {
                        const result = studentanswers.find(stda => stda.referencequestionid === x.levelquizquestionid);
                        return {
                            ...x,
                            learningpathtype: LearningPathType.QUIZ,
                            learningpathname: x.levelquizquestionorder,
                            learningpathid: x.levelquizquestionid,
                            learningpathorder: x.levelquizquestionorder,
                            learningpathdescription: x.levelquizquestionorder,
                            iscorrect: result?.iscorrect,
                            lesson: (x as any).lesson,
                        }
                    }),
                ];
                return questionobject;
            }
        }
    }

    getpracticequestions = async (lessonpracticeid: string) => {
        lessonpracticequestions.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(lessonpracticequestions, {
            foreignKey: 'questionid',
        });
        const lpq = await lessonpracticequestions.findAll({
            where: {
                lessonpracticeid,
                lessonpracticequestionstatus: true,
            },
            include: [
                {
                    where: { questionid: { [Op.ne]: null } },
                    required: false,
                    model: questions,
                },
            ],
        });
        return lpq;
    }

    getquizquestions = async (lessonquizid: string) => {
        lessonquizquestions.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(lessonquizquestions, {
            foreignKey: 'questionid',
        });
        const lqq = await lessonquizquestions.findAll({
            where: {
                lessonquizid,
                lessonquizquestionstatus: true,
            },
            include: [
                {
                    where: { questionid: { [Op.ne]: null } },
                    required: false,
                    model: questions,
                },
            ],
        });
        return lqq;
    }

    getbaselinequestions = async (curriculumbaselineid: string) => {
        curriculumbaseline.hasMany(baselinequestion, {
            foreignKey: 'curriculumbaselineid',
            sourceKey: 'curriculumbaselineid',
        });
        baselinequestion.belongsTo(curriculumbaseline, {
            foreignKey: 'curriculumbaselineid',
        });

        baselinequestion.hasOne(questions, {
            foreignKey: 'questionid',
            sourceKey: 'questionid',
        });
        questions.belongsTo(baselinequestion, {
            foreignKey: 'questionid',
        });

        const question = await curriculumbaseline.findOne({
            where: { curriculumbaselineid, baselinestatus: true },
            attributes: {
                exclude: [],
            },
            include: [
                {
                    where: {
                        baselinequestionid: { [Op.ne]: null },
                        baselinequestionstatus: true,
                    },
                    model: baselinequestion,
                    order: [['baselinequestionorder', 'ASC']],
                    include: [
                        {
                            where: { questionid: { [Op.ne]: null } },
                            model: questions,
                        },
                    ],
                },
            ],
        });
        if (question) {
            let questionobject: any = question.get({ plain: true });
            questionobject = {
                ...questionobject,
                learningpath: [
                    ...questionobject
                    .baselinequestions.map((x: baselinequestion) => ({
                        ...x,
                        learningpathtype: LearningPathType.QUIZ,
                        learningpathname: x.baselinequestionorder,
                        learningpathid: x.baselinequestionid,
                        learningpathorder: x.baselinequestionorder,
                        learningpathdescription: x.baselinequestionorder,
                    })),
                ],
            };
            return questionobject;
        }
        return null;
    }
}
