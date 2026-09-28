import { Op } from "sequelize";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { lessons } from "src/models/data-models/lessons";
import { levels } from "src/models/data-models/levels";
import { students } from "src/models/data-models/students";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { Token } from "src/models/token.model";

interface LibraryLevel {
  levelid: string;
  levelname: string;
  leveldescription: string | null;
  levelorder: number;
  progress: number;
  number_lessons: number;
  number_completed_lessons: number;
}

interface LibraryGrade {
  gradeid: string;
  gradename: string;
  gradeorder: number;
  progress: number;
  levels: LibraryLevel[];
}

interface LibraryCurriculum {
  curriculumid: string;
  curriculumname: string;
  curriculumdescription: string | null;
  progress: number;
  grades: LibraryGrade[];
}

interface Library {
  generated_at: string;
  curricula: LibraryCurriculum[];
}

/**
 * GET /level/library — a single read-only call that returns every
 * curriculum/grade/level the student currently has access to, with the
 * same progress numbers the existing per-tier endpoints already show.
 *
 * All queries are batched: one query per table with `Op.in`, grouped in
 * JS afterwards. No per-row queries.
 */
export class LibraryBusiness {
  getLibrary = async (user: Token): Promise<Library> => {
    const generated_at = new Date().toISOString();
    const empty: Library = { generated_at, curricula: [] };

    // A token with no linked student (e.g. a server sync key) has nothing
    // to show here, same as the other student-only routes.
    if (!user.studentid) return empty;

    // Curricula the student has access to must come from the DB, not the
    // JWT `curriculumids` claim, which is stale until the student
    // re-logs-in (see grade/curriculum access checks elsewhere).
    const student = await students.findOne({
      where: { studentid: user.studentid },
      attributes: ["studentid", "curriculumids"],
    });
    if (!student) return empty;

    const curriculumids = Array.isArray(student.curriculumids)
      ? student.curriculumids.filter((c): c is string => typeof c === "string")
      : [];
    if (curriculumids.length === 0) return empty;

    // --- curricula --------------------------------------------------
    // Same active/non-deleted filter as CurriculumBusiness.getCurriculumsWithSubject,
    // ordered the same way (by curriculumname) so curricula appear in the
    // same order as `curriculum/subjects`.
    const currs = await curriculums.findAll({
      where: {
        curriculumid: { [Op.in]: curriculumids },
        curriculumstatus: true,
        isdeleted: false,
      },
      attributes: ["curriculumid", "curriculumname", "curriculumdescription"],
      order: ["curriculumname"],
    });
    if (currs.length === 0) return empty;
    const foundCurriculumIds = currs.map((c) => c.curriculumid);

    // --- grades -------------------------------------------------------
    // Same filter as GradeBusiness.getgradesbycurriculumid, ordered by gradeorder.
    const allGrades = foundCurriculumIds.length
      ? await grades.findAll({
          where: {
            curriculumid: { [Op.in]: foundCurriculumIds },
            gradestatus: true,
            isdeleted: false,
          },
          attributes: ["gradeid", "curriculumid", "gradename", "gradeorder", "points"],
          order: [["gradeorder", "ASC"]],
        })
      : [];
    const gradeids = allGrades.map((g) => g.gradeid);

    // --- levels ---------------------------------------------------------
    // Same filter as LevelBusiness.getlevelsbygradeid ("level/grade/:id"), ordered by levelorder.
    const allLevels = gradeids.length
      ? await levels.findAll({
          where: {
            gradeid: { [Op.in]: gradeids },
            levelstatus: true,
            isdeleted: false,
          },
          attributes: ["levelid", "gradeid", "levelname", "leveldescription", "levelorder", "points"],
          order: [["levelorder", "ASC"]],
        })
      : [];
    const levelids = allLevels.map((l) => l.levelid);

    // --- lessons (active only, for number_lessons) -----------------------
    // total_points is needed to reproduce the app's "done" rule below.
    const allLessons = levelids.length
      ? await lessons.findAll({
          where: {
            levelid: { [Op.in]: levelids },
            lessonstatus: true,
            isdeleted: false,
          },
          attributes: ["lessonid", "levelid", "total_points"],
        })
      : [];
    const lessonids = allLessons.map((l) => l.lessonid);

    // --- progress rows, one batched query per table --------------------
    // Grade progress: same source/formula as GradeBusiness.getgradesbycurriculumid
    // ("grade/curriculum/:id") — studentgradesprogress.points / grades.points * 100.
    const gradeProgressRows = gradeids.length
      ? await studentgradesprogress.findAll({
          where: { studentid: user.studentid, gradeid: { [Op.in]: gradeids } },
          attributes: ["gradeid", "points"],
        })
      : [];

    // Level progress: same source/formula as LevelBusiness.getlevelsbygradeid
    // ("level/grade/:id") — studentlevelsprogress.points / levels.points * 100.
    const levelProgressRows = levelids.length
      ? await studentlevelsprogress.findAll({
          where: { studentid: user.studentid, levelid: { [Op.in]: levelids } },
          attributes: ["levelid", "points"],
        })
      : [];

    // Lesson progress rows (not filtered to completed = true): the app's
    // Level screen counts a lesson done when `lesson.completed === true ||
    // (lesson.progress ?? 0) >= 100` (LevelSelectionScreen.tsx isLessonDone),
    // where progress is `points*100/total_points` as lesson/level/:id
    // returns it (lesson.business.ts getlessonsbylevelid). We need both
    // `points` and `completed` here to reproduce that rule exactly.
    const lessonProgressRows = lessonids.length
      ? await studentlessonsprogress.findAll({
          where: {
            studentid: user.studentid,
            lessonid: { [Op.in]: lessonids },
          },
          attributes: ["lessonid", "points", "completed"],
        })
      : [];

    // --- group everything in JS, no per-row queries ---------------------
    const gradesByCurriculum = new Map<string, typeof allGrades>();
    for (const g of allGrades) {
      const list = gradesByCurriculum.get(g.curriculumid) ?? [];
      list.push(g);
      gradesByCurriculum.set(g.curriculumid, list);
    }

    const levelsByGrade = new Map<string, typeof allLevels>();
    for (const l of allLevels) {
      const list = levelsByGrade.get(l.gradeid) ?? [];
      list.push(l);
      levelsByGrade.set(l.gradeid, list);
    }

    const lessonsByLevel = new Map<string, typeof allLessons>();
    for (const le of allLessons) {
      const list = lessonsByLevel.get(le.levelid) ?? [];
      list.push(le);
      lessonsByLevel.set(le.levelid, list);
    }

    // Keep the FIRST row per id, matching the `[0]` the existing per-tier
    // endpoints use when a student ends up with more than one progress row
    // for the same grade/level/lesson.
    const gradeProgressByGrade = new Map<string, number>();
    for (const gp of gradeProgressRows) {
      if (!gradeProgressByGrade.has(gp.gradeid)) {
        gradeProgressByGrade.set(gp.gradeid, gp.points ?? 0);
      }
    }

    const levelProgressByLevel = new Map<string, number>();
    for (const lp of levelProgressRows) {
      if (!levelProgressByLevel.has(lp.levelid)) {
        levelProgressByLevel.set(lp.levelid, lp.points ?? 0);
      }
    }

    const lessonProgressByLesson = new Map<
      string,
      { points: number | null | undefined; completed: boolean | null | undefined }
    >();
    for (const lp of lessonProgressRows) {
      if (!lessonProgressByLesson.has(lp.lessonid)) {
        lessonProgressByLesson.set(lp.lessonid, { points: lp.points, completed: lp.completed });
      }
    }

    // Reproduces lesson.business.ts getlessonsbylevelid's progress formula
    // and LevelSelectionScreen.tsx's isLessonDone rule exactly, including
    // the total_points == 0/null edge case: the app computes
    // points*100/total_points, so a null/0 total_points with points > 0
    // divides to Infinity, which is >= 100 and counts as done.
    const isLessonComplete = (lessonid: string, totalPoints: number | null | undefined): boolean => {
      const row = lessonProgressByLesson.get(lessonid);
      if (!row) return false;
      if (row.completed === true) return true;
      const progress = row.points
        ? Number(((row.points * 100) / (totalPoints as number)).toFixed(2))
        : 0;
      return progress >= 100;
    };

    const curricula: LibraryCurriculum[] = currs.map((cur) => {
      const curriculumGrades = (gradesByCurriculum.get(cur.curriculumid) ?? [])
        .slice()
        .sort((a, b) => a.gradeorder - b.gradeorder);

      const gradesOut: LibraryGrade[] = curriculumGrades.map((g) => {
        const gradeLevels = (levelsByGrade.get(g.gradeid) ?? [])
          .slice()
          .sort((a, b) => a.levelorder - b.levelorder);

        const levelsOut: LibraryLevel[] = gradeLevels.map((lv) => {
          const levelLessons = lessonsByLevel.get(lv.levelid) ?? [];
          const number_lessons = levelLessons.length;
          const number_completed_lessons = levelLessons.filter((le) =>
            isLessonComplete(le.lessonid, le.total_points)
          ).length;

          const studentPoints = levelProgressByLevel.get(lv.levelid) ?? 0;
          const progress =
            studentPoints && lv.points
              ? Number(Number((studentPoints * 100) / lv.points).toFixed(2))
              : 0;

          return {
            levelid: lv.levelid,
            levelname: lv.levelname,
            leveldescription: lv.leveldescription ?? null,
            levelorder: lv.levelorder,
            progress,
            number_lessons,
            number_completed_lessons,
          };
        });

        const studentPoints = gradeProgressByGrade.get(g.gradeid) ?? 0;
        const progress =
          studentPoints && g.points
            ? Number(Number((studentPoints * 100) / g.points).toFixed(2))
            : 0;

        return {
          gradeid: g.gradeid,
          gradename: g.gradename,
          gradeorder: g.gradeorder,
          progress,
          levels: levelsOut,
        };
      });

      // Curriculum progress: same formula as
      // CurriculumBusiness.getCurriculumsWithSubject ("curriculum/subjects")
      // — the mean of its grades' progress, 0 when it has none.
      const progress =
        gradesOut.length > 0
          ? Number(
              Number(
                gradesOut.reduce((sum, g) => sum + g.progress, 0) / gradesOut.length
              ).toFixed(2)
            )
          : 0;

      return {
        curriculumid: cur.curriculumid,
        curriculumname: cur.curriculumname,
        curriculumdescription: cur.curriculumdescription ?? null,
        progress,
        grades: gradesOut,
      };
    });

    return { generated_at, curricula };
  };
}
