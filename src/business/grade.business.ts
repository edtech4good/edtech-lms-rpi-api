import { meanBy } from "lodash";
import { col, fn, literal, Op, WhereOptions } from "sequelize";
import { grades, gradesAttributes } from "src/models/data-models/grades";
import { levels } from "src/models/data-models/levels";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { students } from "src/models/data-models/students";
import { studenttrash } from "src/models/data-models/studenttrash";
import { COMPLETED_PERCENTAGE } from "src/models/enums/constant.enum";
import { Token } from "src/models/token.model";
import { v4 as uuidv4 } from "uuid";

export class GradeBusiness {
  getgradesbycurriculumid = async (curriculumid: string, user: Token) => {
    grades.hasMany(studentgradesprogress, { foreignKey: "gradeid" });
    studentgradesprogress.belongsTo(grades, { foreignKey: "gradeid" });
    let gs = await grades.findAll({
      where: { curriculumid, gradestatus: true, isdeleted: false },
      include: [
        {
          model: studentgradesprogress,
          required: false,
          where: { studentid: user.studentid },
          attributes: ["points", "completed"],
        },
      ],
    });
    gs = await Promise.all(
      gs.map(async (grade: grades) => {
        const numlevels = await grade.countLevels({
          where: { levelstatus: true, isdeleted: false },
        });
        const studentgradesprogress = grade.getDataValue("studentgradesprogresses");
        let progress = 0;
        if(studentgradesprogress && studentgradesprogress[0]?.points){
          progress = Number(Number(studentgradesprogress[0]?.points*100/grade.points).toFixed(2));
        }
        grade.setDataValue("progress", progress);
        grade.setDataValue("number_levels", numlevels);
        return grade;
      })
    );
    return gs;
  };

  getgradeprogressbygradeid = async (gradeid: string, user: Token) => {
    grades.hasMany(studentgradesprogress, { foreignKey: "gradeid" });
    studentgradesprogress.belongsTo(grades, { foreignKey: "gradeid" });
    const gs = await grades.findOne({
      where: { gradeid, gradestatus: true, isdeleted: false },
      include: [
        {
          model: studentgradesprogress,
          required: false,
          where: { studentid: user.studentid },
          attributes: ["points", "completed"],
        },
      ],
    });
    return gs;
  }

  isexistsGradeID = async (gradeid: string) => {
    const where: WhereOptions<gradesAttributes> = {
      gradeid,
      isdeleted: false,
    };
    const tempdt = await grades.count({ where });
    return tempdt > 0;
  };

  getusergradesprogess = async (curriculumid: string, user: Token) => {
    grades.hasMany(studentgradesprogress, {
      foreignKey: "gradeid",
      sourceKey: "gradeid",
    });
    studentgradesprogress.belongsTo(grades, {
      foreignKey: "gradeid",
    });
    levels.hasMany(studentlevelsprogress, {
      foreignKey: "levelid",
      sourceKey: "levelid",
    });
    studentlevelsprogress.belongsTo(levels, {
      foreignKey: "levelid",
    });
    const gradesresult = await grades.findAll({
      where: { curriculumid, gradestatus: true, isdeleted: false },
      attributes: [
        "gradeid",
        "gradename",
        "gradeorder",
        [fn("COUNT", col("levels.levelid")), "number_levels"],
      ],
      include: [
        {
          model: studentgradesprogress,
          required: false,
          where: { studentid: user.studentid },
          attributes: ["points", "completed", "scores"],
        },
        {
          model: levels,
          as: "levels",
          required: false,
          where: { levelstatus: true, isdeleted: false },
          attributes: [],
        },
      ],
      group: ["grades.gradeid"],
    });
    const levelsprogresses = await levels.findAll({
      where: { levelstatus: true, isdeleted: false },
      attributes: ["levelid", "levelname", "gradeid", "points"],
      include: [
        {
          model: studentlevelsprogress,
          required: true,
          where: {
            curid: curriculumid,
            studentid: user.studentid,
          },
          attributes: ["points"],
        },
      ],
    }).then((lvlprogresses) => {
        return lvlprogresses.map(lvlprogress => {
            const lvlstudentprogress = lvlprogress.getDataValue('studentlevelsprogresses');
            if(lvlstudentprogress) {
              const studentpoints = lvlstudentprogress[0].getDataValue("points") ?? 0;
              const completedpoints = lvlprogress.points*COMPLETED_PERCENTAGE/100;
              const completed = studentpoints > completedpoints ? true : false;
              lvlprogress.setDataValue('completed', completed);
            }
            return lvlprogress
        });
    });
    let total_points = 0;
    for (const grade of gradesresult) {
        const number_completed_levels = levelsprogresses.filter((lvlp => lvlp.gradeid === grade.gradeid && lvlp.getDataValue('completed'))).length;
        grade.setDataValue('number_completed_levels', number_completed_levels);
        if(grade.studentgradesprogresses && grade.studentgradesprogresses.length > 0){
            total_points += grade.studentgradesprogresses[0]?.scores ?? 0;
        }
    }
    return { gradesresult, total_points };
  };

