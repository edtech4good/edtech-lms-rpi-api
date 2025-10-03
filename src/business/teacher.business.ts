/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from "@nestjs/common";
import { subDays } from "date-fns";
import { maxBy, minBy, sumBy } from "lodash";
import { col, fn, Op } from "sequelize";
import { standards } from "src/models/data-models/standards";
import { studentappusages } from "src/models/data-models/studentappusage";
import { IMultiPaging } from "src/models/IPaging";
import { Token } from "src/models/token.model";
import { buildCustomWhere } from "src/services/util.service";
import {
  curriculums,
  grades,
  lessonquizquestions,
  lessonquizzes,
  lessons,
  levels,
  rpiuseraccess,
  schoolusers,
  studentlessonsprogress,
  studentprogress,
  students,
} from "../models/data-models/init-models";

export class TeacherBusiness {
  getTeacherStandard = (schoolname: string) => {
    return students.findAll({
      where: {
        schoolname,
      },
      attributes: ["standard"],
      group: ["standard"],
    });
  };
  getTeacherStudentsCount = (schoolname: string) => {
    return students.count({
      where: {
        schoolname,
      },
    });
  };
  getTeacherStudentsGenderCount = (schoolname: string) => {
    return students.findAll({
      where: {
        schoolname,
      },
      attributes: ["genderid", [fn("COUNT", col("genderid")), "count"]],
      group: ["genderid"],
    });
  };

