import { meanBy, omit } from "lodash";
import { Op, QueryTypes, WhereOptions } from "sequelize";
import { Transaction } from "sequelize/types";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { DEFAULT_RECOGNITION, RECOGNITION_FIELDS } from "src/constants/recognition";
import {
  curriculums,
  grades,
  lessons,
  levels,
  schoolusers,
  studentlessonsprogress,
  studentlevelsprogress,
  studentawards,
  students,
  studentsAttributes,
} from "../models/data-models/init-models";
import { CurriculumBusiness } from "./curriculum.business";
import type { ContentTranslations } from "./content-translations";
import { GradeBusiness } from "./grade.business";
import { AwardView, awardsOfStudent, hiddenSingleItemTierGradeIds } from "./level-award";
import { learnersInScope, ReportScope } from "./report-scope";
import { schoolRefIsOwn, SchoolScope, studentsOfSchool, withRequiredSchoolIds } from "./school-identity";

/** `{ "<language>": { "<field>": text } }`, present only when the request asked for translations. */
export type StudentProgressSummaryTranslations = Record<string, Record<string, string>>;

/** One earned award, as the awards overview lists it on its level. */
export interface AwardsOverviewAward {
  studentawardid: string;
  earnedat: Date;
  earnedat_approximate: boolean;
}

export interface AwardsOverviewLevel {
  levelid: string;
  levelname: string;
  levelorder: number;
  /** The level progress row's points percentage, 0 without a row. */
  progress: number;
  /** False on a hidden single-item tier: the level earns no award. An award it already has is still shown. */
  awardable: boolean;
  award: AwardsOverviewAward | null;
  translations?: StudentProgressSummaryTranslations;
}

export interface AwardsOverviewGrade {
  gradeid: string;
  gradename: string;
  levels: AwardsOverviewLevel[];
  translations?: StudentProgressSummaryTranslations;
}

/** What a learner receives for completing each tier of a curriculum (see constants/recognition.ts). */
export interface AwardsOverviewRecognition {
  level: string;
  grade: string;
  curriculum: string;
}

export interface AwardsOverviewCurriculum {
  curid: string;
  curriculumname: string;
  recognition: AwardsOverviewRecognition;
  grades: AwardsOverviewGrade[];
  translations?: StudentProgressSummaryTranslations;
}

export interface AwardsOverview {
  curricula: AwardsOverviewCurriculum[];
  earnedelsewhere: Array<AwardView & { translations?: StudentProgressSummaryTranslations }>;
}

type NamedRow = Record<string, unknown>;

/** Merges per-language field maps; the fields of different tables never share a name, so nothing is overwritten. */
const mergeTranslations = (...sources: Array<StudentProgressSummaryTranslations | undefined>): StudentProgressSummaryTranslations => {
  const merged: StudentProgressSummaryTranslations = {};
  for (const source of sources) {
    for (const [language, fields] of Object.entries(source ?? {})) merged[language] = { ...merged[language], ...fields };
  }
  return merged;
};

/**
 * Decorates rows that name a content row by `idkey` (not by the table's own key) and carry its name in `field`: the
 * translations are read for stand-in rows keyed the table's way, and handed back as the row's `translations`.
 */
const translationsOf = async (translations: ContentTranslations, table: "curriculums" | "grades" | "levels", pk: string, rows: NamedRow[], idkey: string, field: string) => {
  const stand = rows.map((row) => ({ [pk]: row[idkey], [field]: row[field] }));
  await translations.decorate(table, stand);
  return stand.map((s) => (s as { translations?: StudentProgressSummaryTranslations }).translations ?? {});
};

/**
 * Adds `translations` to each award row (the level, grade and curriculum names it carries, merged into one map), as
 * the progress summary does for its current level. A name the row does not carry (its content row is gone) has none.
 */
export const decorateAwardNames = async <T extends AwardView>(translations: ContentTranslations | undefined, rows: T[]): Promise<Array<T & { translations?: StudentProgressSummaryTranslations }>> => {
  if (!translations || rows.length === 0) return rows;
  const raw = rows as unknown as NamedRow[];
  const [lv, gr, cu] = await Promise.all([
    translationsOf(translations, "levels", "levelid", raw, "levelid", "levelname"),
    translationsOf(translations, "grades", "gradeid", raw, "gradeid", "gradename"),
    translationsOf(translations, "curriculums", "curriculumid", raw, "curid", "curriculumname"),
  ]);
  return rows.map((row, i) => ({ ...row, translations: mergeTranslations(lv[i], gr[i], cu[i]) }));
};