  getGradesWithFilter = async (gradename: string, curid: string, standardid: string, schoolname: string) => {
    const where: WhereOptions<gradesAttributes> = {
      isdeleted: false,
      gradename: {
        [Op.like]: literal(`'%${gradename.trim()}%'`)
      }
    };
    if(curid){
      where.curriculumid = curid;
    }
    if(standardid && schoolname) {
      const student = await students.findOne({
        where: {
          standard: standardid,
          schoolname
        }
      });
      if(student) where.curriculumid = student.curriculumid;
    }
    const order = ["gradename"];

    return await grades.findAll({ where, order });
  };

  gettotalprogressofgrade = async (user: Token, gradeid: string) => {
    const progress: {
      gradeprogress: number;
      totalgradeprogress: number;
      show: boolean;
      trashtype: number | null;
    } = {gradeprogress: 0, totalgradeprogress: 0, show: false, trashtype: null};
    const student = await students.findOne({ where: { studentid: user.studentid } });
    if(student) {
      const levelprogresses = await studentgradesprogress.findOne({
        where: { studentid: student.studentid, gradeid }
      });
      progress.gradeprogress = Math.round((levelprogresses?.progress ?? 0 + Number.EPSILON) * 100) / 100;
    }
    if(student) {
      const gradeprogresses = await new GradeBusiness().getgradesbycurriculumid(student.curriculumid, user);
      const mean = meanBy(gradeprogresses, gp => gp.getDataValue('progress'));
      progress.totalgradeprogress = Math.round((mean + Number.EPSILON) * 100) / 100 ;
    }
    const tpq = progress.totalgradeprogress ?? 0;
    let trashtype: number | null = null;
    if(tpq <= 10) trashtype = 1;
    else if(tpq <= 20) trashtype = 2;
    else if(tpq <= 30) trashtype = 3;
    else if(tpq <= 40) trashtype = 4;
    else if(tpq <= 50) trashtype = 5;
    else if(tpq <= 60) trashtype = 6;
    else if(tpq <= 70) trashtype = 7;
    else if(tpq <= 80) trashtype = 8;
    else if(tpq <= 90) trashtype = 9;
    else trashtype = 10;
    const trash = await studenttrash.findOne({
      where: {
        studentid: user.studentid,
        gradeid,
        trashtype,
        status: 1
      }
    });
    if(!trash && user.studentid && progress.gradeprogress == 100) {
      await studenttrash.create({
        studenttrashid: uuidv4(),
        studentid: user.studentid,
        gradeid,
        trashtype,
        status: 1,
        totalprogress: tpq
      });
      progress.show = true;
      progress.trashtype = trashtype;
    }
    return progress;
  }
}
