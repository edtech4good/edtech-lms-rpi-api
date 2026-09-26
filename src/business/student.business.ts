import { meanBy } from "lodash";
import { Op, QueryTypes, WhereOptions } from "sequelize";
import { Transaction } from "sequelize/types";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import {
  grades,
  lessons,
  levels,
  schoolusers,
  studentlessonsprogress,
  students,
  studentsAttributes,
} from "../models/data-models/init-models";
import { CurriculumBusiness } from "./curriculum.business";
import { GradeBusiness } from "./grade.business";
import { BadRequestException } from "@nestjs/common";

export interface StudentProgressSummaryCurrentLevel {
  levelid: string;
  levelname: string;
  gradeid: string;
  gradename: string;
  lessonsCompleted: number;
  lessonsTotal: number;
}

export interface StudentProgressSummaryLevel {
  levelid: string;
  levelname: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  completed: boolean;
}

export interface StudentProgressSummaryGrade {
  gradeid: string;
  gradename: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  levelsCompleted: number;
  levelsTotal: number;
  levels: StudentProgressSummaryLevel[];
}

export interface StudentProgressSummaryCurriculum {
  curriculumid: string;
  curriculumname: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  levelsCompleted: number;
  levelsTotal: number;
  currentLevel: StudentProgressSummaryCurrentLevel | null;
  grades: StudentProgressSummaryGrade[];
}

export interface StudentProgressSummary {
  curricula: StudentProgressSummaryCurriculum[];
  totals: {
    lessonsCompleted: number;
    lessonsTotal: number;
    levelsCompleted: number;
    levelsTotal: number;
  };
}

export class StudentBusiness {
  getstudentbyid = (studentid: string) => {
    return students.findOne({ where: { studentid } });
  };
  studentExists = async (studentid: string) => {
    const student = await students.count({ where: { studentid } });
    return student > 0;
  };
  getstudentbyschool = (schoolname: string) => {
    return students.findAll({
      where: { schoolname },
    });
  };
  getstudentbyschooluserid = (schooluserid: string) => {
    return students.findOne({ where: { schooluserid } });
  };
  importstudents = async (newstudents: Array<students>, transaction: Transaction) => {
    // students.bulkCreate(newstudents, {
    //   transaction,
    //   updateOnDuplicate: [
    //     "studentfirstname",
    //     "studentlastname",
    //     "familyname",
    //     "mothername",
    //     "fathername",
    //     "contact",
    //     "dateofbirth",
    //     "genderid",
    //     "standard",
    //     "schooltype",
    //     "schoolname",
    //     "city",
    //     "country",
    //     "state",
    //     "dateofjoin",
    //     "curriculumid",
    //     "gradeid",
    //     "startinglevelid",
    //     "studentcurrentlevelid",
    //     "studentcurrentlessonid",
    //     "isactive",
    //     "schooluserid",
    //     "type",
    //     "is_teacher_acc"
    //   ],
    // });
    for await (const student of newstudents) {
      try {
        // if(student.studentid == 'c55bcaa8-2c21-44d4-a48e-2d0445a8f232' || 
        // student.studentid == 'f635c51c-2d95-4a5c-a420-6ee30a2d8721' ||
        // student.studentid == 'f919b36a-051b-410f-a430-4154e691c135'
        // ) continue;
        await students.bulkCreate([student], {
          transaction,
          updateOnDuplicate: [
            "studentfirstname",
            "studentlastname",
            "familyname",
            "mothername",
            "fathername",
            "contact",
            "dateofbirth",
            "genderid",
            "wg_seeing",
            "wg_hearing",
            "wg_walking",
            "wg_remembering",
            "wg_selfcare",
            "wg_communicating",
            "wg_source",
            "wg_collected_at",
            "standard",
            "schooltype",
            "schoolname",
            "city",
            "country",
            "state",
            "dateofjoin",
            "curriculumid",
            "gradeid",
            "startinglevelid",
            "studentcurrentlevelid",
            "studentcurrentlessonid",
            "isactive",
            "schooluserid",
            "type",
            "is_teacher_acc",
            "curriculumids"
          ],
        });
      } catch (e) {
        throw new BadRequestException({
          error: true,
          errormessage: e,
        });
      }
    }
  }

