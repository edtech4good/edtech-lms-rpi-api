import { BadRequestException } from "@nestjs/common";
import { Op, QueryTypes, WhereOptions } from "sequelize";
import { curriculumbaseline, curriculumbaselineAttributes } from "src/models/data-models/curriculumbaseline";
import { schools, schoolsAttributes } from "src/models/data-models/school";
import { studentprogress, studentprogressAttributes } from "src/models/data-models/studentprogress";
import { dbinstance } from "src/services/dbservice";
import { endOfDay, startOfDay } from "date-fns";
import { students } from "src/models/data-models/students";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { schoolusers } from "src/models/data-models/schoolusers";
interface BaselineQuestionCorrectAnswer {
  iscorrect: boolean;
  question: undefined;
  curriculumbaselineid: string;
  baselinequestionid: string;
  questionid: number;
}

export class CurriculumBaseLineBusiness {

  calculateBaselineQuestionScore = async (
    curriculumbaselineid: string,
    correct: BaselineQuestionCorrectAnswer[]
  ) => {
    const baseline = await this.getbaselinequestion(curriculumbaselineid);
    const marks = correct.length;
    return {
      marks,
      userpoints: 0,
      fullpoints: 0,
      baseline,
    };
  };

  getbaselinequestion = async (curriculumbaselineid: string) => {
    const baseline = await curriculumbaseline.findOne({
      where: {
        curriculumbaselineid,
      },
    });
    if (!baseline) throw new BadRequestException("level Not Found");
    return baseline;
  };

  getBaseLine = (curriculumid: string) =>
    curriculumbaseline.findOne({
      where: {
        curriculumid: { [Op.like]: curriculumid },
      },
    });

  getStudentBaselineProgress = (
    baselinecurriculumid: string,
    studentid: string
  ) => {
    const query = `SELECT 
      count(*) as passresult
  FROM
      studentprogress
          INNER JOIN
      lessonquizzes ON lessonquizzes.lessonquizid = studentprogress.studentprogressreferenceid
          INNER JOIN
      lessons ON lessons.lessonid = lessonquizzes.lessonid
          INNER JOIN
      levels ON levels.levelid = lessons.levelid
          INNER JOIN
      grades ON grades.gradeid = levels.gradeid
          INNER JOIN
      curriculums ON curriculums.curriculumid = grades.curriculumid
  WHERE
      studentprogress.progresstype = 2
          -- AND studentprogress.ispass = 1
          AND studentid like '${studentid}'
          AND curriculums.curriculumid like '${baselinecurriculumid}'`;

    return dbinstance
      .getdbinstance()
      .query(query, { type: QueryTypes.SELECT, raw: true });
  };

  getBaseLineId = (curriculumid: string) =>
  curriculumbaseline.findOne({
    where: {
      curriculumid:curriculumid,
      baselinestatus: true,
    },
  });

  getCurriculumBaseline = async(curriculumid: string,schoolname: string) =>{
    const where: WhereOptions<schoolsAttributes> = {
      schoolname,
      isdeleted: false,
    }
    const school = await schools.findOne({where});
    const baseline = await curriculumbaseline.findOne({
      where:{
        curriculumid,
        baselinestatus: true,
        isdeleted: false,
      }
    })
    
    // const base = baseline?.schoolid.find(schoolid => {
    //   if(schoolid === school?.schoolid){
    //     return baseline;
    //   }
    // })

    for(const schoolid of baseline?.schoolid ?? ''){
      if(schoolid === school?.schoolid){
        return baseline;
      }
    }
  }

  getSchoolid = async(schoolname: string) =>{
    const where: WhereOptions<schoolsAttributes> = {
      schoolname,
      isdeleted: false,
    }
    const school = await schools.findOne({where});
    return school?.schoolid;
  }

  GetStudentBaseline = async(curriculumid: string,studentid: string, schoolname: string, currentdate: number) =>{
    const getSchoolid = await this.getSchoolid(schoolname);
    const whereBaseline: WhereOptions<curriculumbaselineAttributes> = {
      curriculumid,
      baselinestatus: true,
      isdeleted: false,
    }
    const baseline = await curriculumbaseline.findOne({where: whereBaseline});

    const whereStudentProgress: WhereOptions<studentprogressAttributes> = {
      studentid: studentid,
      studentprogressreferenceid: baseline?.curriculumbaselineid ?? null,
    }
    const student = await studentprogress.findOne({where: whereStudentProgress});
    const startDate = startOfDay(new Date(baseline?.startdate ?? ''));
    const endDate = endOfDay(new Date(baseline?.enddate ?? ''));
    const currentDate = new Date(currentdate);

    for(const schoolid of baseline?.schoolid ?? ''){
      if(schoolid === getSchoolid){
        if(baseline?.baselinestatus && !student){
          if(currentDate >= startDate && currentDate <= endDate){
            return true;
          }
          return false;
        }else{
          return false;
        }
      }
    }

  }

  async getStudentBaselineEndlineResults(curriculumbaselineid: string) {
    curriculumbaseline.hasMany(studentprogress, {
      foreignKey: "studentprogressreferenceid",
      sourceKey: "curriculumbaselineid",
    });
    studentprogress.belongsTo(curriculumbaseline, {
        foreignKey: "studentprogressreferenceid",
    });
    const totalquestions = await baselinequestion.count({
      where: {
        curriculumbaselineid
      }
    })
    const results = await studentprogress.findAll({
      where: {
        studentprogressreferenceid: curriculumbaselineid
      },
      include: [
        {
          model: students,
          attributes: ['studentfirstname', 'schoolname'],
          required: true,
          include: [
            {
              model: schoolusers,
              as: 'schooluser',
              required: true,
              attributes: ['schoolusername']
            }
          ]
        },
        {
          model: curriculumbaseline,
          attributes: ['baselinename'],
          required: true
        }
      ]
    }).then(rsls => {
      rsls.forEach(rsl => {
        (rsl as any).setDataValue('totalquestions', totalquestions);
      })
      return rsls;
    });
    return results
  }
}
