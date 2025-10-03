import { BadRequestException } from "@nestjs/common";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { levels } from "src/models/data-models/levels";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { studentprogress } from "src/models/data-models/studentprogress";
import { students } from "src/models/data-models/students";
import { Token } from "src/models/token.model";
import { v4 as uuidv4 } from "uuid";
import { col, fn, literal, Op, Transaction, WhereOptions } from "sequelize";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { lessons, lessonsAttributes } from "src/models/data-models/lessons";
import { grades } from "src/models/data-models/grades";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { documents } from "src/models/data-models/documents";
import { rawfilenameextractor } from "src/services/util.service";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { addDays, startOfDay } from "date-fns";
import { studentactives } from "src/models/data-models/studentactives";
import { COMPLETED_PERCENTAGE } from "src/models/enums/constant.enum";
import { studentpoints } from "src/models/data-models/studentpoints";
import { GradeBusiness } from "./grade.business";
import { LevelBusiness } from "./level.business";
import { dbinstance } from "src/services/dbservice";
import { Logger } from "src/config";
import { lessonplans } from "src/models/data-models/lessonplan";

interface PracticeCorrectAnswer {
  iscorrect: boolean;
  question: undefined;
  lessonpracticeid: string;
  lessonpracticequestionid: string;
  questionid: string;
  tries: boolean;
}
interface QuizCorrectAnswer {
  iscorrect: boolean;
  question: undefined;
  lessonquizid: string;
  lessonquizquestionid: string;
  questionid: string;
}
interface LevelQuizCorrectAnswer {
  iscorrect: boolean;
  question: undefined;
  levelid: string;
  levelquizquestionid: string;
  questionid: number;
}

export class LessonBusiness {
  isexistsLessonID = async (lessonid: string) => {
    const where: WhereOptions<lessonsAttributes> = {
      lessonid,
      isdeleted: false,
    };
    const tempdt = await lessons.count({ where });
    return tempdt > 0;
  };
  getlessonpractice = async (lessonpracticeid: string) => {
    const lessonpractice = await lessonpractices.findOne({
      where: {
        lessonpracticeid,
      },
    });
    if (!lessonpractice)
      throw new BadRequestException("Lesson Practice Not Found");
    return lessonpractice;
  };

  getlessonquiz = async (lessonquizid: string) => {
    const lessonquiz = await lessonquizzes.findOne({
      where: {
        lessonquizid,
      },
    });
    if (!lessonquiz) throw new BadRequestException("Lesson Quiz Not Found");
    return lessonquiz;
  };

  getlevelquiz = async (levelid: string) => {
    const level = await levels.findOne({
      where: {
        levelid,
      },
    });
    if (!level) throw new BadRequestException("level Not Found");
    return level;
  };

  getlessonlearning = async (lessonlearningid: string) => {
    const lessonlearning = await lessonlearnings.findOne({
      where: {
        lessonlearningid,
      },
    });
    if (!lessonlearning)
      throw new BadRequestException("Learning Lesson Not Found");
    return lessonlearning;
  };

  getstudent = async (user: Token) => {
    const student = await students.findOne({
      where: { schooluserid: user.schooluserid },
    });
    if (!student) throw new BadRequestException("Student Not Found");
    return student;
  };

  calculatePracticeScore = async (
    lessonpracticeid: string,
    correct: PracticeCorrectAnswer[]
  ) => {
    const lessonpractice = await this.getlessonpractice(lessonpracticeid);
    const lesson = await lessonpractice.getLesson();
    const practicepoints = lesson.practices_points ?? 0;
    const marks = correct.length;
    return {
      marks,
      userpoints: lessonpractice.points,
      fullpoints: practicepoints,
      lesson,
    };
  };

  calculateQuizScore = async (
    lessonquizid: string,
    correct: QuizCorrectAnswer[]
  ) => {
    const lessonquiz = await this.getlessonquiz(lessonquizid);
    const lesson = await lessonquiz.getLesson();
    const quizpoints = (await lessonquiz.getLesson()).quizzes_points ?? 0;
    const marks = correct.length;
    return {
      marks,
      userpoints: lessonquiz.points,
      fullpoints: quizpoints,
      lesson,
    };
  };

  calculateLevelQuizScore = async (
    levelid: string,
    correct: LevelQuizCorrectAnswer[]
  ) => {
    const level = await this.getlevelquiz(levelid);
    const marks = correct.length;
    return {
      marks,
      userpoints: level.quiz_points,
      fullpoints: level.quiz_points,
      level,
    };
  };

  updatelearningprogress = async (
    lessonlearningid: string,
    progress: { content_length: number; time: number; ended: boolean, date: Date },
    user: Token, 
  ) => {
    const lessonlearning = await this.getlessonlearning(lessonlearningid);
    const student = await this.getstudent(user);
    let learningprogress = await studentlearningprogress.findOne({
      where: {
        studentid: student.studentid,
        lessonlearningid,
      },
    });
    if (progress.content_length <= 0)
      throw new BadRequestException("Content Lenght can not equal 0");
    let oldpoints: number | null = null;
    const transaction = await dbinstance.getdbinstance().transaction();
    try {
      if (!learningprogress) {
        learningprogress = await studentlearningprogress.create({
          studentlearningprogressid: uuidv4(),
          studentid: student.studentid,
          lessonlearningid,
          content_length: progress.content_length,
          progress_percentage: Number(
            ((progress.time * 100) / progress.content_length).toFixed(2)
          ),
          progress: progress.time,
          viewed: progress.ended ? 1 : 0,
          points: progress.ended ? lessonlearning.points : 0,
          lastupdated: progress.date
        }, {transaction});
      } else {
        learningprogress.progress = progress.time;
        learningprogress.content_length = progress.content_length;
        oldpoints = (learningprogress.viewed > 0 || progress.ended) && (learningprogress.points !== lessonlearning.points) ? learningprogress.points : null;
        learningprogress.points =
          learningprogress.viewed > 0 || progress.ended
            ? lessonlearning.points
            : 0;
        learningprogress.progress_percentage = Number(
          ((progress.time * 100) / progress.content_length).toFixed(2)
        );
        learningprogress.viewed += progress.ended ? 1 : 0; // view increase
        learningprogress.lastupdated = progress.date;
        await learningprogress.save({
          fields: [
            "progress",
            "content_length",
            "progress_percentage",
            "viewed",
            "lastupdated",
            "points",
          ], transaction});
      }
      if (oldpoints !== null || (learningprogress.viewed === 1 && progress.ended)) { // when progress.ended true view always increase so check like this is okay
        if (lessonlearning) {
          await this.updateUserReward(
            user,
            lessonlearning?.lessonid,
            lessonlearning?.points,
            oldpoints,
            transaction,
            progress.date
          );
        }
      }
      await this.setstudentactive(user, lessonlearning.lessonlearningid, 1, transaction, progress.date);
      await transaction.commit();
      if(progress.ended){
        await this.addstudentscores(user, lessonlearning.lessonid, progress.date, 0);
      }
      await this.updateuserdailypoints(lessonlearning.lessonid, user, progress.date);
    } catch(err: any) {
      await transaction.rollback();
      throw new BadRequestException({
        error: true,
        errormessage: err?.response?.errormessage || err.message,
      });
    }
  };

