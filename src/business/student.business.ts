import { meanBy } from "lodash";
import { literal, Op, QueryTypes, WhereOptions } from "sequelize";
import { Transaction } from "sequelize/types";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { schoolusers, students, studentsAttributes } from "../models/data-models/init-models";
import { GradeBusiness } from "./grade.business";
import { BadRequestException } from "@nestjs/common";

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
    ss.studentid = '${studentid}' LIMIT 1`,
      { type: QueryTypes.SELECT, raw: true }
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
      studentid = '${studentid}'
          AND sp.progresstype = 2;`,
      { type: QueryTypes.SELECT, raw: true }
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
      studentid = '${studentid}'
          AND sp.progresstype = 1;`,
      { type: QueryTypes.SELECT, raw: true }
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
     studentid = '${studentid}' AND
          sp.progresstype = 3;`,
      { type: QueryTypes.SELECT, raw: true }
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
        [Op.like]: literal(`'%${userid.trim()}%'`)
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

  getlogintime = async (schooluserids: string[]) => {
    const data = await dbinstance
      .getdbinstance()
      .query(
        `SELECT max(logintime) as logintime, userid FROM rpiuseraccess where userid in (${schooluserids
          .map((x) => `'${x}'`)
          .join()}) group by userid`,
        { type: QueryTypes.SELECT, raw: true }
      );
    return data
  }
}