  getstudentstats = (studentid: string) =>
    dbinstance.getdbinstance().query(
      `SELECT 
      ss.*,
      studentprogress.starttime AS lastlogin,
      lessons.lessonname AS currentlessonname,
      lessons.lessonorder AS currentlessonorder,
      lessons.lessonid AS currentlessonid,
      levels.levelid AS currentlevelid,
      levels.levelname AS currentlevelname,
      levels.levelorder AS currentlevelorder,
      grades.gradename AS currentgradename,
      grades.gradeorder AS currentgradeorder,
      grades.gradeid AS currentgradeid
FROM
    students AS ss
        INNER JOIN
    studentprogress ON studentprogress.studentprogressid = (SELECT 
            studentprogress.studentprogressid
        FROM
            studentprogress
                INNER JOIN
            lessonquizzes ON lessonquizzes.lessonquizid = studentprogress.studentprogressreferenceid
                INNER JOIN
            lessons ON lessons.lessonid = lessonquizzes.lessonid
        WHERE
            studentprogress.progresstype = 2
                AND studentprogress.ispass = 1
                AND studentid = ss.studentid
        ORDER BY lessonorder DESC
        LIMIT 1)
        INNER JOIN
    lessonquizzes ON lessonquizzes.lessonquizid = studentprogress.studentprogressreferenceid
        INNER JOIN
    lessons ON lessons.lessonid = lessonquizzes.lessonid
        INNER JOIN
    levels ON levels.levelid = lessons.levelid
        INNER JOIN
    grades ON grades.gradeid = levels.gradeid
WHERE
    ss.studentid = ? LIMIT 1`,
      { type: QueryTypes.SELECT, raw: true, replacements: [studentid] }
    );

  getstudentquizstats = (studentid: string) =>
    dbinstance.getdbinstance().query(
      `SELECT 
      sp.*,
      lessons.lessonname AS lessonname,
      lessons.lessonorder AS lessonorder,
      lessons.lessonid AS lessonid,
      levels.levelid AS levelid,
      levels.levelname AS levelname,
      levels.levelorder AS levelorder,
      grades.gradename AS gradename,
      grades.gradeorder AS gradeorder,
      grades.gradeid AS gradeid
  FROM
      studentprogress as sp
          INNER JOIN
      lessonquizzes ON lessonquizzes.lessonquizid = sp.studentprogressreferenceid
          INNER JOIN
      lessons ON lessons.lessonid = lessonquizzes.lessonid
          INNER JOIN
      levels ON levels.levelid = lessons.levelid
          INNER JOIN
      grades ON grades.gradeid = levels.gradeid
  WHERE
      studentid = ?
          AND sp.progresstype = 2;`,
      { type: QueryTypes.SELECT, raw: true, replacements: [studentid] }
    );

  getstudentpracticestats = (studentid: string) =>
    dbinstance.getdbinstance().query(
      `SELECT 
      sp.*,
      lessons.lessonname AS lessonname,
      lessons.lessonorder AS lessonorder,
      lessons.lessonid AS lessonid,
      levels.levelid AS levelid,
      levels.levelname AS levelname,
      levels.levelorder AS levelorder,
      grades.gradename AS gradename,
      grades.gradeorder AS gradeorder,
      grades.gradeid AS gradeid
  FROM
      studentprogress AS sp
          INNER JOIN
      lessonpractices ON lessonpractices.lessonpracticeid = sp.studentprogressreferenceid
          INNER JOIN
      lessons ON lessons.lessonid = lessonpractices.lessonid
          INNER JOIN
      levels ON levels.levelid = lessons.levelid
          INNER JOIN
      grades ON grades.gradeid = levels.gradeid
  WHERE
      studentid = ?
          AND sp.progresstype = 1;`,
      { type: QueryTypes.SELECT, raw: true, replacements: [studentid] }
    );

  getstudentlevelstats = (studentid: string) =>
    dbinstance.getdbinstance().query(
      `SELECT 
      sp.*,
      levels.levelid AS levelid,
      levels.levelname AS levelname,
      levels.levelorder AS levelorder,
      grades.gradename AS gradename,
      grades.gradeorder AS gradeorder,
      grades.gradeid AS gradeid
  FROM
      studentprogress AS sp
         
          INNER JOIN
      levels ON levels.levelid =  sp.studentprogressreferenceid
          INNER JOIN
      grades ON grades.gradeid = levels.gradeid
  WHERE
     studentid = ? AND
          sp.progresstype = 3;`,
      { type: QueryTypes.SELECT, raw: true, replacements: [studentid] }
    );

  updateProfile = async (filename: string, user: Token) => {
    if(user.studentid) {
      const student = await this.getstudentbyid(user.studentid);
      if(student){
        student.profileimage = filename;
        student.save({ fields: ['profileimage'] });
      }
    }
    return filename;
  }