export interface StudentProgressSummaryCurrentLevel {
  levelid: string;
  levelname: string;
  gradeid: string;
  gradename: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  translations?: StudentProgressSummaryTranslations;
}

export interface StudentProgressSummaryLevel {
  levelid: string;
  levelname: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  completed: boolean;
  translations?: StudentProgressSummaryTranslations;
}

export interface StudentProgressSummaryGrade {
  gradeid: string;
  gradename: string;
  lessonsCompleted: number;
  lessonsTotal: number;
  levelsCompleted: number;
  levelsTotal: number;
  levels: StudentProgressSummaryLevel[];
  translations?: StudentProgressSummaryTranslations;
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
  translations?: StudentProgressSummaryTranslations;
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
  // Is this learner one of the given school's? (A learner of another school is "not found", like one that does not exist.)
  studentIsInSchool = async (studentid: unknown, school: SchoolScope) => {
    if (typeof studentid !== "string" || studentid.length === 0) return false;
    return (await students.count({ where: { studentid, ...studentsOfSchool(school) } })) > 0;
  };
  getstudentbyschool = (school: SchoolScope) => {
    return students.findAll({
      where: studentsOfSchool(school),
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
    // Each row's `schoolid` follows its school name (or the id it carries), so a
    // learner who changes school gets the new id with the new name. A learner whose
    // school this server does not have refuses the whole write (the column is required).
    const withSchools = await withRequiredSchoolIds(newstudents, transaction);
    for await (const student of withSchools) {
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
            "schoolid",
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
        // Rethrow the original error (was previously wrapped as a 400
        // carrying the raw error object as `errormessage`) so the global
        // filter's Sequelize mapping sees it and can return 503 for a
        // connection failure instead of a 400 leaking DB detail.
        throw e;
      }
    }
  }

  getstudentstats = async (studentid: string) => {
    const rows = await dbinstance.getdbinstance().query(
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
    // `ss.*` selects every column of students, and a model's default scope does
    // not apply to raw SQL: leave out the school id, which is not part of this
    // payload yet (see models/data-models/ownership-scope.ts).
    return rows.map((row) => omit(row, "schoolid"));
  };

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

  // The school filter is a name (as ever) or an id; a name is resolved once. A name no
  // school has yet filters by the name, as it always did.
  // The learners are the caller's school's (`own`, the token's). A school the request names can only narrow that:
  // the caller's own school is fine, any other school gives nothing.
  getStudentsWithFilter = async (userid: string, schoolname: unknown, schoolid: unknown, own: SchoolScope | undefined) => {
    if(own === undefined || !(await schoolRefIsOwn(own, { schoolid, schoolname }))) return [];
    const where: WhereOptions<studentsAttributes> = {
      "$schooluser.schoolusername$": {
        [Op.like]: `%${userid.trim()}%`
      },
      ...studentsOfSchool(own),
    };

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

  // The curricula, active grades and active levels the learner sees, in the order every learner screen shows them:
  // shared by "My progress" (getprogresssummary) and the awards overview so the two always agree on what exists.
  // No grade or level query is made when there is no enrolled curriculum (or no active grade).
  private getenrolledtree = async (user: Token) => {
    const curricula = await new CurriculumBusiness().getEnrolledCurriculums(user);
    if (curricula.length === 0) {
      return { curricula, activeGrades: [] as grades[], activeLevels: [] as levels[] };
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
    return { curricula, activeGrades, activeLevels };
  };

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
  // Level Detail screen uses; it feeds only the lesson counts.
  // A level is "completed" when any of the student's studentlevelsprogress
  // rows for it has completed === true (the flag the server sets when the
  // learner reaches 80% of the level's points), or an award was already earned
  // for the level (awards are never removed, while the flag can drop back when
  // a later result lowers the points), so the count and the awards always
  // agree. It is not "every lesson done"; no flag row, no true flag and no
  // award means not completed. The flags and the awards are each read in one
  // extra query for all counted levels. A level "counts" only when it has at least
  // one active lesson; a level with zero active lessons is excluded from both
  // levelsCompleted and levelsTotal and stays completed: false even if a flag
  // is set. currentLevel is the first counted level, ordered by grade
  // gradeorder then level levelorder, that is not completed; it is null once
  // every counted level is completed, or when the curriculum has no active
  // lessons at all. Its lessonsCompleted/lessonsTotal remain lesson counts.
  getprogresssummary = async (user: Token, translations?: ContentTranslations): Promise<StudentProgressSummary> => {
    const emptyTotals = { lessonsCompleted: 0, lessonsTotal: 0, levelsCompleted: 0, levelsTotal: 0 };
    const tree = await this.getenrolledtree(user);
    const { curricula } = tree;
    if (curricula.length === 0) {
      return { curricula: [], totals: emptyTotals };
    }

    const { activeGrades, activeLevels } = tree;
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

    // The stored 80% flag, one query for every counted level (a level with active lessons).
    const countedLevelIds = [...new Set(activeLessons.map((lesson) => lesson.levelid))];
    const levelFlagRows = countedLevelIds.length
      ? await studentlevelsprogress.findAll({
          where: { studentid: user.studentid, levelid: countedLevelIds },
          attributes: ["levelid", "completed"],
        })
      : [];
    const completedLevelIds = new Set<string>();
    for (const row of levelFlagRows) {
      if (row.completed === true) completedLevelIds.add(row.levelid);
    }
    // An earned award keeps the level completed even when the flag has since dropped back.
    const awardRows = countedLevelIds.length
      ? await studentawards.findAll({
          where: { studentid: user.studentid, levelid: countedLevelIds },
          attributes: ["levelid"],
        })
      : [];
    for (const row of awardRows) completedLevelIds.add(row.levelid);

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
          const levelComplete = completedLevelIds.has(level.levelid);
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

    if (translations) {
      // One query per table for the whole payload: every curriculum, grade and level row names itself, and the
      // current level (which names its level and its grade) takes both rows' translations.
      const gradeRows = curriculaOut.flatMap((cur) => cur.grades);
      const levelRows = gradeRows.flatMap((grade) => grade.levels);
      await translations.decorate("curriculums", curriculaOut);
      await translations.decorate("grades", gradeRows);
      await translations.decorate("levels", levelRows);
      for (const cur of curriculaOut) {
        const current = cur.currentLevel;
        if (!current) continue;
        const level = levelRows.find((l) => l.levelid === current.levelid);
        const grade = gradeRows.find((g) => g.gradeid === current.gradeid);
        const merged: StudentProgressSummaryTranslations = {};
        for (const source of [level?.translations ?? {}, grade?.translations ?? {}]) {
          for (const [language, fields] of Object.entries(source)) merged[language] = { ...merged[language], ...fields };
        }
        current.translations = merged;
      }
    }
    return { curricula: curriculaOut, totals };
  };

  // Single call backing the learner app's Awards screen: the same curricula, grades and levels as "My progress" (one
  // shared selection, getenrolledtree), each level with the learner's progress, whether it can be awarded and the award
  // earned for it. An award is kept for good, so a level that is now on a hidden single-item tier still shows the
  // award it already has, and an award whose level is no longer one of those levels is listed in `earnedelsewhere`.
  // A fixed number of queries: the curriculum tree, the school, one grouped count of live levels per grade, the level
  // progress rows and the awards, whatever the number of levels.
  getawardsoverview = async (user: Token, translations?: ContentTranslations): Promise<AwardsOverview> => {
    const studentid = user.studentid;
    const { curricula, activeGrades, activeLevels } = await this.getenrolledtree(user);
    const awards = studentid ? await awardsOfStudent(studentid) : [];
    const shown = new Set(activeLevels.map((level) => level.levelid));
    const awardOf = new Map<string, AwardView>();
    for (const award of awards) if (shown.has(award.levelid) && !awardOf.has(award.levelid)) awardOf.set(award.levelid, award);

    const progressrows = studentid && shown.size
      ? await studentlevelsprogress.findAll({ where: { studentid, levelid: [...shown] }, attributes: ["levelid", "progress"] })
      : [];
    const progressOf = new Map<string, number>();
    for (const row of progressrows) progressOf.set(row.levelid, Math.max(progressOf.get(row.levelid) ?? 0, Number(row.progress ?? 0)));

    const hidden = await hiddenSingleItemTierGradeIds(user, activeGrades.map((grade) => grade.gradeid));
    // The recognition setting of each curriculum: one query, through the scope that selects it.
    const recognitionRows = curricula.length
      ? await curriculums.scope("withRecognition").findAll({
          where: { curriculumid: curricula.map((cur) => cur.curriculumid) },
          attributes: ["curriculumid", ...RECOGNITION_FIELDS],
        })
      : [];
    const recognitionOf = new Map<string, AwardsOverviewRecognition>(
      recognitionRows.map((row) => [
        row.curriculumid,
        {
          level: row.levelrecognition ?? DEFAULT_RECOGNITION.levelrecognition,
          grade: row.graderecognition ?? DEFAULT_RECOGNITION.graderecognition,
          curriculum: row.curriculumrecognition ?? DEFAULT_RECOGNITION.curriculumrecognition,
        },
      ]),
    );
    const recognitionFor = (curriculumid: string): AwardsOverviewRecognition =>
      recognitionOf.get(curriculumid) ?? {
        level: DEFAULT_RECOGNITION.levelrecognition,
        grade: DEFAULT_RECOGNITION.graderecognition,
        curriculum: DEFAULT_RECOGNITION.curriculumrecognition,
      };
    const curriculumOfGrade = new Map(activeGrades.map((grade) => [grade.gradeid, grade.curriculumid]));

    const levelsByGrade = new Map<string, AwardsOverviewLevel[]>();
    for (const level of activeLevels) {
      const award = awardOf.get(level.levelid);
      const list = levelsByGrade.get(level.gradeid) ?? [];
      list.push({
        levelid: level.levelid,
        levelname: level.levelname,
        levelorder: level.levelorder,
        progress: progressOf.get(level.levelid) ?? 0,
        awardable: !hidden.has(level.gradeid) && recognitionFor(curriculumOfGrade.get(level.gradeid) ?? "").level === "award",
        award: award ? { studentawardid: award.studentawardid, earnedat: award.earnedat, earnedat_approximate: award.earnedat_approximate } : null,
      });
      levelsByGrade.set(level.gradeid, list);
    }
    const gradesByCurriculum = new Map<string, AwardsOverviewGrade[]>();
    for (const grade of activeGrades) {
      const list = gradesByCurriculum.get(grade.curriculumid) ?? [];
      list.push({ gradeid: grade.gradeid, gradename: grade.gradename, levels: levelsByGrade.get(grade.gradeid) ?? [] });
      gradesByCurriculum.set(grade.curriculumid, list);
    }
    const curriculaOut: AwardsOverviewCurriculum[] = curricula.map((cur) => ({
      curid: cur.curriculumid,
      curriculumname: cur.curriculumname,
      recognition: recognitionFor(cur.curriculumid),
      grades: gradesByCurriculum.get(cur.curriculumid) ?? [],
    }));

    if (translations) {
      // As the summary: one query per table for the whole payload.
      const gradeRows = curriculaOut.flatMap((cur) => cur.grades);
      const levelRows = gradeRows.flatMap((grade) => grade.levels);
      const [cu, gr, lv] = await Promise.all([
        translationsOf(translations, "curriculums", "curriculumid", curriculaOut as unknown as NamedRow[], "curid", "curriculumname"),
        translationsOf(translations, "grades", "gradeid", gradeRows as unknown as NamedRow[], "gradeid", "gradename"),
        translationsOf(translations, "levels", "levelid", levelRows as unknown as NamedRow[], "levelid", "levelname"),
      ]);
      curriculaOut.forEach((row, i) => (row.translations = cu[i]));
      gradeRows.forEach((row, i) => (row.translations = gr[i]));
      levelRows.forEach((row, i) => (row.translations = lv[i]));
    }
    const elsewhere = awards.filter((award) => !shown.has(award.levelid));
    return { curricula: curriculaOut, earnedelsewhere: await decorateAwardNames(translations, elsewhere) };
  };

  // `scope` (see report-scope.ts): only logins of learners and staff in the scope are answered; the rest are left
  // out, as if they had never signed in. Undefined or null: no limit (the platform's view).
  getlogintime = async (schooluserids: string[], scope?: ReportScope | null) => {
    let ids = Array.isArray(schooluserids) ? schooluserids.filter((id) => typeof id === "string") : [];
    if (scope && ids.length > 0) {
      const mine = learnersInScope(scope);
      const named = { schooluserid: { [Op.in]: ids } };
      const learners = await students.findAll({ where: { [Op.and]: [named, mine] }, attributes: ["schooluserid"], raw: true });
      const logins = await schoolusers.scope("withOwnership").findAll({ where: { [Op.and]: [named, mine] }, attributes: ["schooluserid"], raw: true });
      const allowed = new Set([...learners, ...logins].map((r) => String((r as unknown as { schooluserid: string }).schooluserid).toLowerCase()));
      ids = ids.filter((id) => allowed.has(id.toLowerCase()));
    }
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