  getlearningprogress = async (lessonlearningid: string, user: Token) => {
    const student = await this.getstudent(user);
    const learningprogress = await studentlearningprogress.findOne({
      where: {
        studentid: student.studentid,
        lessonlearningid,
      },
      // include: {
      //     model: lessonlearnings,
      //     as: "lessonlearning",
      //     attributes: ["lessonlearningid"],
      // }
    });
    return learningprogress;
  };

  getlearninglesson = async (lessonlearningid: string, user: Token) => {
    lessonlearnings.hasOne(studentlearningprogress, {
      foreignKey: "lessonlearningid",
      sourceKey: "lessonlearningid",
    });
    studentlearningprogress.belongsTo(lessonlearnings, {
      foreignKey: "lessonlearningid",
    });
    const lessonlearning = await lessonlearnings.findOne({
      where: {
        lessonlearningid,
      },
      include: {
        where: {
          lessonlearningid,
          studentid: user.studentid,
        },
        model: studentlearningprogress,
        required: false,
      },
    });
    if (lessonlearning) {
      const learningdocuments = await documents.findOne({
        where: {
          documentid: lessonlearning.documentid,
        },
      });
      lessonlearning.setDataValue(
        "lessonlearningfileobject",
        rawfilenameextractor(learningdocuments?.documentname ?? "")
      );
    }
    return lessonlearning;
  };

  getalllearningprogress = async (lessonid: string, user: Token) => {
    const student = await this.getstudent(user);
    const learningprogress = await studentlearningprogress.findAll({
      where: {
        studentid: student.studentid,
      },
      // include: {
      //     model: lessonlearnings,
      //     as: "lessonlearning",
      //     attributes: ["lessonlearningid"],
      //     where: { lessonid }
      // }
    });
    const filteredlnprogess = [];
    for await (const lnprogress of learningprogress) {
      const lessonlearning = await lessonlearnings.findOne({
        where: {
          lessonlearningid: lnprogress.lessonlearningid,
          lessonid,
        },
      });
      if (lessonlearning) {
        filteredlnprogess.push(lnprogress);
      }
    }
    return filteredlnprogess;
  };

  getpracicespoints = async (lesson: any, user?: Token) => {
    const practiceprogress = await lessonpractices.findAll({
      where: { lessonid: lesson.lessonid },
    });
    const practices = practiceprogress.map((practice) =>
      practice.get({ plain: true })
    );
    let practicepoints = 0;
    for await (const practice of practices) {
      const stp = await studentprogress.findAll({
        where: {
          studentprogressreferenceid: practice.lessonpracticeid,
          studentid: user?.studentid,
        },
        attributes: [[fn("sum", col("points")), "points"]],
      });
      practicepoints += +stp[0]?.points ?? 0;
    }
    return practicepoints;
  };

  getquizzespoints = async (lesson: any, user?: Token) => {
    const quizprogress = await lessonquizzes.findAll({
      where: { lessonid: lesson.lessonid },
    });
    const quizzes = quizprogress.map((practice) =>
      practice.get({ plain: true })
    );
    let quizpoints = 0;
    for await (const quiz of quizzes) {
      const stp = await studentprogress.findAll({
        where: {
          studentprogressreferenceid: quiz.lessonquizid,
          studentid: user?.studentid,
        },
        attributes: [[fn("sum", col("points")), "points"]],
      });
      quizpoints += +stp[0]?.points ?? 0;
    }
    return quizpoints;
  };

  getlearningpoints = async (lesson: any, user?: Token) => {
    if (user && lesson.lessonid) {
      const learningprogress = await this.getalllearningprogress(
        lesson.lessonid,
        user
      );
      const lslearnings = await lessonlearnings.findAll({
        where: {
          lessonid: lesson.lessonid,
        },
      });
      if (!lslearnings || lslearnings.length <= 0) return 0;
      const singlepoint = +lesson.learning_points / lslearnings.length ?? 0;
      return Math.ceil(learningprogress.length * singlepoint);
    }
    return 0;
  };

  getlessonprogress = async (lesson: any, user?: Token) => {
    let userpoints = 0;
    const practicepoints = await this.getpracicespoints(lesson, user);
    const quizpoints = await this.getquizzespoints(lesson, user);
    const learningpoints = await this.getlearningpoints(lesson, user);
    userpoints = practicepoints + quizpoints + learningpoints;
    return userpoints;
  };

  getlevellearning = async (levelid: string, user?: Token) => {
    const levellearning = await studentprogress.findOne({
      where: {
        studentprogressreferenceid: levelid,
        studentid: user?.studentid,
      },
    });
    if (!levellearning) return null;
    return levellearning;
  };

  getlevelprogress = async (level: any, user?: Token) => {
    let levelpoints = 0;
    let lessonpoints = 0;
    for await (const lesson of level.lessons) {
      lessonpoints += await this.getlessonprogress(lesson, user);
    }
    const levelpoint = await this.getlevellearning(level.levelid, user);
    levelpoints = (lessonpoints ?? 0) + (levelpoint?.points ?? 0);
    return levelpoints;
  };

  getgradeprogress = async (grade: any, user?: Token) => {
    let gradepoints = 0;
    for await (const level of grade.levels) {
      gradepoints += await this.getlevelprogress(level, user);
    }
    return gradepoints;
  };