  getTeacherProfile = async (user: Token, standardid: string) => {
    const teacher = await schoolusers.findOne({
      where: {
        schooluserid: user.schooluserid,
      },
      attributes: ["schoolusername", "schoolname"],
      include: [
        {
          model: rpiuseraccess,
          required: true,
          attributes: ["logintime"],
          order: [["logintime", "DESC"]],
          limit: 2,
        },
      ],
    });
    if (!teacher) throw new BadRequestException("No teacher!");
    const teacheraccess = teacher.getDataValue('rpiuseraccesses') ?? null;
    const timeZone = teacheraccess && teacheraccess.length > 1 ? new Date(teacheraccess[1].logintime) : undefined;
    const calender = timeZone ? new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: true,
    }).format(timeZone) : null;
    teacher.setDataValue('logintime', calender ?? '');
    const allstudents = await students.findAndCountAll({
      where: { schoolname: teacher.schoolname, standard: standardid, isactive: 1 },
      attributes: ['studentid','standard','schooluserid'],
      include: [
        {
          model: schoolusers,
          as: 'schooluser',
          required: true,
          attributes: ['schooluserid','schoolusername']
        }
      ]
    });
    const numberofdays = 7;
    const lastweeks = subDays(new Date(), numberofdays);
    let averagestudentusage = 0;
    for await (const student of allstudents.rows) {
      const usages = await studentappusages.findAll(
        { 
          where: { 
            schooluserid: student.schooluser.schooluserid,
            created_at: {
              [Op.gte]: lastweeks
            }
          }
        }
      );
      if (usages && usages.length > 0) {
        averagestudentusage += sumBy(usages, "time_spent") ?? 0;
      }
    }
    averagestudentusage = allstudents.count > 0 ?
      Math.round(
        (((averagestudentusage/60)/allstudents.count) + Number.EPSILON) * 100
      ) / 100 : 0;
    return { teacher, numberofstudents: allstudents.count, averagestudentusage };
  };

  getStudentsScoresData = async (
    user: Token,
    paging: IMultiPaging,
  ) => {
    students.hasMany(studentlessonsprogress, {
      foreignKey: "studentid",
      sourceKey: "studentid",
    });
    studentlessonsprogress.belongsTo(students, {
      foreignKey: "studentid",
    });
    lessons.hasMany(studentlessonsprogress, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    studentlessonsprogress.belongsTo(lessons, {
      foreignKey: "lessonid",
    });
    if (!user.schoolname) throw new BadRequestException("User has no school!");
    const limit = paging.pagesize || 20;
    let offset = 0;
    if ((paging.pageindex || 1) > 1) {
      offset = limit * ((paging.pageindex || 1) - 1);
    }
    const where: any = {};
    const wherecurriculum: any = {};
    const lessonwhere: any = {};
    buildCustomWhere(paging.filter ?? [], {fields: 'curriculum', where: wherecurriculum});
    buildCustomWhere(paging.filter ?? [], {fields: 'standard', where: where});
    buildCustomWhere(paging.filter ?? [], {fields: 'lessonid', where: lessonwhere});
    let student: students | null = null;
    if(!where.standard) {
      student = await students.findOne({
        where: { schoolname: user.schoolname }
      });
      if(!student) throw new BadRequestException('school has no student!');
      where.standard = student?.standard;
    }
    if(!lessonwhere.lessonid) {
      const curriculum = await curriculums.findOne({
        where: { 
          curriculumid: (wherecurriculum.curriculumid ? wherecurriculum.curriculumid : student?.curriculumid),
          curriculumstatus: true,
          isdeleted: false
        },
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
      const bestlevel = minBy(bestgrade?.levels, 'levelorder');
      const bestlesson = minBy(bestlevel?.lessons, 'lessonorder');
      lessonwhere.lessonid = bestlesson?.lessonid;
    }
    const stds = await students.findAndCountAll({
      where, limit, offset,
      attributes: ['studentid', 'studentfirstname', 'schooluserid'],
      include: [
        {
          model: studentlessonsprogress,
          required: false,
          where: lessonwhere,
          attributes: ['progress', 'scores', 'lessonid']
        },
      ]
    }).then(async stds => {
      let i = 1;
      for await (const student of stds.rows) {
        const stdlessonpg = (student as any).studentlessonsprogresses as studentlessonsprogress[];
        let quiz: any = {
          scores: 0, resultpercentage: 0, marks: 0, ispass: 0, totalquestions: 0,
        };
        if(stdlessonpg.length > 0) {
          const studentlessonprogress = stdlessonpg[0];
          quiz = await studentprogress.findOne({
            order: [['starttime', 'ASC']],
            where: {
                studentid: student?.studentid,
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
                    studentid: student?.studentid,
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
            quiz.setDataValue('ispass', +quiz.ispass);
            quiz.setDataValue('totalquestions', totalquestions);
          }
        }
        student.setDataValue('studentprogress', quiz);
        const studentuser = await schoolusers.findOne({
          attributes: ['schoolusername'],
          where: {
            schooluserid: student.schooluserid
          }
        });
        student.setDataValue('index', i);
        if(studentuser) student.setDataValue('schooluser', studentuser);
        i++;
      }
      return stds;
    })
    return stds;
  };

  getStudentsProgress = async (
    type: number,
    paging?: {
      where: any;
      order: any;
      limit: any;
      offset: any;
      schoolname: string;
    }
  ) => {
    lessonquizzes.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonquizid",
    });
    studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
    });
    students.hasMany(studentprogress, {
      foreignKey: "studentid",
      sourceKey: "studentid",
    });
    studentprogress.belongsTo(students, {
      foreignKey: "studentid",
    });
    const where: any = {
      ...paging?.where,
      progresstype: type,
    };
    const progress = await studentprogress.findAndCountAll({
      where,
      order: [["starttime", "DESC"]],
      limit: paging?.limit,
      offset: paging?.offset,
      include: [
        {
          model: lessonquizzes,
          required: true,
          attributes: ["lessonquizid", "lessonquizorder"],
          include: [
            {
              model: lessons,
              as: "lesson",
              required: true,
              attributes: ["lessonname", "lessonorder"],
              include: [
                {
                  model: levels,
                  as: "level",
                  required: true,
                  attributes: ["levelname", "levelorder"],
                  include: [
                    {
                      model: grades,
                      as: "grade",
                      required: true,
                      attributes: ["gradename", "gradeorder"],
                      include: [
                        {
                          model: curriculums,
                          as: "curriculum",
                          required: true,
                          attributes: ["curriculumname"],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          model: students,
          required: true,
          attributes: ["studentfirstname", "country", "standard"],
          where: { schoolname: paging?.schoolname },
          include: [
            {
              model: schoolusers,
              as: "schooluser",
              required: true,
              attributes: ["schoolusername", "schoolname"],
            },
            {
              model: standards,
              as: "class",
              required: true,
              attributes: ["standardid", "standardname"],
            },
          ],
        },
      ],
    });
    return progress;
  };

  getAllStudentsWithProgress = async (
    studentid: string,
    type: number,
  ) => {
    lessonquizzes.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonquizid",
    });
    studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
    });
    students.hasMany(studentprogress, {
      foreignKey: "studentid",
      sourceKey: "studentid",
    });
    studentprogress.belongsTo(students, {
      foreignKey: "studentid",
    });
    const where: any = {
      studentid
    };
    const progress = await students.findOne({
      where,
      attributes: ["studentfirstname", "country", "standard", "dateofjoin"],
      order: [["dateofjoin", "DESC"]],
      include: [
        {
          model: studentprogress,
          required: true,
          where: { progresstype: type },
          include: [
            {
              model: lessonquizzes,
              required: false,
              attributes: ["lessonquizid", "lessonquizorder"],
              include: [
                {
                  model: lessons,
                  as: "lesson",
                  required: false,
                  attributes: ["lessonname", "lessonorder"],
                  include: [
                    {
                      model: levels,
                      as: "level",
                      required: false,
                      attributes: ["levelname", "levelorder"],
                      include: [
                        {
                          model: grades,
                          as: "grade",
                          required: false,
                          attributes: ["gradename", "gradeorder"],
                          include: [
                            {
                              model: curriculums,
                              as: "curriculum",
                              required: false,
                              attributes: ["curriculumname"],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          model: schoolusers,
          as: "schooluser",
          required: true,
          attributes: ["schoolusername", "schoolname"],
        },
        {
          model: standards,
          as: "class",
          required: false,
          attributes: ["standardname"],
        },
      ],
    });
    return progress;
  };

  getStudentLastCompletedQuiz = async (studentid: string, type: number) => {
    const student = await this.getAllStudentsWithProgress(studentid, type);
    let lastcompletedlessonquiz: students | null = null;
    if(student) {
      const groupUserProgress = student.getDataValue("studentprogresses");
      const dateofjoin = student.dateofjoin ?? new Date();
      student.setDataValue('membersince', dateofjoin.toLocaleDateString('en-ZA'));
      // number of completed lessons
      const numbercompletedlessons = await studentlessonsprogress.count({
        where: { studentid: studentid, completed: 1 }
      });
      student.setDataValue('numbercompletedlessons', numbercompletedlessons);
      if (!groupUserProgress || groupUserProgress.length <= 0) {
        lastcompletedlessonquiz = student;
      } else {
        // const sortGroupUserProgress = sortBy(groupUserProgress, 'starttime');
        const maxGradeOrder = maxBy(
          groupUserProgress,
          "lessonquiz.lesson.level.grade.gradeorder"
        );
        if (maxGradeOrder && groupUserProgress) {
          const lastGradeProgress = groupUserProgress.filter(
            (gup) =>
              gup.lessonquiz?.lesson.level.grade.gradeorder ===
              maxGradeOrder.lessonquiz?.lesson.level.grade.gradeorder
          );
          const maxLevelOrder = maxBy(
            lastGradeProgress,
            "lessonquiz.lesson.level.levelorder"
          );
          if (maxLevelOrder) {
            const lastLevelProgress = lastGradeProgress.filter(
              (gup) =>
                gup.lessonquiz?.lesson.level.levelorder ===
                maxLevelOrder.lessonquiz?.lesson.level.levelorder
            );
            const maxLessonOrder = maxBy(
              lastLevelProgress,
              "lessonquiz.lesson.lessonorder"
            );
            if (maxLessonOrder) {
              const lastLessonProgress = lastLevelProgress.filter(
                (gup) =>
                  gup.lessonquiz?.lesson.lessonorder ===
                  maxLessonOrder.lessonquiz?.lesson.lessonorder
              );
              const maxLessonQuizOrder = maxBy(
                lastLessonProgress,
                "lessonquiz.lessonquizorder"
              );
              if (maxLessonQuizOrder) {
                const lastLessonQuizProgress = lastLessonProgress.filter(
                  (gup) =>
                    gup.lessonquiz?.lessonquizorder ===
                    maxLessonQuizOrder.lessonquiz?.lessonquizorder
                );
                student.setDataValue("studentprogresses", []);
                student.setDataValue(
                  "laststudentprogress",
                  maxBy(lastLessonQuizProgress, "starttime")
                );
                lastcompletedlessonquiz = student;
              }
            }
          }
        }
      }
    }
    return lastcompletedlessonquiz;
  };
}