  getstudentstats2 = (studentid: string) => {
    return;
  }

  getStudentsWithFilter = async (userid: string, schoolname: string) => {
    const where: WhereOptions<studentsAttributes> = {
      "$schooluser.schoolusername$": {
        [Op.like]: `%${userid.trim()}%`
      }
    };
    if(schoolname) where.schoolname = schoolname;

    return await students.findAll(
      {
        where,
        limit: 20,
        include: [
          {
            model: schoolusers,
            as: 'schooluser',
            attributes: ['schoolusername']
          }
        ]
      }
    );
  };

  getprogress = async (user: Token) => {
    const student = await this.getstudentbyid(user.studentid ?? '');
    if(student) {
      const gradeprogresses = await new GradeBusiness().getgradesbycurriculumid(student.curriculumid, user);
      const mean = meanBy(gradeprogresses, gp => gp.getDataValue('progress'));
      return Math.round((mean + Number.EPSILON) * 100) / 100 ;
    }
    return 0;
  }

  // Single call backing the app's "My progress" screen: overall lesson/level
  // completion per enrolled curriculum plus totals, in a fixed number of
  // queries (no per-curriculum/per-level query loop) so it stays cheap
  // regardless of how many curricula or levels the student has, and is
  // cacheable offline as one payload.
  //
  // "Enrolled curricula" is exactly what GET curriculum/subjects resolves
  // (CurriculumBusiness.getEnrolledCurriculums): active, non-deleted
  // curricula in the student's curriculumids, in curriculumname order.
  //
  // A lesson is "done" when the student's studentlessonsprogress row has
  // completed === true OR progress >= 100 — the same rule the Expo app's
  // Level Detail screen uses. A level "counts" only when it has at least one
  // active lesson; a level with zero active lessons is excluded from both
  // levelsCompleted and levelsTotal (it can never be "done" and would
  // otherwise silently deflate the denominator). currentLevel is the first
  // level, ordered by grade gradeorder then level levelorder, that has at
  // least one active lesson and is not yet completed; it is null once every
  // level is completed, or when the curriculum has no active lessons at all.
  getprogresssummary = async (user: Token): Promise<StudentProgressSummary> => {
    const emptyTotals = { lessonsCompleted: 0, lessonsTotal: 0, levelsCompleted: 0, levelsTotal: 0 };
    const curricula = await new CurriculumBusiness().getEnrolledCurriculums(user);
    if (curricula.length === 0) {
      return { curricula: [], totals: emptyTotals };
    }

    const curriculumids = curricula.map((cur) => cur.curriculumid);

    const activeGrades = await grades.findAll({
      where: { curriculumid: curriculumids, gradestatus: true, isdeleted: false },
      attributes: ["gradeid", "curriculumid", "gradename", "gradeorder"],
      order: [["gradeorder", "ASC"], ["gradename", "ASC"], ["gradeid", "ASC"]],
    });
    const gradeids = activeGrades.map((grade) => grade.gradeid);

    const activeLevels = gradeids.length
      ? await levels.findAll({
          where: { gradeid: gradeids, levelstatus: true, isdeleted: false },
          attributes: ["levelid", "gradeid", "levelname", "levelorder"],
          order: [["levelorder", "ASC"], ["levelname", "ASC"], ["levelid", "ASC"]],
        })
      : [];
    const levelids = activeLevels.map((level) => level.levelid);

    const activeLessons = levelids.length
      ? await lessons.findAll({
          where: { levelid: levelids, lessonstatus: true, isdeleted: false },
          attributes: ["lessonid", "levelid"],
        })
      : [];
    const lessonids = activeLessons.map((lesson) => lesson.lessonid);

    const studentLessonProgresses = lessonids.length
      ? await studentlessonsprogress.findAll({
          where: { studentid: user.studentid, lessonid: lessonids },
          attributes: ["lessonid", "completed", "progress"],
        })
      : [];

    const doneLessonIds = new Set<string>();
    for (const p of studentLessonProgresses) {
      if (p.completed === true || (p.progress ?? 0) >= 100) {
        doneLessonIds.add(p.lessonid);
      }
    }

    const lessonIdsByLevel = new Map<string, string[]>();
    for (const lesson of activeLessons) {
      const list = lessonIdsByLevel.get(lesson.levelid) ?? [];
      list.push(lesson.lessonid);
      lessonIdsByLevel.set(lesson.levelid, list);
    }

    const levelsByGrade = new Map<string, typeof activeLevels>();
    for (const level of activeLevels) {
      const list = levelsByGrade.get(level.gradeid) ?? [];
      list.push(level);
      levelsByGrade.set(level.gradeid, list);
    }

    const gradesByCurriculum = new Map<string, typeof activeGrades>();
    for (const grade of activeGrades) {
      const list = gradesByCurriculum.get(grade.curriculumid) ?? [];
      list.push(grade);
      gradesByCurriculum.set(grade.curriculumid, list);
    }

    const totals = { ...emptyTotals };

    const curriculaOut: StudentProgressSummaryCurriculum[] = curricula.map((cur) => {
      const curriculumGrades = gradesByCurriculum.get(cur.curriculumid) ?? [];

      let lessonsCompleted = 0;
      let lessonsTotal = 0;
      let levelsCompleted = 0;
      let levelsTotal = 0;
      let currentLevel: StudentProgressSummaryCurrentLevel | null = null;
      const gradesOut: StudentProgressSummaryGrade[] = [];

      for (const grade of curriculumGrades) {
        const gradeLevels = levelsByGrade.get(grade.gradeid) ?? [];
        let gradeLessonsCompleted = 0;
        let gradeLessonsTotal = 0;
        let gradeLevelsCompleted = 0;
        let gradeLevelsTotal = 0;
        const levelsOut: StudentProgressSummaryLevel[] = [];

        for (const level of gradeLevels) {
          const levelLessonIds = lessonIdsByLevel.get(level.levelid) ?? [];
          if (levelLessonIds.length === 0) {
            // No active lessons: excluded from levelsCompleted/levelsTotal,
            // and contributes nothing to the lesson counts either way. Still
            // surfaced in the grades/levels array (with 0/0, not completed)
            // so the app can show a "no lessons" state.
            levelsOut.push({
              levelid: level.levelid,
              levelname: level.levelname,
              lessonsCompleted: 0,
              lessonsTotal: 0,
              completed: false,
            });
            continue;
          }

          const levelLessonsTotal = levelLessonIds.length;
          const levelLessonsCompleted = levelLessonIds.filter((id) => doneLessonIds.has(id)).length;
          lessonsTotal += levelLessonsTotal;
          lessonsCompleted += levelLessonsCompleted;
          gradeLessonsTotal += levelLessonsTotal;
          gradeLessonsCompleted += levelLessonsCompleted;

          levelsTotal += 1;
          gradeLevelsTotal += 1;
          const levelComplete = levelLessonsCompleted === levelLessonsTotal;
          if (levelComplete) {
            levelsCompleted += 1;
            gradeLevelsCompleted += 1;
          } else if (!currentLevel) {
            currentLevel = {
              levelid: level.levelid,
              levelname: level.levelname,
              gradeid: grade.gradeid,
              gradename: grade.gradename,
              lessonsCompleted: levelLessonsCompleted,
              lessonsTotal: levelLessonsTotal,
            };
          }

          levelsOut.push({
            levelid: level.levelid,
            levelname: level.levelname,
            lessonsCompleted: levelLessonsCompleted,
            lessonsTotal: levelLessonsTotal,
            completed: levelComplete,
          });
        }

        gradesOut.push({
          gradeid: grade.gradeid,
          gradename: grade.gradename,
          lessonsCompleted: gradeLessonsCompleted,
          lessonsTotal: gradeLessonsTotal,
          levelsCompleted: gradeLevelsCompleted,
          levelsTotal: gradeLevelsTotal,
          levels: levelsOut,
        });
      }

      totals.lessonsCompleted += lessonsCompleted;
      totals.lessonsTotal += lessonsTotal;
      totals.levelsCompleted += levelsCompleted;
      totals.levelsTotal += levelsTotal;

      return {
        curriculumid: cur.curriculumid,
        curriculumname: cur.curriculumname,
        lessonsCompleted,
        lessonsTotal,
        levelsCompleted,
        levelsTotal,
        currentLevel,
        grades: gradesOut,
      };
    });

    return { curricula: curriculaOut, totals };
  };

  getlogintime = async (schooluserids: string[]) => {
    const ids = Array.isArray(schooluserids) ? schooluserids : [];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const data = await dbinstance
      .getdbinstance()
      .query(
        `SELECT max(logintime) as logintime, userid FROM rpiuseraccess where userid in (${placeholders}) group by userid`,
        { type: QueryTypes.SELECT, raw: true, replacements: ids }
      );
    return data
  }
}
