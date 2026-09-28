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
import { LibraryBusiness } from "./library.business";

/**
 * Unit spec for LibraryBusiness (GET /level/library). Every Sequelize model
 * call is mocked — no database — so these prove the JS-side grouping,
 * ordering and progress arithmetic, not the SQL filters themselves (those
 * are asserted against the `where` options the business method actually
 * sends).
 */
describe("LibraryBusiness.getLibrary", () => {
  const user: Token = { studentid: "student-1", schooluserid: "su-1" };

  let studentsFindOne: jest.SpyInstance;
  let curriculumsFindAll: jest.SpyInstance;
  let gradesFindAll: jest.SpyInstance;
  let levelsFindAll: jest.SpyInstance;
  let lessonsFindAll: jest.SpyInstance;
  let gradeProgressFindAll: jest.SpyInstance;
  let levelProgressFindAll: jest.SpyInstance;
  let lessonProgressFindAll: jest.SpyInstance;

  beforeEach(() => {
    studentsFindOne = jest.spyOn(students, "findOne");
    curriculumsFindAll = jest.spyOn(curriculums, "findAll").mockResolvedValue([] as never);
    gradesFindAll = jest.spyOn(grades, "findAll").mockResolvedValue([] as never);
    levelsFindAll = jest.spyOn(levels, "findAll").mockResolvedValue([] as never);
    lessonsFindAll = jest.spyOn(lessons, "findAll").mockResolvedValue([] as never);
    gradeProgressFindAll = jest
      .spyOn(studentgradesprogress, "findAll")
      .mockResolvedValue([] as never);
    levelProgressFindAll = jest
      .spyOn(studentlevelsprogress, "findAll")
      .mockResolvedValue([] as never);
    lessonProgressFindAll = jest
      .spyOn(studentlessonsprogress, "findAll")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const fullFixture = () => {
    studentsFindOne.mockResolvedValue({
      studentid: "student-1",
      curriculumids: ["cur-1"],
    } as never);
    curriculumsFindAll.mockResolvedValue([
      { curriculumid: "cur-1", curriculumname: "Math", curriculumdescription: "desc" },
    ] as never);
    // Returned out of gradeorder to prove the business method sorts, not the mock.
    gradesFindAll.mockResolvedValue([
      { gradeid: "grade-2", curriculumid: "cur-1", gradename: "Grade 2", gradeorder: 2, points: 100 },
      { gradeid: "grade-1", curriculumid: "cur-1", gradename: "Grade 1", gradeorder: 1, points: 100 },
    ] as never);
    // Returned out of levelorder, both grades represented.
    levelsFindAll.mockResolvedValue([
      { levelid: "level-1b", gradeid: "grade-1", levelname: "Level 1B", leveldescription: null, levelorder: 2, points: 100 },
      { levelid: "level-1a", gradeid: "grade-1", levelname: "Level 1A", leveldescription: "d", levelorder: 1, points: 100 },
      { levelid: "level-2a", gradeid: "grade-2", levelname: "Level 2A", leveldescription: null, levelorder: 1, points: 100 },
    ] as never);
    lessonsFindAll.mockResolvedValue([
      { lessonid: "lesson-1", levelid: "level-1a", total_points: 100 },
      { lessonid: "lesson-2", levelid: "level-1a", total_points: 100 },
      { lessonid: "lesson-3", levelid: "level-1b", total_points: 100 },
    ] as never);
    gradeProgressFindAll.mockResolvedValue([
      { gradeid: "grade-1", points: 50 },
    ] as never);
    levelProgressFindAll.mockResolvedValue([
      { levelid: "level-1a", points: 100 },
    ] as never);
    // lesson-1 is done via the `completed` flag (points < total_points, so
    // it would NOT be done under the old "progress >= 100" only rule).
    // lesson-2 and lesson-3 are untouched.
    lessonProgressFindAll.mockResolvedValue([
      { lessonid: "lesson-1", points: 80, completed: true },
    ] as never);
  };

  it("groups and orders grades by gradeorder and levels by levelorder", async () => {
    fullFixture();

    const result = await new LibraryBusiness().getLibrary(user);

    expect(result.curricula).toHaveLength(1);
    const [cur] = result.curricula;
    expect(cur.grades.map((g) => g.gradeid)).toEqual(["grade-1", "grade-2"]);
    const grade1 = cur.grades.find((g) => g.gradeid === "grade-1")!;
    expect(grade1.levels.map((l) => l.levelid)).toEqual(["level-1a", "level-1b"]);
  });

  it("counts a level's active lessons and the student's completed ones, matching the app's isLessonDone rule (completed flag OR progress >= 100)", async () => {
    fullFixture();

    const result = await new LibraryBusiness().getLibrary(user);
    const level1a = result.curricula[0].grades
      .find((g) => g.gradeid === "grade-1")!
      .levels.find((l) => l.levelid === "level-1a")!;

    // lesson-1: points 80/100 (progress 80, NOT >= 100) but completed: true
    // -> counted only because of the completed flag.
    // lesson-2: no progress row -> not counted.
    expect(level1a.number_lessons).toBe(2);
    expect(level1a.number_completed_lessons).toBe(1);
  });

  it("counts a lesson done via progress >= 100 even when completed is false (fails if the >= 100 branch is removed)", async () => {
    studentsFindOne.mockResolvedValue({
      studentid: "student-1",
      curriculumids: ["cur-1"],
    } as never);
    curriculumsFindAll.mockResolvedValue([
      { curriculumid: "cur-1", curriculumname: "Math", curriculumdescription: null },
    ] as never);
    gradesFindAll.mockResolvedValue([
      { gradeid: "grade-1", curriculumid: "cur-1", gradename: "Grade 1", gradeorder: 1, points: 100 },
    ] as never);
    levelsFindAll.mockResolvedValue([
      { levelid: "level-1", gradeid: "grade-1", levelname: "Level 1", leveldescription: null, levelorder: 1, points: 100 },
    ] as never);
    lessonsFindAll.mockResolvedValue([
      { lessonid: "lesson-1", levelid: "level-1", total_points: 100 },
    ] as never);
    // points === total_points -> progress is exactly 100, but completed is
    // explicitly false. If the `>= 100` branch were removed and only the
    // `completed` flag were checked, this lesson would wrongly be uncounted.
    lessonProgressFindAll.mockResolvedValue([
      { lessonid: "lesson-1", points: 100, completed: false },
    ] as never);

    const result = await new LibraryBusiness().getLibrary(user);
    const level1 = result.curricula[0].grades[0].levels[0];

    expect(level1.number_completed_lessons).toBe(1);
  });

  it("treats a null/zero total_points with points > 0 as done, matching the app's Infinity >= 100 behavior", async () => {
    studentsFindOne.mockResolvedValue({
      studentid: "student-1",
      curriculumids: ["cur-1"],
    } as never);
    curriculumsFindAll.mockResolvedValue([
      { curriculumid: "cur-1", curriculumname: "Math", curriculumdescription: null },
    ] as never);
    gradesFindAll.mockResolvedValue([
      { gradeid: "grade-1", curriculumid: "cur-1", gradename: "Grade 1", gradeorder: 1, points: 100 },
    ] as never);
    levelsFindAll.mockResolvedValue([
      { levelid: "level-1", gradeid: "grade-1", levelname: "Level 1", leveldescription: null, levelorder: 1, points: 100 },
    ] as never);
    lessonsFindAll.mockResolvedValue([
      { lessonid: "lesson-1", levelid: "level-1", total_points: 0 },
    ] as never);
    lessonProgressFindAll.mockResolvedValue([
      { lessonid: "lesson-1", points: 10, completed: false },
    ] as never);

    const result = await new LibraryBusiness().getLibrary(user);
    const level1 = result.curricula[0].grades[0].levels[0];

    expect(level1.number_completed_lessons).toBe(1);
  });

  it("computes level progress as studentlevelsprogress.points / levels.points * 100, and 0 with no row", async () => {
    fullFixture();

    const result = await new LibraryBusiness().getLibrary(user);
    const grade1 = result.curricula[0].grades.find((g) => g.gradeid === "grade-1")!;
    const level1a = grade1.levels.find((l) => l.levelid === "level-1a")!;
    const level1b = grade1.levels.find((l) => l.levelid === "level-1b")!;

    expect(level1a.progress).toBe(100); // 100/100*100
    expect(level1b.progress).toBe(0); // no studentlevelsprogress row
  });

  it("computes grade progress as studentgradesprogress.points / grades.points * 100, and 0 with no row", async () => {
    fullFixture();

    const result = await new LibraryBusiness().getLibrary(user);
    const grade1 = result.curricula[0].grades.find((g) => g.gradeid === "grade-1")!;
    const grade2 = result.curricula[0].grades.find((g) => g.gradeid === "grade-2")!;

    expect(grade1.progress).toBe(50); // 50/100*100
    expect(grade2.progress).toBe(0); // no studentgradesprogress row
  });

  it("computes curriculum progress as the mean of its grades' progress", async () => {
    fullFixture();

    const result = await new LibraryBusiness().getLibrary(user);

    // grade-1 progress 50, grade-2 progress 0 -> mean 25
    expect(result.curricula[0].progress).toBe(25);
  });

  it("returns an empty curricula list for a student with no curriculumids, without querying grades/levels", async () => {
    studentsFindOne.mockResolvedValue({ studentid: "student-1", curriculumids: [] } as never);

    const result = await new LibraryBusiness().getLibrary(user);

    expect(result.curricula).toEqual([]);
    expect(curriculumsFindAll).not.toHaveBeenCalled();
    expect(gradesFindAll).not.toHaveBeenCalled();
  });

  it("returns an empty curricula list for a token with no studentid, without hitting the DB", async () => {
    const result = await new LibraryBusiness().getLibrary({} as Token);

    expect(result.curricula).toEqual([]);
    expect(studentsFindOne).not.toHaveBeenCalled();
  });

  it("returns an empty curricula list when the token's student row cannot be found", async () => {
    studentsFindOne.mockResolvedValue(null as never);

    const result = await new LibraryBusiness().getLibrary(user);

    expect(result.curricula).toEqual([]);
    expect(curriculumsFindAll).not.toHaveBeenCalled();
  });

  it("filters curricula, grades and levels to active, non-deleted rows in the DB query", async () => {
    fullFixture();

    await new LibraryBusiness().getLibrary(user);

    const curOptions: any = curriculumsFindAll.mock.calls[0][0];
    expect(curOptions.where.curriculumstatus).toBe(true);
    expect(curOptions.where.isdeleted).toBe(false);

    const gradeOptions: any = gradesFindAll.mock.calls[0][0];
    expect(gradeOptions.where.gradestatus).toBe(true);
    expect(gradeOptions.where.isdeleted).toBe(false);

    const levelOptions: any = levelsFindAll.mock.calls[0][0];
    expect(levelOptions.where.levelstatus).toBe(true);
    expect(levelOptions.where.isdeleted).toBe(false);

    const lessonOptions: any = lessonsFindAll.mock.calls[0][0];
    expect(lessonOptions.where.lessonstatus).toBe(true);
    expect(lessonOptions.where.isdeleted).toBe(false);
  });

  it("scopes every query to the token's own studentid, never another student's", async () => {
    fullFixture();

    await new LibraryBusiness().getLibrary(user);

    expect(studentsFindOne.mock.calls[0][0].where.studentid).toBe("student-1");
    expect(gradeProgressFindAll.mock.calls[0][0].where.studentid).toBe("student-1");
    expect(levelProgressFindAll.mock.calls[0][0].where.studentid).toBe("student-1");
    expect(lessonProgressFindAll.mock.calls[0][0].where.studentid).toBe("student-1");
  });

  it("computes a fractional level progress (1/3) rounded to 2 decimals, same as computes elsewhere", async () => {
    studentsFindOne.mockResolvedValue({
      studentid: "student-1",
      curriculumids: ["cur-1"],
    } as never);
    curriculumsFindAll.mockResolvedValue([
      { curriculumid: "cur-1", curriculumname: "Math", curriculumdescription: null },
    ] as never);
    gradesFindAll.mockResolvedValue([
      { gradeid: "grade-1", curriculumid: "cur-1", gradename: "Grade 1", gradeorder: 1, points: 100 },
    ] as never);
    levelsFindAll.mockResolvedValue([
      { levelid: "level-1", gradeid: "grade-1", levelname: "Level 1", leveldescription: null, levelorder: 1, points: 3 },
    ] as never);
    levelProgressFindAll.mockResolvedValue([{ levelid: "level-1", points: 1 }] as never);

    const result = await new LibraryBusiness().getLibrary(user);
    const level1 = result.curricula[0].grades[0].levels[0];

    expect(level1.progress).toBe(33.33);
  });

  it("uses the DB's curriculumids, ignoring a different set on the token claim", async () => {
    fullFixture();
    // The token carries a stale/mismatched curriculumids claim; only the
    // DB row (fetched fresh in getLibrary) should decide what's returned.
    const staleTokenUser: Token = {
      ...user,
      curriculumids: ["cur-does-not-exist"],
    };

    const result = await new LibraryBusiness().getLibrary(staleTokenUser);

    expect(result.curricula).toHaveLength(1);
    expect(result.curricula[0].curriculumid).toBe("cur-1");
    // The token's curriculumids claim must never reach the curricula query.
    const curOptions: any = curriculumsFindAll.mock.calls[0][0];
    expect(curOptions.where.curriculumid[Op.in]).toEqual(["cur-1"]);
  });

  it("returns generated_at as an ISO timestamp", async () => {
    fullFixture();

    const result = await new LibraryBusiness().getLibrary(user);

    expect(() => new Date(result.generated_at).toISOString()).not.toThrow();
    expect(new Date(result.generated_at).toISOString()).toBe(result.generated_at);
  });
});