  updateUserReward = async (user: Token, lessonid: string, points: number, oldpoints: number | null = null, transaction: Transaction, currentdate: Date) => {
    if(oldpoints) {
      points = points - oldpoints;
    }
    const lesson = await lessons.findOne({
      where: { lessonid },
      include: {
        model: levels,
        required: true,
        as: "level",
        attributes: ["levelid", "gradeid", "points"],
      },
    });
    if (lesson && lesson.level && user.studentid) {
      let lessonprogress = await studentlessonsprogress.findOne({
        where: { lessonid, studentid: user.studentid },
      });
      const grade = await grades.findOne({
        where: { gradeid: lesson.level?.gradeid },
      });
      if(grade) {
        if (!lessonprogress) {
          const lsp = points >= 0 ? (Number((points*100/lesson.total_points).toFixed(2)) ?? 0) : 0;
          lessonprogress = await studentlessonsprogress.create({
            studentlessonprogressid: uuidv4(),
            studentid: user.studentid,
            lessonid,
            levelid: lesson.level.levelid,
            gradeid: grade.gradeid,
            curid: grade.curriculumid,
            points: points >= 0 ? points : 0,
            progress: lsp,
            completed: points >= 0 && Number((points*100/lesson.total_points).toFixed(2)) > COMPLETED_PERCENTAGE ? true : false,
            scores: 0,
            lastupdated: currentdate
          }, {transaction});
        } else {
          lessonprogress.points += (points < 0 && lessonprogress.points + points < 0) ? 0 : points;
          if(lessonprogress.points > 100) {
            // exceed limit
            lessonprogress.points = 100;
            points = 0;
          }
          const lsp = Number((lessonprogress.points*100/lesson.total_points).toFixed(2)) ?? 0;
          lessonprogress.progress = lsp;
          lessonprogress.completed = lessonprogress.progress > COMPLETED_PERCENTAGE ? true : false;
          lessonprogress.lastupdated = currentdate;
          await lessonprogress.save({ fields: ["points", "progress", "completed", "lastupdated"], transaction});
        }
        let levelprogress = await studentlevelsprogress.findOne({
          where: { levelid: lesson.level.levelid, studentid: user.studentid },
        });
        if (!levelprogress) {
          levelprogress = await studentlevelsprogress.create({
            studentlevelprogressid: uuidv4(),
            studentid: user.studentid,
            levelid: lesson.level.levelid,
            gradeid: grade.gradeid,
            curid: grade.curriculumid,
            points: points >= 0 ? points : 0,
            progress: points >= 0 ? (Number((points*100/lesson.level.points).toFixed(2)) ?? 0) : 0,
            completed: points >= 0 && Number((points*100/lesson.level.points).toFixed(2)) > COMPLETED_PERCENTAGE ? true : false,
            scores: 0,
            lastupdated: currentdate
          }, {transaction});
        } else {
          levelprogress.points += (points < 0 && levelprogress.points + points < 0) ? 0 : points;
          levelprogress.progress = Number((levelprogress.points*100/lesson.level.points).toFixed(2)) ?? 0;
          levelprogress.completed = levelprogress.progress > COMPLETED_PERCENTAGE ? true : false;
          levelprogress.lastupdated = currentdate;
          await levelprogress.save({ fields: ["points", "progress", "completed", "lastupdated"], transaction});
        }
        const gradeprogress = await studentgradesprogress.findOne({
          where: { gradeid: grade.gradeid, studentid: user.studentid },
        });
        if (!gradeprogress) {
          await studentgradesprogress.create({
            studentgradeprogressid: uuidv4(),
            studentid: user.studentid,
            gradeid: grade.gradeid,
            curriculumid: grade.curriculumid,
            points: points >= 0 ? points : 0,
            progress: points >= 0 ? (Number((points*100/grade.points).toFixed(2)) ?? 0) : 0,
            completed: points >= 0 && Number((points*100/grade.points).toFixed(2)) > COMPLETED_PERCENTAGE ? true : false,
            scores: 0,
            lastupdated: currentdate
          }, {transaction});
        } else {
          gradeprogress.points += (points < 0 && gradeprogress.points + points < 0) ? 0 : points;
          gradeprogress.progress = Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0;
          gradeprogress.completed = gradeprogress.progress > COMPLETED_PERCENTAGE ? true : false;
          gradeprogress.lastupdated = currentdate;
          await gradeprogress.save({ fields: ["points", "progress", "completed", "lastupdated"], transaction});
        }
      }
    }
  };

  updateLevelQuizReward = async (user: Token, level: levels, oldpoints: number | null = null, transaction: Transaction, currentdate: Date) => {
    let points = level.quiz_points ?? 0;
    if(oldpoints) {
      points = level.quiz_points - oldpoints;
    }
    const levelprogress = await studentlevelsprogress.findOne({
      where: { levelid: level.levelid, studentid: user.studentid },
    });
    const grade = await grades.findOne({
      where: { gradeid: level.gradeid },
    });
    if(level && grade && user.studentid) {
      if (!levelprogress) {
        await studentlevelsprogress.create({
          studentlevelprogressid: uuidv4(),
          studentid: user.studentid,
          levelid: level.levelid,
          gradeid: grade.gradeid,
          curid: grade.curriculumid,
          points: points > 0 ? points : 0,
          progress: points > 0 ? (Number((points*100/level.points).toFixed(2)) ?? 0) : 0,
          completed: points > 0 && Number((points*100/level.points).toFixed(2)) > COMPLETED_PERCENTAGE ? true : false,
          lastupdated: currentdate
        }, {transaction});
      } else {
        levelprogress.points += (points < 0 && levelprogress.points + points < 0) ? 0 : points;
        levelprogress.progress = Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0;
        levelprogress.completed = levelprogress.progress > COMPLETED_PERCENTAGE ? true : false;
        levelprogress.lastupdated = currentdate;
        await levelprogress.save({ fields: ["points", "progress", "completed", "lastupdated"], transaction});
      }
      const gradeprogress = await studentgradesprogress.findOne({
        where: { gradeid: grade.gradeid, studentid: user.studentid },
      });
      if (!gradeprogress) {
        await studentgradesprogress.create({
          studentgradeprogressid: uuidv4(),
          studentid: user.studentid,
          gradeid: grade.gradeid,
          curriculumid: grade.curriculumid,
          points: points > 0 ? points : 0,
          progress: points > 0 ? (Number((points*100/grade.points).toFixed(2)) ?? 0) : 0,
          completed: points > 0 && Number((points*100/grade.points).toFixed(2)) > COMPLETED_PERCENTAGE ? true : false,
          lastupdated: currentdate
        }, {transaction});
      } else {
        gradeprogress.points += (points < 0 && gradeprogress.points + points < 0) ? 0 : points;
        gradeprogress.progress = Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0;
        gradeprogress.completed = gradeprogress.progress > COMPLETED_PERCENTAGE ? true : false;
        gradeprogress.lastupdated = currentdate;
        await gradeprogress.save({ fields: ["points", "progress", "completed", "lastupdated"], transaction});
      }
    }
  };

