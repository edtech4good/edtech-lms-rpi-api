/* eslint-disable @typescript-eslint/no-explicit-any */
import { col, fn, Op, WhereOptions } from "sequelize";
import {
  curriculums,
  curriculumsAttributes,
  grades,
  lessons,
  levelquizquestions,
  levels,
  students,
} from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { LessonBusiness } from "src/business/lesson.business";
import { Token } from "src/models/token.model";
import { GradeBusiness } from "./grade.business";
import { callerKindOf, enrolledCurriculumIds, curriculumIdsInScope } from "./content-access";
import { findSchoolIdByName, schoolRefIsOwn, schoolScopeFromToken, studentsOfSchool } from "./school-identity";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
export class CurriculumBusiness {
  // Every curriculum the caller may see (their learner list, or their school's list, of their organisation's).
  findallcurriculum = async (user?: Token) =>
    curriculums.findAll({ where: { curriculumid: { [Op.in]: await curriculumIdsInScope(user) } } });
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

  // Whether a live school is named by this name (the same text rule as every
  // other by-name lookup; a name that matches two live schools is a 400).
  isexitsSchoolName = async (schoolname: string) =>
    (await findSchoolIdByName(schoolname, { liveOnly: true })) !== null;

  // Is the school the TOKEN names a live school here? (The baseline route is about the caller's own school;
  // the school name in its path is not looked up, so the path cannot be used to find out which schools exist.)
  isOwnSchoolLive = async (user?: Token) => {
    const school = await schoolScopeFromToken(user);
    if (!school || !("schoolid" in school)) return false;
    return (await schools.count({ where: { schoolid: school.schoolid, isdeleted: false } })) > 0;
  };

  // The curricula of the caller's scope: a learner's current enrolments, or a school's list, of the token's
  // organisation. What the request names (a learner, a class, a school) can only narrow that, never widen it:
  //  - a learner token is always about itself, so a learner or class named in the query is dropped;
  //  - a staff token may name a learner or class, but only one of its own school's;
  //  - a school named in the query must be the token's own school, else nothing is returned.
  getCurriculumsWithFilter = async (cur: string, studentid: string, standardid: string, schoolname: unknown, schoolid: unknown, user?: Token) => {
    const school = await schoolScopeFromToken(user);
    if (!(await schoolRefIsOwn(school, { schoolid, schoolname }))) {
      return [];
    }
    let allowed = await curriculumIdsInScope(user);
    if (callerKindOf(user) === "staff" && (studentid || standardid) && school) {
      const wherestd: any = {};
      if(studentid) wherestd.studentid = studentid;
      if(standardid) wherestd.standard = standardid;
      const std = await students.findOne({
        where: { ...wherestd, ...studentsOfSchool(school) },
        attributes: ['studentid','curriculumids'],
      });
      if(std) {
        const named = new Set((std.curriculumids ?? []).map((id) => String(id).toLowerCase()));
        allowed = allowed.filter((id) => named.has(id.toLowerCase()));
      }
    }
    const where: WhereOptions<curriculumsAttributes> = {
      isdeleted: false,
      curriculumstatus: true,
      curriculumname: {
        [Op.like]: `%${cur.trim()}%`
      },
      curriculumid: { [Op.in]: allowed },
    };
    const order = ["curriculumname"];

    return await curriculums.findAll({ where, order });
  };

  // The single source of truth for "which curricula is this student enrolled
  // in": active, non-deleted curricula whose id is in the student's
  // curriculumids, ordered by curriculumname. GET curriculum/subjects and
  // GET student/progress/summary both resolve enrollment this way so the
  // two endpoints never disagree about the student's curriculum list.
  getEnrolledCurriculums = async (user?: Token) => {
    // The enrolment is read from the database now (the token's own copy is stale until the next sign-in),
    // and only curricula the token's organisation owns count.
    const where: WhereOptions<curriculumsAttributes> = {
      isdeleted: false,
      curriculumstatus: true,
      curriculumid: {
        [Op.in]: await enrolledCurriculumIds(user)
      }
    };
    const order = ["curriculumname"];

    return await curriculums.findAll({ where, order });
  };

  getCurriculumsWithSubject = async (user?: Token) => {
    if(!user) throw new ApiError(ErrorCode.NOT_ALLOWED, { message: 'This account is not a student.' });
    const currs = await this.getEnrolledCurriculums(user);
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
