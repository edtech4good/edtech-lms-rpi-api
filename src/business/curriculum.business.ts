/* eslint-disable @typescript-eslint/no-explicit-any */
import { col, fn, literal, Op, WhereOptions } from "sequelize";
import {
  curriculums,
  curriculumsAttributes,
  grades,
  lessons,
  levelquizquestions,
  levels,
  students,
} from "src/models/data-models/init-models";
import { LessonBusiness } from "src/business/lesson.business";
import { Token } from "src/models/token.model";
import { schools, schoolsAttributes } from "src/models/data-models/school";
import { GradeBusiness } from "./grade.business";
import { BadRequestException } from "@nestjs/common";
export class CurriculumBusiness {
  findallcurriculum = () => curriculums.findAll();
  findcurriculum = (curriculumid: string) =>
    curriculums.findOne({ where: { curriculumid } });

  findcurriculumgrades = async (curriculumid: string, user?: Token) => {
    curriculums.hasMany(grades, {
      foreignKey: "curriculumid",
      sourceKey: "curriculumid",
    });
    grades.belongsTo(curriculums, {
      foreignKey: "curriculumid",
    });
    grades.hasMany(levels, {
      foreignKey: "gradeid",
      sourceKey: "gradeid",
    });
    levels.belongsTo(grades, {
      foreignKey: "gradeid",
    });

    levels.hasMany(lessons, {
      foreignKey: "levelid",
      sourceKey: "levelid",
    });
    lessons.belongsTo(levels, {
      foreignKey: "levelid",
    });

    const curriculumobject = await curriculums.findOne({
      where: { curriculumid, curriculumstatus: true, isdeleted: false },
      attributes: {
        exclude: [],
      },
      order: [[grades, levels, lessons, "lessonorder", "ASC"]],
      include: [
        {
          where: {
            gradeid: { [Op.ne]: null },
            gradestatus: true,
            isdeleted: false,
          },
          model: grades,
          include: [
            {
              where: {
                levelid: { [Op.ne]: null },
                levelstatus: true,
                isdeleted: false,
              },
              model: levels,
              include: [
                {
                  where: {
                    lessonid: { [Op.ne]: null },
                    lessonstatus: true,
                    isdeleted: false,
                  },
                  model: lessons,
                },
              ],
            },
          ],
        },
      ],
    });

    const levelquestioncountobject = await levelquizquestions.findAll({
      group: ["levelid"],
      attributes: [[fn("COUNT", col("levelid")), "levelquizcount"], "levelid"],
    });

    const levelquestioncountdata = levelquestioncountobject.map(
      (levelquestioncount) => levelquestioncount.get({ plain: true })
    );
    if (curriculumobject) {
      const lessonbusiness = new LessonBusiness();
      const temp: any = curriculumobject.get({ plain: true });
      temp.grades = await Promise.all(temp.grades.map(async (grade: any) => {
        const gradepoints = await lessonbusiness.getgradeprogress(grade, user);
        grade.levels = await Promise.all(grade.levels.map(async (level: any & { hasquiz: boolean }) => {
          const levelquestioncount = levelquestioncountdata.find(
            (x) => x.levelid === level.levelid
          );
          const levelpoints = await lessonbusiness.getlevelprogress(level, user);
          const levellessons = await Promise.all(
            level.lessons.map(async (lesson: lessons) => {
              const number = lesson.lessonname.match(/[0-9]+/g);
              const lessonpoints = await lessonbusiness.getlessonprogress(lesson, user);
              return {
                ...lesson,
                lessonheading:
                  number && number.length > 0 ? number[0] : lesson.lessonname,
                lessonpoints
              };
            })
          );
          // eslint-disable-next-line no-param-reassign
          return {
            ...level,
            hasquiz: levelquestioncount ? true : false,
            lessons: levellessons,
            levelpoints
          };
        }));
        grade.gradepoints = gradepoints;
        return grade;
      }));
      return temp;
    }
    return null;
  };

  isexistsCurriculumID = async (curriculumid: string) => {
    const where: WhereOptions<curriculumsAttributes> = {
      curriculumid,
      isdeleted: false,
    };
    const tempdt = await curriculums.count({ where });
    return tempdt > 0;
  };

  isexitsSchoolName = async (schoolname: string) => {
    const where: WhereOptions<schoolsAttributes> = {
      schoolname,
      isdeleted: false,
    }
    const tempdt = await schools.count({ where });
    return tempdt > 0;
  }

  getCurriculumsWithFilter = async (cur: string, studentid: string, standardid: string, schoolname: string) => {
    const where: WhereOptions<curriculumsAttributes> = {
      isdeleted: false,
      curriculumstatus: true,
      curriculumname: {
        [Op.like]: literal(`'%${cur.trim()}%'`)
      }
    };
    if(studentid || standardid) {
      const wherestd: any = {};
      if(studentid) wherestd.studentid = studentid;
      if(standardid) wherestd.standard = standardid;
      if(schoolname) wherestd.schoolname = schoolname;
      const std = await students.findOne({
        where: wherestd, attributes: ['studentid','curriculumids'],
      });
      if(std) where.curriculumid = {
        [Op.in]: std.curriculumids ?? []
      }
    }
    const order = ["curriculumname"];

    return await curriculums.findAll({ where, order });
  };

  getCurriculumsWithSubject = async (user?: Token) => {
    const where: WhereOptions<curriculumsAttributes> = {
      isdeleted: false,
      curriculumstatus: true,
      curriculumid: {
        [Op.in]: user?.curriculumids ?? []
      }
    };
    const order = ["curriculumname"];

    const currs = await curriculums.findAll({ where, order });
    if(!user) throw new BadRequestException('User is not a student.');
    for await (const cur of currs) {
      const stdprogresses = await new GradeBusiness().getgradesbycurriculumid(cur.curriculumid, user);
      let progress = 0;
      stdprogresses.forEach(stdprogress => {
        progress += stdprogress.getDataValue('progress') ?? 0;
      });
      if(stdprogresses.length > 0) {
        progress = Number(Number(progress/stdprogresses.length).toFixed(2));
      }
      (cur as any).setDataValue('progress', progress);
    }
    return currs
  };
}