  getlessonsbylevelid = async (levelid: string, user: Token) => {
    lessons.hasMany(studentlessonsprogress, { foreignKey: "lessonid" });
    studentlessonsprogress.belongsTo(lessons, { foreignKey: "lessonid" });
    levels.hasMany(studentprogress, { foreignKey: "studentprogressreferenceid" });
    studentprogress.belongsTo(levels, { foreignKey: "studentprogressreferenceid" });
    const levelquizques = await levelquizquestions.count({
      where: {
        levelid,
        levelquizquestionstatus: true
      },
    });
    let levelprogress: levels | null = null;
    if(levelquizques){
      levelprogress = await levels.findOne({
        where: { levelid, levelstatus: true },
        attributes: ['levelid','levelname', 'leveldescription'],
        include: [
          {
            model: studentprogress,
            required: false,
            where: { studentid: user.studentid },
            attributes: ['points']
          }
        ]
      });
      let progress = 0;
      if(levelprogress){
        const stup = levelprogress.getDataValue('studentprogresses');
        if(stup && stup.length > 0) {
          progress = 100;
        }
        levelprogress.setDataValue("progress", progress);
      }
    }
    let ls = await lessons.findAll({
      where: { levelid, lessonstatus: true, isdeleted: false },
      include: {
        model: studentlessonsprogress,
        required: false,
        where: { studentid: user.studentid },
        attributes: ["points", "completed"],
      },
    });
    ls = ls.map((lesson: lessons) => {
      const studentlessonsprogress = lesson.getDataValue("studentlessonsprogresses");
      let progress = 0;
      if(studentlessonsprogress && studentlessonsprogress[0]?.points){
        progress = Number(Number(studentlessonsprogress[0]?.points*100/lesson.total_points).toFixed(2));
      }
      lesson.setDataValue("progress", progress);
      return lesson;
    });
    return {
      lesson: ls,
      level_has_quiz: levelquizques > 0 ? true : false,
      level: levelprogress ? levelprogress : null
    };
  };

  getlessonbricks = async (lessonid: string, user: Token) => {
    // lesson learning
    lessons.hasMany(lessonlearnings, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    lessonlearnings.belongsTo(lessons, {
      foreignKey: "lessonid",
    });

    // lesson practice
    lessons.hasMany(lessonpractices, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    lessonpractices.belongsTo(lessons, {
      foreignKey: "lessonid",
    });

    // lesson quiz
    lessons.hasMany(lessonquizzes, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    lessonquizzes.belongsTo(lessons, {
      foreignKey: "lessonid",
    });

    // lesson plan
    lessons.hasMany(lessonplans, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    lessonplans.belongsTo(lessons, {
      foreignKey: "lessonid",
    });

    const includeoption: any = [
      {
        where: {
          lessonid: { [Op.ne]: null },
          lessonlearningstatus: true,
        },
        model: lessonlearnings,
        required: false,
        order: [["lessonlearningorder", "ASC"]],
        attributes: [
          "lessonlearningid",
          "lessonlearningname",
          "lessonlearningorder",
        ],
      },
      {
        where: {
          lessonpracticeid: { [Op.ne]: null },
          lessonpracticestatus: true,
        },
        required: false,
        model: lessonpractices,
        order: [["lessonpracticeorder", "ASC"]],
        attributes: [
          "lessonpracticeid",
          "lessonpracticename",
          "lessonpracticeorder",
        ],
      },
      {
        where: {
          lessonquizid: { [Op.ne]: null },
          lessonquizstatus: true,
        },
        required: false,
        model: lessonquizzes,
        order: [["lessonquizorder", "ASC"]],
        attributes: ["lessonquizid", "lessonquizname", "lessonquizorder"],
      },
    ];
    if(user.is_teacher_acc) {
      includeoption.push({
        where: {
          lessonid: { [Op.ne]: null },
          lessonplanstatus: true,
        },
        model: lessonplans,
        required: false,
        order: [["lessonplanorder", "ASC"]],
        attributes: [
          "lessonplanid",
          "lessonplanname",
          "lessonplanorder",
        ],
      })
    }

    const lslnptq = await lessons.findOne({
      where: { lessonid, lessonstatus: true, isdeleted: false },
      attributes: {
        exclude: [],
      },
      include: includeoption,
    });
    return lslnptq;
  };

  getuserlessonprogress = async (lessonid: string, user: Token) => {
    lessonlearnings.hasOne(studentlearningprogress, {
      foreignKey: "lessonlearningid",
      sourceKey: "lessonlearningid",
    });
    studentlearningprogress.belongsTo(lessonlearnings, {
      foreignKey: "lessonlearningid",
    });
    const lesson = await lessons.findOne({
      where: { lessonid, lessonstatus: true, isdeleted: false },
      attributes: [
        "lessonid",
        "lessonname",
        "lessondescription",
        [
          fn("SUM", col("lessonlearnings.studentlearningprogress.points")),
          "student_learning_points",
        ],
        [
          fn(
            "COUNT",
            col(
              "lessonlearnings.studentlearningprogress.studentlearningprogressid"
            )
          ),
          "number_completed_learnings",
        ],
      ],
      include: [
        {
          model: levels,
          as: "level",
          attributes: ["levelid", "levelname"],
          include: [
            {
              model: grades,
              as: "grade",
              attributes: ["gradeid", "gradename"],
            },
          ],
        },
        {
          model: lessonlearnings,
          as: "lessonlearnings",
          required: false,
          attributes: [],
          where: { lessonlearningstatus: true },
          include: [
            {
              model: studentlearningprogress,
              as: "studentlearningprogress",
              required: false,
              where: {
                studentid: user.studentid,
                viewed: { [Op.gt]: 0 },
              },
              attributes: [],
            },
          ],
        },
      ],
    });
    lessonpractices.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonpracticeid",
    });
    studentprogress.belongsTo(lessonpractices, {
      foreignKey: "studentprogressreferenceid",
    });
    const practices = await lessonpractices.findAll({
      where: {
        lessonid,
        lessonpracticestatus: true
      },
      attributes: [],
      include: {
        model: studentprogress,
        required: true,
        where: {
          studentid: user.studentid,
        },
        order: [["studentprogress.starttime", "DESC"]],
        attributes: ["points", "starttime"],
      },
    });
    let student_practice_points = 0;
    practices.forEach((practice) => {
      const studentprogresses = practice.getDataValue("studentprogresses") ?? [];
      const latestprogress = studentprogresses.reduce((a, b) => {
        return new Date(a.starttime) > new Date(b.starttime) ? a : b;
      });
      student_practice_points +=
        studentprogresses.length > 0 ? latestprogress.points : 0;
    });
    lessonquizzes.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonquizid",
    });
    studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
    });
    const quizzes = await lessonquizzes.findAll({
      where: {
        lessonid,
        lessonquizstatus: true
      },
      attributes: [],
      include: {
        model: studentprogress,
        required: true,
        where: {
          studentid: user.studentid,
        },
        order: [["studentprogress.endtime", "DESC"]],
        attributes: ["points", "endtime"],
      },
    });
    let student_quiz_points = 0;
    quizzes.forEach((quiz) => {
      const studentprogresses = quiz.getDataValue("studentprogresses") ?? [];
      const latestprogress = studentprogresses.reduce((a, b) => {
        return new Date(a.starttime) > new Date(b.starttime) ? a : b;
      });
      student_quiz_points +=
        studentprogresses.length > 0 ? latestprogress.points : 0;
    });
    const number_completed_practices = practices.length ?? 0;
    const number_completed_quizzes = quizzes.length ?? 0;
    const number_learnings = await lessonlearnings.count({
      where: {
        lessonid,
        lessonlearningstatus: true
      },
    });
    const number_practices = await lessonpractices.count({
      where: {
        lessonid,
        lessonpracticestatus: true
      },
    });
    const number_quizzes = await lessonquizzes.count({
      where: {
        lessonid,
        lessonquizstatus: true
      },
    });
    lesson?.setDataValue(
      "student_learning_points",
      Number(lesson.getDataValue("student_learning_points"))
    );
    lesson?.setDataValue(
      "student_practice_points",
      Number(student_practice_points)
    );
    lesson?.setDataValue("student_quiz_points", Number(student_quiz_points));
    lesson?.setDataValue(
      "number_completed_practices",
      Number(number_completed_practices)
    );
    lesson?.setDataValue(
      "number_completed_quizzes",
      Number(number_completed_quizzes)
    );
    lesson?.setDataValue("number_learnings", Number(number_learnings));
    lesson?.setDataValue("number_practices", Number(number_practices));
    lesson?.setDataValue("number_quizzes", Number(number_quizzes));
    return { lesson };
  };

  getuserlessonsprogress = async (levelid: string, user: Token) => {
    lessonlearnings.hasOne(studentlearningprogress, {
      foreignKey: "lessonlearningid",
      sourceKey: "lessonlearningid",
    });
    studentlearningprogress.belongsTo(lessonlearnings, {
      foreignKey: "lessonlearningid",
    });
    lessons.hasMany(studentlessonsprogress, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    studentlessonsprogress.belongsTo(lessons, {
      foreignKey: "lessonid",
    });
    lessonpractices.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonpracticeid",
    });
    studentprogress.belongsTo(lessonpractices, {
      foreignKey: "studentprogressreferenceid",
    });
    lessonquizzes.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonquizid",
    });
    studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
    });
    const alllessons = await lessons.findAll({
      where: { levelid, lessonstatus: true, isdeleted: false },
      attributes: [
        "lessonid",
      ],
    });
    const lessonsresult: lessons[] = [];
    let total_points = 0;
    for (const lesson of alllessons) {
      const ls = await this.getuserlessoncompletedprogress(lesson.lessonid, user);
      if(ls){
        // const student_learning_points = ls.getDataValue('student_learning_points');
        // const student_practice_points = ls.getDataValue('student_practice_points');
        // const student_quiz_points = ls.getDataValue('student_quiz_points');
        // if(student_learning_points) {
        //   total_points += student_learning_points ?? 0;
        // }
        // if(student_practice_points) {
        //   total_points += student_practice_points ?? 0;
        // }
        // if(student_quiz_points) {
        //   total_points += student_quiz_points ?? 0;
        // }
        total_points += ls.getDataValue('student_scores') ?? 0;
        lessonsresult.push(ls);
      } else {
        lessonsresult.push(lesson);
      }
    }
    levels.hasMany(studentprogress, { foreignKey: "studentprogressreferenceid" });
    studentprogress.belongsTo(levels, { foreignKey: "studentprogressreferenceid" });
    const levelquizques = await levelquizquestions.count({
      where: {
        levelid,
        levelquizquestionstatus: true
      },
    });
    let levelprogress: levels | null = null;
    if(levelquizques){
      levelprogress = await levels.findOne({
        where: { levelid, levelstatus: true },
        attributes: ['levelid','levelname', 'leveldescription'],
        include: [
          {
            model: studentprogress,
            required: false,
            where: { studentid: user.studentid },
            attributes: ['points', 'scores', 'starttime', 'ispass']
          },
        ]
      });
      let progress = 0;
      if(levelprogress){
        const stup = levelprogress.getDataValue('studentprogresses');
        let latestprogress: studentprogress | null = null;
        if(stup && stup.length > 0) {
          progress = 100;
          // get record
          latestprogress = stup.reduce((a, b) => {
            return new Date(a.starttime) > new Date(b.starttime) ? a : b;
          });
        }
        levelprogress.setDataValue("level_quiz_total_scores", latestprogress ? latestprogress.scores + 1 : 0); // add 1 for reward points
        levelprogress.setDataValue("level_quiz_reward", latestprogress ? 1 : 0);
        levelprogress.setDataValue("level_quiz_scores", latestprogress?.ispass ? latestprogress.scores : 0);
        levelprogress.setDataValue("progress", progress);
        total_points += latestprogress ? latestprogress.scores + 1 : 0;
      }
    }
    return { lessonsresult, total_points, level: levelprogress };
  }

  getuserlessoncompletedprogress = async (lessonid: string, user: Token) => {
    const lesson = await lessons.findOne({
      where: { lessonid, lessonstatus: true, isdeleted: false },
      attributes: [
        "lessonid",
        "lessonname",
        "lessonorder",
        "lessondescription",
        "learning_points",
        "practices_points",
        "quizzes_points",
        [
          fn("SUM", col("lessonlearnings.studentlearningprogress.points")),
          "student_learning_points",
        ],
        [
          fn(
            "COUNT",
            col(
              "lessonlearnings.studentlearningprogress.studentlearningprogressid"
            )
          ),
          "number_completed_learnings",
        ],
      ],
      include: [
        {
          model: lessonlearnings,
          as: "lessonlearnings",
          required: false,
          attributes: [],
          where: { lessonlearningstatus: true },
          include: [
            {
              model: studentlearningprogress,
              as: "studentlearningprogress",
              required: false,
              where: {
                studentid: user.studentid,
                viewed: { [Op.gt]: 0 },
              },
              attributes: [],
            },
          ],
        },
      ],
    });
    const studentscores = await studentlessonsprogress.findOne({
      where: {studentid: user.studentid, lessonid},
      attributes: ['scores', 'added_completed_scores']
    });
    const practices = await lessonpractices.findAll({
      where: {
        lessonid,
        lessonpracticestatus: true
      },
      attributes: [],
      include: {
        model: studentprogress,
        required: true,
        where: {
          studentid: user.studentid,
        },
        order: [["studentprogress.starttime", "DESC"]],
        attributes: ["points", "starttime"],
      },
    });
    let student_practice_points = 0;
    practices.forEach((practice) => {
      const studentprogresses = practice.getDataValue("studentprogresses") ?? [];
      const latestprogress = studentprogresses.reduce((a, b) => {
        return new Date(a.starttime) > new Date(b.starttime) ? a : b;
      });
      student_practice_points +=
        studentprogresses.length > 0 ? latestprogress.points : 0;
    });
    const quizzes = await lessonquizzes.findAll({
      where: {
        lessonid,
        lessonquizstatus: true
      },
      attributes: [],
      include: {
        model: studentprogress,
        required: true,
        where: {
          studentid: user.studentid,
        },
        order: [["studentprogress.starttime", "DESC"]],
        attributes: ["points", "starttime"],
      },
    });
    let student_quiz_points = 0;
    quizzes.forEach((quiz) => {
      const studentprogresses = quiz.getDataValue("studentprogresses") ?? [];
      const latestprogress = studentprogresses.reduce((a, b) => {
        return new Date(a.starttime) > new Date(b.starttime) ? a : b;
      });
      student_quiz_points +=
        studentprogresses.length > 0 ? latestprogress.points : 0;
    });
    const number_completed_practices = practices.length ?? 0;
    const number_completed_quizzes = quizzes.length ?? 0;
    const number_learnings = await lessonlearnings.count({
      where: {
        lessonid,
        lessonlearningstatus: true
      },
    });
    const number_practices = await lessonpractices.count({
      where: {
        lessonid,
        lessonpracticestatus: true
      },
    });
    const number_quizzes = await lessonquizzes.count({
      where: {
        lessonid,
        lessonquizstatus: true
      },
    });
    lesson?.setDataValue(
      "student_learning_points",
      Number(lesson.getDataValue("student_learning_points"))
    );
    lesson?.setDataValue(
      "student_practice_points",
      Number(student_practice_points)
    );
    lesson?.setDataValue("student_quiz_points", Number(student_quiz_points));
    lesson?.setDataValue(
      "number_completed_practices",
      Number(number_completed_practices)
    );
    lesson?.setDataValue(
      "number_completed_quizzes",
      Number(number_completed_quizzes)
    );
    lesson?.setDataValue("number_learnings", Number(number_learnings));
    lesson?.setDataValue("number_practices", Number(number_practices));
    lesson?.setDataValue("number_quizzes", Number(number_quizzes));
    lesson?.setDataValue("student_scores", studentscores ? Number(studentscores.scores) : 0);
    lesson?.setDataValue("added_completed_scores", studentscores && studentscores.added_completed_scores ? 1 : 0);
    let quiz_scores = 0;
    if(studentscores) {
      quiz_scores = studentscores.added_completed_scores ? studentscores.scores - 1 : studentscores.scores;
      if((!quiz_scores || quiz_scores <= 0)) quiz_scores = 0;
    }
    lesson?.setDataValue("quiz_scores", quiz_scores);
    return lesson;
  }

  setstudentactive = async (user: Token, referenceid: string, referencetype: number, transaction: Transaction, currentdate: Date) => {
    const today = startOfDay(currentdate);
    const tomorrow = startOfDay(addDays(currentdate, 1));
    const active = await studentactives.findOne({
      where: {
        referenceid,
        studentid: user.studentid,
        created_at: {
          [Op.between]: [today, tomorrow]
        }
      }
    });
    if(!active && user.studentid) {
      await studentactives.create({
        studentactiveid: uuidv4(),
        studentid: user.studentid,
        referenceid,
        referencetype,
        created_at: currentdate
      }, {transaction});
    }
    return active;
  }

  updateuserdailypoints = async (lessonid: string, user: Token, currentdate: Date) => {
    lessonlearnings.hasOne(studentlearningprogress, {
      foreignKey: "lessonlearningid",
      sourceKey: "lessonlearningid",
    });
    studentlearningprogress.belongsTo(lessonlearnings, {
      foreignKey: "lessonlearningid",
    });
    lessons.hasMany(studentlessonsprogress, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    studentlessonsprogress.belongsTo(lessons, {
      foreignKey: "lessonid",
    });
    lessonpractices.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonpracticeid",
    });
    studentprogress.belongsTo(lessonpractices, {
      foreignKey: "studentprogressreferenceid",
    });
    lessonquizzes.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonquizid",
    });
    studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
    });
    const today = startOfDay(currentdate);
    const tomorrow = startOfDay(addDays(currentdate, 1));
    const lesson = await lessons.findOne({
      where: { lessonid },
      attributes: ['lessonid'],
      include: [
        {
          model: levels,
          as: 'level',
          required: true,
          where: { levelstatus: true, isdeleted: false },
          attributes: ['levelid'],
          include: [{
            model: grades,
            as: 'grade',
            required: true,
            where: { gradestatus: true, isdeleted: false },
            attributes: ['gradeid'],
          }]
        }
      ]
    });
    const stpoints = await studentpoints.findOne({
      where: {
        lessonid,
        studentid: user.studentid,
        created_at: {
          [Op.between]: [today, tomorrow]
        }
      }
    });
    if(lesson && lesson.level && lesson.level.grade) {
      const grade = await new GradeBusiness().getgradeprogressbygradeid(lesson.level.grade.gradeid, user);
      const level = await new LevelBusiness().getlevelbylevelid(lesson.level.levelid, user);
      const ls = await this.getuserlessoncompletedprogress(lessonid, user);
      let total_points = 0;
      if(ls) {
        const student_learning_points = ls.getDataValue('student_learning_points') ?? 0;
        const student_practice_points = ls.getDataValue('student_practice_points') ?? 0;
        const student_quiz_points = ls.getDataValue('student_quiz_points') ?? 0;
        const student_scores = ls.getDataValue('student_scores') ?? 0;
        total_points += student_learning_points + student_practice_points + student_quiz_points;
        if(
          grade &&
          level &&
          grade.studentgradesprogresses &&
          level.studentlevelsprogresses
        ) {
          const gradeprogress = grade.studentgradesprogresses[0] ?? null;
          const levelprogress = level.studentlevelsprogresses[0] ?? null;
          const haslevelquiz = await studentprogress.findOne({
            where: { studentid: user.studentid, studentprogressreferenceid: lesson.level.levelid }
          })
          if(!stpoints) {
            await studentpoints.create({
              studentpointid: uuidv4(),
              studentid: user.studentid,
              levelid: level.levelid,
              lessonid,
              gradepoints: gradeprogress ? (Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0) : 0,
              totalgradepoints: grade.points ?? 0,
              levelpoints: levelprogress ? (Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0) : 0,
              totallevelpoints: level.points ?? 0,
              levelquizscores: haslevelquiz ? haslevelquiz.scores + 1 : 0,
              lessonpoints: total_points,
              learningpoints: student_learning_points,
              practicepoints: student_practice_points,
              quizpoints: student_quiz_points,
              totallearningpoints: ls.learning_points ?? 0,
              totalpracticepoints: ls.practices_points ?? 0,
              totalquizpoints: ls.quizzes_points ?? 0,
              scores: student_scores,
              created_at: currentdate
            });
          } else {
            stpoints.totalgradepoints =  grade.points ?? 0;
            stpoints.gradepoints = gradeprogress ? (Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0) : 0;
            stpoints.totallevelpoints =  level.points ?? 0;
            stpoints.levelpoints = levelprogress ? (Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0) : 0;
            stpoints.levelquizscores = haslevelquiz ? haslevelquiz.scores + 1 : 0;
            stpoints.lessonpoints = total_points;
            stpoints.learningpoints = student_learning_points;
            stpoints.practicepoints = student_practice_points;
            stpoints.quizpoints = student_quiz_points;
            stpoints.totallearningpoints = ls.learning_points ?? 0;
            stpoints.totalpracticepoints = ls.practices_points ?? 0;
            stpoints.totalquizpoints = ls.quizzes_points ?? 0;
            stpoints.scores = student_scores;
            await stpoints.save({ fields :
              [
                'totalgradepoints', 
                'gradepoints', 
                'totallevelpoints', 
                'levelpoints',
                'levelquizscores', 
                'lessonpoints',
                'learningpoints',
                'practicepoints',
                'quizpoints',
                'totallearningpoints',
                'totalpracticepoints',
                'totalquizpoints',
                'scores'
            ]});
          }
          await studentpoints.update({
            gradepoints: gradeprogress ? (Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0) : 0,
            totalgradepoints: grade.points ?? 0,
            levelpoints: levelprogress ? (Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0) : 0,
            totallevelpoints: level.points ?? 0,
          },
          {
            where: {
              levelid: level.levelid,
              studentid: user.studentid,
              created_at: {
                [Op.between]: [today, tomorrow]
              }
            }
          });
        } else {
          Logger.error("Error updateuserdailypointsBylevelquiz functions");
          throw Error("Internal Error");
        }
      }
    }
  }

  updateuserdailypointsBylevelquiz = async (levelid: string, user: Token, currentdate: Date) => {
    lessonlearnings.hasOne(studentlearningprogress, {
      foreignKey: "lessonlearningid",
      sourceKey: "lessonlearningid",
    });
    studentlearningprogress.belongsTo(lessonlearnings, {
      foreignKey: "lessonlearningid",
    });
    lessons.hasMany(studentlessonsprogress, {
      foreignKey: "lessonid",
      sourceKey: "lessonid",
    });
    studentlessonsprogress.belongsTo(lessons, {
      foreignKey: "lessonid",
    });
    lessonpractices.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonpracticeid",
    });
    studentprogress.belongsTo(lessonpractices, {
      foreignKey: "studentprogressreferenceid",
    });
    lessonquizzes.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "lessonquizid",
    });
    studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
    });
    const today = startOfDay(currentdate);
    const tomorrow = startOfDay(addDays(currentdate, 1));
    const lvl = await levels.findOne({
      where: { levelid },
      attributes: ['levelid'],
      include: [
        {
          model: grades,
          as: 'grade',
          required: true,
          where: { gradestatus: true, isdeleted: false },
          attributes: ['gradeid'],
        },
        {
          model: lessons,
          as: 'lessons',
          required: false,
          where: { lessonstatus: true, isdeleted: false },
          attributes: ['lessonid'],
        }
      ]
    });
    if(lvl) {
      for await (const lesson of lvl?.lessons) {
        const lessonid = lesson.lessonid;
        const stpoints = await studentpoints.findOne({
          where: {
            lessonid,
            studentid: user.studentid,
            created_at: {
              [Op.between]: [today, tomorrow]
            }
          }
        });
        if(lesson && lvl && lvl.grade) {
          const grade = await new GradeBusiness().getgradeprogressbygradeid(lvl.grade.gradeid, user);
          const level = await new LevelBusiness().getlevelbylevelid(lvl.levelid, user);
          const ls = await this.getuserlessoncompletedprogress(lessonid, user);
          let total_points = 0;
          if(ls) {
            const student_learning_points = ls.getDataValue('student_learning_points') ?? 0;
            const student_practice_points = ls.getDataValue('student_practice_points') ?? 0;
            const student_quiz_points = ls.getDataValue('student_quiz_points') ?? 0;
            const student_scores = ls.getDataValue('student_scores') ?? 0;
            total_points += student_learning_points + student_practice_points + student_quiz_points;
            if(
              grade &&
              level &&
              grade.studentgradesprogresses &&
              level.studentlevelsprogresses
            ) {
              const gradeprogress = grade.studentgradesprogresses[0] ?? null;
              const levelprogress = level.studentlevelsprogresses[0] ?? null;
              const haslevelquiz = await studentprogress.findOne({
                where: { studentid: user.studentid, studentprogressreferenceid: lvl.levelid }
              })
              if(!stpoints) {
                await studentpoints.create({
                  studentpointid: uuidv4(),
                  studentid: user.studentid,
                  levelid: level.levelid,
                  lessonid,
                  gradepoints: gradeprogress ? (Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0) : 0,
                  totalgradepoints: grade.points ?? 0,
                  levelpoints: levelprogress ? (Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0) : 0,
                  totallevelpoints: level.points ?? 0,
                  levelquizscores: haslevelquiz ? haslevelquiz.scores + 1 : 0,
                  lessonpoints: total_points,
                  learningpoints: student_learning_points,
                  practicepoints: student_practice_points,
                  quizpoints: student_quiz_points,
                  totallearningpoints: ls.learning_points ?? 0,
                  totalpracticepoints: ls.practices_points ?? 0,
                  totalquizpoints: ls.quizzes_points ?? 0,
                  scores: student_scores,
                  created_at: currentdate
                });
              } else {
                stpoints.totalgradepoints =  grade.points ?? 0;
                stpoints.gradepoints = gradeprogress ? (Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0) : 0;
                stpoints.totallevelpoints =  level.points ?? 0;
                stpoints.levelpoints = levelprogress ? (Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0) : 0;
                stpoints.levelquizscores = haslevelquiz ? haslevelquiz.scores + 1 : 0;
                stpoints.lessonpoints = total_points;
                stpoints.learningpoints = student_learning_points;
                stpoints.practicepoints = student_practice_points;
                stpoints.quizpoints = student_quiz_points;
                stpoints.totallearningpoints = ls.learning_points ?? 0;
                stpoints.totalpracticepoints = ls.practices_points ?? 0;
                stpoints.totalquizpoints = ls.quizzes_points ?? 0;
                stpoints.scores = student_scores;
                await stpoints.save({ fields : [
                  'totalgradepoints', 
                  'gradepoints', 
                  'totallevelpoints', 
                  'levelpoints',
                  'levelquizscores', 
                  'lessonpoints',
                  'learningpoints',
                  'practicepoints',
                  'quizpoints',
                  'totallearningpoints',
                  'totalpracticepoints',
                  'totalquizpoints',
                  'scores'
                ]});
              }
              await studentpoints.update({
                gradepoints: gradeprogress ? (Number((gradeprogress.points*100/grade.points).toFixed(2)) ?? 0) : 0,
                totalgradepoints: grade.points ?? 0,
                levelpoints: levelprogress ? (Number((levelprogress.points*100/level.points).toFixed(2)) ?? 0) : 0,
                totallevelpoints: level.points ?? 0,
                levelquizscores: haslevelquiz ? haslevelquiz.scores + 1 : 0,
              },
              {
                where: {
                  levelid: level.levelid,
                  studentid: user.studentid,
                  created_at: {
                    [Op.between]: [today, tomorrow]
                  }
                }
              });
            } else {
              Logger.error("Error updateuserdailypointsBylevelquiz functions");
              throw Error("Internal Error");
            }
          }
        }
      }
    }
  }

  getlastquiz = async (referenceid: string, user: Token) => {
    const quiz = await studentprogress.findOne({
      where: { studentprogressreferenceid: referenceid, studentid: user.studentid },
      order: [["starttime", "DESC"]],
    });
    return quiz
  }

  addstudentscores = async (user: Token, lessonid: string, currentdate: Date, scores?: number) => { 
    const lesson = await lessons.findOne({
      where: { lessonid },
      include: {
        model: levels,
        required: true,
        as: "level",
        attributes: ["levelid", "gradeid", "points"],
      },
    });
    const bonus_points = 1;
    scores = scores ?? 0;
    if (lesson && lesson.level && user.studentid) {
      const lessonprogress = await studentlessonsprogress.findOne({
        where: { lessonid, studentid: user.studentid },
      });
      const grade = await grades.findOne({
        where: { gradeid: lesson.level?.gradeid },
      });
      if(grade) {
        if (lessonprogress) {
          const lsp = Number((lessonprogress.points*100/lesson.total_points).toFixed(2)) ?? 0;
          if(lsp >= 100 && !lessonprogress.added_completed_scores){
            scores += bonus_points;
            lessonprogress.added_completed_scores = true;
          }
          lessonprogress.lastupdated = currentdate;
          lessonprogress.scores += scores ?? 0;
          await lessonprogress.save({ fields: ["added_completed_scores", "lastupdated", "scores"]});
        }
        const levelprogress = await studentlevelsprogress.findOne({
          where: { levelid: lesson.level.levelid, studentid: user.studentid },
        });
        if (levelprogress) {
          levelprogress.lastupdated = currentdate;
          levelprogress.scores += scores ?? 0;
          await levelprogress.save({ fields: ["lastupdated", "scores"]});
        }
        const gradeprogress = await studentgradesprogress.findOne({
          where: { gradeid: grade.gradeid, studentid: user.studentid },
        });
        if (gradeprogress) {
          gradeprogress.lastupdated = currentdate;
          gradeprogress.scores += scores ?? 0;
          await gradeprogress.save({ fields: ["lastupdated", "scores"]});
        }
      }
    }
  };

  addstudentlevelquizscores = async (user: Token, level: levels, currentdate: Date, added_scores?: number) => {
    let scores = 0;
    scores += added_scores ? added_scores : 0;
    const levelprogress = await studentlevelsprogress.findOne({
      where: { levelid: level.levelid, studentid: user.studentid },
    });
    const grade = await grades.findOne({
      where: { gradeid: level.gradeid },
    });
    if(level && grade && user.studentid) {
      if (levelprogress) {
        if(!levelprogress.added_default_score) {
          scores += 1;
          levelprogress.added_default_score = true;
        }
        levelprogress.lastupdated = currentdate;
        levelprogress.scores += scores;
        await levelprogress.save({ fields: ["added_default_score", "scores", "lastupdated"]});
      }
      const gradeprogress = await studentgradesprogress.findOne({
        where: { gradeid: grade.gradeid, studentid: user.studentid },
      });
      if (gradeprogress) {
        gradeprogress.lastupdated = currentdate;
        gradeprogress.scores += scores;
        await gradeprogress.save({ fields: ["lastupdated","scores"]});
      }
    }
  };

  getLessonsWithFilter = async (levelid: string, lessonname: string) => {
    const where: WhereOptions<lessonsAttributes> = {
      isdeleted: false,
      lessonname: {
        [Op.like]: literal(`'%${lessonname.trim()}%'`)
      }
    };
    if(levelid){
      where.levelid = levelid;
    }  
    const order = ["lessonname"];

    return await lessons.findAll({ where, order });
  };

  getplanlesson = async (lessonplanid: string, user: Token) => {
    const lessonlearning = await lessonplans.findOne({
      where: {
        lessonplanid,
      },
    });
    if (lessonlearning) {
      const learningdocuments = await documents.findOne({
        where: {
          documentid: lessonlearning.documentid,
        },
      });
      lessonlearning.setDataValue(
        "lessonlearningfileobject",
        rawfilenameextractor(learningdocuments?.documentname ?? "")
      );
    }
    return lessonlearning;
  };
}
