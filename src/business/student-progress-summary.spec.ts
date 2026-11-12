/**
 * StudentBusiness.getprogresssummary backs the Expo app's "My progress"
 * screen (overall %, "Lessons completed X of Y", "Levels completed A of B",
 * and a per-curriculum "By curriculum" list with a currentLevel). This spec
 * proves the aggregation rules without a DB, in the style of
 * grade-progress-group-by.spec.ts: findAll is mocked on each model so no
 * query ever reaches a database, and the business method's own JS-side
 * grouping/aggregation is exercised directly.
 *
 * Rules covered:
 *  - a lesson counts as done via studentlessonsprogress.completed === true
 *  - a lesson also counts as done via progress >= 100 even if completed is
 *    false/missing
 *  - a level is "completed" only when the student's studentlevelsprogress
 *    row for it has completed === true (the stored 80% flag awards use);
 *    lesson counts do not decide it; any true row counts, and so does an
 *    earned studentawards row for the level (awards are never removed)
 *  - a level with zero active lessons is excluded from levelsCompleted AND
 *    levelsTotal (not counted as incomplete, not counted at all)
 *  - currentLevel is the first level, in (grade gradeorder, level
 *    levelorder) order, that has an active lesson and is not completed --
 *    later incomplete levels must not overwrite it
 *  - currentLevel is null when every level in a curriculum is completed
 *  - every query is scoped to the requesting student and to
 *    active/non-deleted rows -- most importantly studentlessonsprogress is
 *    scoped to studentid so one student never sees another's progress
 *  - grade and level ordering carries deterministic tie-breaks (gradename/
 *    gradeid, levelname/levelid) so currentLevel selection can't go
 *    nondeterministic when two grades or levels share an order value
 */
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { levels } from "src/models/data-models/levels";
import { lessons } from "src/models/data-models/lessons";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentawards } from "src/models/data-models/studentawards";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { StudentBusiness } from "./student.business";

describe("StudentBusiness.getprogresssummary", () => {
  const user: any = { studentid: "student-1", curriculumids: ["cur-A", "cur-B"] };

  const curriculumA = { curriculumid: "cur-A", curriculumname: "Curriculum A" };
  const curriculumB = { curriculumid: "cur-B", curriculumname: "Curriculum B" };

  // Curriculum A: grade A1 has level L1 (fully done, 1/1) then level L2
  // (1/2 done -- one lesson done via completed, one done via progress>=100
  // so both rules get exercised); grade A2 has a zero-lesson level L3
  // followed by an untouched level L4.
  const gradeA1 = { gradeid: "grade-A1", curriculumid: "cur-A", gradename: "Grade A1", gradeorder: 1 };
  const gradeA2 = { gradeid: "grade-A2", curriculumid: "cur-A", gradename: "Grade A2", gradeorder: 2 };
  // Curriculum B: single grade/level, fully completed -> currentLevel null.
  const gradeB1 = { gradeid: "grade-B1", curriculumid: "cur-B", gradename: "Grade B1", gradeorder: 1 };

  const levelL1 = { levelid: "level-L1", gradeid: "grade-A1", levelname: "Level 1", levelorder: 1 };
  const levelL2 = { levelid: "level-L2", gradeid: "grade-A1", levelname: "Level 2", levelorder: 2 };
  const levelL3 = { levelid: "level-L3", gradeid: "grade-A2", levelname: "Level 3 (no lessons)", levelorder: 1 };
  const levelL4 = { levelid: "level-L4", gradeid: "grade-A2", levelname: "Level 4", levelorder: 2 };
  const levelLB1 = { levelid: "level-LB1", gradeid: "grade-B1", levelname: "Level B1", levelorder: 1 };

  const lessonL1a = { lessonid: "lesson-L1a", levelid: "level-L1" };
  const lessonL2a = { lessonid: "lesson-L2a", levelid: "level-L2" };
  const lessonL2b = { lessonid: "lesson-L2b", levelid: "level-L2" };
  const lessonL4a = { lessonid: "lesson-L4a", levelid: "level-L4" };
  const lessonLB1a = { lessonid: "lesson-LB1a", levelid: "level-LB1" };

  let curriculumsFindAllSpy: jest.SpyInstance;
  let gradesFindAllSpy: jest.SpyInstance;
  let levelsFindAllSpy: jest.SpyInstance;
  let lessonsFindAllSpy: jest.SpyInstance;
  let progressFindAllSpy: jest.SpyInstance;
  let levelFlagsFindAllSpy: jest.SpyInstance;
  let awardsFindAllSpy: jest.SpyInstance;
  let awardRows: any[];

  // Stored level flags (studentlevelsprogress), every student's; the mock
  // filters by the where clause the way the database would.
  let levelFlagRows: any[];

  // Mutable so individual tests can break just the progress rows without
  // duplicating the whole setup.
  let progressRows: any[];

  beforeEach(() => {
    progressRows = [
      { lessonid: "lesson-L1a", completed: true, progress: 0 }, // done via completed
      { lessonid: "lesson-L2a", completed: false, progress: 100 }, // done via progress >= 100
      { lessonid: "lesson-L2b", completed: false, progress: 50 }, // not done
      // lesson-L4a: no row at all -> not done
      { lessonid: "lesson-LB1a", completed: true, progress: 0 },
    ];

    // L1 and LB1 carry the stored flag; L2 (1/2 lessons) and L4 do not.
    levelFlagRows = [
      { studentid: "student-1", levelid: "level-L1", completed: true },
      { studentid: "student-1", levelid: "level-LB1", completed: true },
    ];

    awardRows = [];

    curriculumsFindAllSpy = jest
      .spyOn(curriculums, "findAll")
      .mockResolvedValue([curriculumA, curriculumB] as never);
    gradesFindAllSpy = jest
      .spyOn(grades, "findAll")
      .mockResolvedValue([gradeA1, gradeA2, gradeB1] as never);
    levelsFindAllSpy = jest
      .spyOn(levels, "findAll")
      .mockResolvedValue([levelL1, levelL2, levelL3, levelL4, levelLB1] as never);
    lessonsFindAllSpy = jest
      .spyOn(lessons, "findAll")
      .mockResolvedValue([lessonL1a, lessonL2a, lessonL2b, lessonL4a, lessonLB1a] as never);
    progressFindAllSpy = jest
      .spyOn(studentlessonsprogress, "findAll")
      .mockImplementation(async () => progressRows as never);
    levelFlagsFindAllSpy = jest.spyOn(studentlevelsprogress, "findAll").mockImplementation((async (opts: any) => {
      const { studentid, levelid } = opts.where;
      const wanted = Array.isArray(levelid) ? levelid : [levelid];
      return levelFlagRows.filter((r) => r.studentid === studentid && wanted.includes(r.levelid));
    }) as never);
    awardsFindAllSpy = jest.spyOn(studentawards, "findAll").mockImplementation((async (opts: any) => {
      const { studentid, levelid } = opts.where;
      const wanted = Array.isArray(levelid) ? levelid : [levelid];
      return awardRows.filter((r) => r.studentid === studentid && wanted.includes(r.levelid));
    }) as never);
  });

  afterEach(() => {
    curriculumsFindAllSpy.mockRestore();
    gradesFindAllSpy.mockRestore();
    levelsFindAllSpy.mockRestore();
    lessonsFindAllSpy.mockRestore();
    progressFindAllSpy.mockRestore();
    levelFlagsFindAllSpy.mockRestore();
    awardsFindAllSpy.mockRestore();
  });

  it("aggregates lesson/level completion per curriculum with correct currentLevel and totals", async () => {
    const result = await new StudentBusiness().getprogresssummary(user);

    expect(result.curricula).toHaveLength(2);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A");
    const curB = result.curricula.find((c) => c.curriculumid === "cur-B");
    expect(curA).toBeDefined();
    expect(curB).toBeDefined();

    // Curriculum A: L1 (1/1 done), L2 (1/2 done), L3 excluded (no lessons),
    // L4 (0/1 done). Lessons: 1+2+1=4 total, 1+1+0=2 done.
    expect(curA).toMatchObject({
      lessonsTotal: 4,
      lessonsCompleted: 2,
      levelsTotal: 3, // L1, L2, L4 -- L3 excluded
      levelsCompleted: 1, // only L1
    });
    // First incomplete level in (gradeorder, levelorder) order is L2, not
    // L4 -- proves ordering and that a later incomplete level never
    // overwrites the first one found.
    expect(curA!.currentLevel).toMatchObject({
      levelid: "level-L2",
      gradeid: "grade-A1",
      lessonsCompleted: 1,
      lessonsTotal: 2,
    });

    // Curriculum B: single fully-completed level -> currentLevel null.
    expect(curB).toMatchObject({
      lessonsTotal: 1,
      lessonsCompleted: 1,
      levelsTotal: 1,
      levelsCompleted: 1,
    });
    expect(curB!.currentLevel).toBeNull();

    // Totals sum across curricula.
    expect(result.totals).toEqual({
      lessonsTotal: 5,
      lessonsCompleted: 3,
      levelsTotal: 4,
      levelsCompleted: 2,
    });

    // Additive `grades` array: same deterministic order as the grades
    // query (gradeorder/gradename/gradeid), each grade carrying its own
    // levels array in level order, so the Expo app's Courses/Units cards
    // can show lessons-based % without a second call.
    expect(curA!.grades.map((g) => g.gradeid)).toEqual(["grade-A1", "grade-A2"]);

    const gradeA1Out = curA!.grades.find((g) => g.gradeid === "grade-A1")!;
    expect(gradeA1Out).toMatchObject({
      lessonsTotal: 3, // L1 (1) + L2 (2)
      lessonsCompleted: 2, // L1 (1) + L2 (1)
      levelsTotal: 2,
      levelsCompleted: 1,
    });
    expect(gradeA1Out.levels.map((l) => l.levelid)).toEqual(["level-L1", "level-L2"]);
    expect(gradeA1Out.levels).toEqual([
      { levelid: "level-L1", levelname: "Level 1", lessonsCompleted: 1, lessonsTotal: 1, completed: true },
      { levelid: "level-L2", levelname: "Level 2", lessonsCompleted: 1, lessonsTotal: 2, completed: false },
    ]);

    const gradeA2Out = curA!.grades.find((g) => g.gradeid === "grade-A2")!;
    expect(gradeA2Out).toMatchObject({
      lessonsTotal: 1, // L3 contributes 0, L4 contributes 1
      lessonsCompleted: 0,
      levelsTotal: 1, // L3 excluded (zero lessons)
      levelsCompleted: 0,
    });
    // L3 has zero active lessons: still present in the levels array (so the
    // app can render a "no lessons" state) with 0/0 and completed false,
    // but it must not be the entry that inflates levelsTotal above.
    expect(gradeA2Out.levels).toEqual([
      { levelid: "level-L3", levelname: "Level 3 (no lessons)", lessonsCompleted: 0, lessonsTotal: 0, completed: false },
      { levelid: "level-L4", levelname: "Level 4", lessonsCompleted: 0, lessonsTotal: 1, completed: false },
    ]);

    const gradeB1Out = curB!.grades.find((g) => g.gradeid === "grade-B1")!;
    expect(gradeB1Out).toMatchObject({
      lessonsTotal: 1,
      lessonsCompleted: 1,
      levelsTotal: 1,
      levelsCompleted: 1,
    });
    expect(gradeB1Out.levels).toEqual([
      { levelid: "level-LB1", levelname: "Level B1", lessonsCompleted: 1, lessonsTotal: 1, completed: true },
    ]);

    // Fixed number of queries regardless of curricula/levels count: one
    // each for curricula, grades, levels, lessons, progress -- no
    // per-level query loop.
    expect(curriculumsFindAllSpy).toHaveBeenCalledTimes(1);
    expect(gradesFindAllSpy).toHaveBeenCalledTimes(1);
    expect(levelsFindAllSpy).toHaveBeenCalledTimes(1);
    expect(lessonsFindAllSpy).toHaveBeenCalledTimes(1);
    expect(progressFindAllSpy).toHaveBeenCalledTimes(1);
    // ...and one more for the stored level flags of all counted levels.
    expect(levelFlagsFindAllSpy).toHaveBeenCalledTimes(1);
    // ...and one for the awards already earned on those levels.
    expect(awardsFindAllSpy).toHaveBeenCalledTimes(1);
    expect(awardsFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentid: "student-1", levelid: ["level-L1", "level-L2", "level-L4", "level-LB1"] } })
    );
  });

  it("scopes every query to the requesting student and to active, non-deleted rows", async () => {
    await new StudentBusiness().getprogresssummary(user);

    // Most important: progress is scoped to THIS student. Without this, one
    // student's summary would include (or be built from) another student's
    // lesson progress rows.
    expect(progressFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ studentid: "student-1" }),
      })
    );

    expect(gradesFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ gradestatus: true, isdeleted: false }),
      })
    );
    expect(levelsFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ levelstatus: true, isdeleted: false }),
      })
    );
    expect(lessonsFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lessonstatus: true, isdeleted: false }),
      })
    );
  });

  it("orders grades and levels with deterministic tie-breaks so currentLevel selection is stable", async () => {
    await new StudentBusiness().getprogresssummary(user);

    // gradeorder/levelorder alone can tie (both default to 0 in real data);
    // the query must also order by name then id so results -- and therefore
    // currentLevel -- never depend on unspecified DB row order.
    expect(gradesFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        order: [
          ["gradeorder", "ASC"],
          ["gradename", "ASC"],
          ["gradeid", "ASC"],
        ],
      })
    );
    expect(levelsFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        order: [
          ["levelorder", "ASC"],
          ["levelname", "ASC"],
          ["levelid", "ASC"],
        ],
      })
    );
  });

  it("returns an empty summary and issues only the curricula query when the student has no enrolled curricula", async () => {
    curriculumsFindAllSpy.mockResolvedValue([] as never);

    const result = await new StudentBusiness().getprogresssummary(user);

    expect(result).toEqual({
      curricula: [],
      totals: { lessonsCompleted: 0, lessonsTotal: 0, levelsCompleted: 0, levelsTotal: 0 },
    });

    expect(curriculumsFindAllSpy).toHaveBeenCalledTimes(1);
    expect(gradesFindAllSpy).not.toHaveBeenCalled();
    expect(levelsFindAllSpy).not.toHaveBeenCalled();
    expect(lessonsFindAllSpy).not.toHaveBeenCalled();
    expect(progressFindAllSpy).not.toHaveBeenCalled();
    expect(levelFlagsFindAllSpy).not.toHaveBeenCalled();
    expect(awardsFindAllSpy).not.toHaveBeenCalled();
  });

  it("counts a lesson as done once even when it has two progress rows and only one qualifies", async () => {
    // Two rows for the same lesson (e.g. a stale row plus a fresh one) --
    // one that does not qualify as done and one that does. The lesson must
    // still be counted done exactly once, not twice and not zero times.
    progressRows = [
      { lessonid: "lesson-L1a", completed: true, progress: 0 },
      { lessonid: "lesson-L2a", completed: false, progress: 40 }, // does not qualify
      { lessonid: "lesson-L2a", completed: false, progress: 100 }, // qualifies
      { lessonid: "lesson-L2b", completed: false, progress: 50 },
      { lessonid: "lesson-LB1a", completed: true, progress: 0 },
    ];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    // Same result as the single-row case: L1 (1/1), L2 (1/2 -- lesson-L2a
    // done once), L4 (0/1). 4 lessons total, 2 done -- not 3, which is what
    // double-counting the duplicate row would produce.
    expect(curA.lessonsTotal).toBe(4);
    expect(curA.lessonsCompleted).toBe(2);
  });

  it("tie-breaks currentLevel ordering deterministically when two grades or levels share an order value", async () => {
    // grade-A1 and grade-A2 both claim gradeorder 1 (a tie); their names
    // ("Grade A1" < "Grade A2") settle it. Likewise level-L1 and level-L4
    // both claim levelorder 1 within their respective (now tied) grades.
    // The business method trusts the DB's ORDER BY, so this exercises the
    // same code path as the main aggregation test but proves the resulting
    // currentLevel still lands on the level that sorts first once ties are
    // broken by name/id, not on whichever the DB happened to return first.
    const tiedGradeA1 = { ...gradeA1, gradeorder: 1 };
    const tiedGradeA2 = { ...gradeA2, gradeorder: 1 };
    gradesFindAllSpy.mockResolvedValue([tiedGradeA1, tiedGradeA2, gradeB1] as never);

    const tiedLevelL1 = { ...levelL1, levelorder: 1 };
    const tiedLevelL2 = { ...levelL2, levelorder: 1 };
    levelsFindAllSpy.mockResolvedValue([tiedLevelL1, tiedLevelL2, levelL3, levelL4, levelLB1] as never);

    progressRows = [
      // Nothing done in grade A1's levels this time, so the first
      // incomplete level (in tie-broken order) should be level-L1.
      { lessonid: "lesson-LB1a", completed: true, progress: 0 },
    ];
    // ...and no level of curriculum A is flagged either.
    levelFlagRows = [{ studentid: "student-1", levelid: "level-LB1", completed: true }];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.currentLevel).toMatchObject({ levelid: "level-L1", gradeid: "grade-A1" });
  });

  it("(a) does not complete a level whose every lesson is done when the stored flag is false", async () => {
    levelFlagRows = [{ studentid: "student-1", levelid: "level-L1", completed: false }];
    progressRows = [{ lessonid: "lesson-L1a", completed: true, progress: 100 }];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.levelsCompleted).toBe(0);
    expect(curA.lessonsCompleted).toBe(1);
    expect(curA.grades[0].levels[0]).toMatchObject({ levelid: "level-L1", lessonsCompleted: 1, lessonsTotal: 1, completed: false });
    expect(curA.currentLevel).toMatchObject({ levelid: "level-L1", lessonsCompleted: 1, lessonsTotal: 1 });
  });

  it("(a) treats a missing flag row the same as a false one", async () => {
    levelFlagRows = [];
    progressRows = [{ lessonid: "lesson-L1a", completed: true, progress: 100 }];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.levelsCompleted).toBe(0);
    expect(curA.currentLevel).toMatchObject({ levelid: "level-L1" });
  });

  it("(b) completes a flagged level with only 2 of 5 lessons done and moves currentLevel on", async () => {
    // Level L1 gets five lessons, two done; its flag is set (80% of points reached).
    const five = ["a", "b", "c", "d", "e"].map((x) => ({ lessonid: `lesson-L1${x}`, levelid: "level-L1" }));
    lessonsFindAllSpy.mockResolvedValue([...five, lessonL2a, lessonL2b, lessonL4a, lessonLB1a] as never);
    progressRows = [
      { lessonid: "lesson-L1a", completed: true, progress: 0 },
      { lessonid: "lesson-L1b", completed: false, progress: 100 },
    ];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.levelsCompleted).toBe(1);
    expect(curA.lessonsCompleted).toBe(2);
    expect(curA.grades[0].levels[0]).toEqual({
      levelid: "level-L1", levelname: "Level 1", lessonsCompleted: 2, lessonsTotal: 5, completed: true,
    });
    expect(curA.currentLevel).toMatchObject({ levelid: "level-L2", lessonsCompleted: 0, lessonsTotal: 2 });
  });

  it("(c) leaves a flagged level with no active lessons out of both level counts and completed: false", async () => {
    levelFlagRows.push({ studentid: "student-1", levelid: "level-L3", completed: true });

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;
    const gradeA2Out = curA.grades.find((g) => g.gradeid === "grade-A2")!;

    expect(gradeA2Out.levelsTotal).toBe(1);
    expect(gradeA2Out.levelsCompleted).toBe(0);
    expect(gradeA2Out.levels[0]).toEqual({
      levelid: "level-L3", levelname: "Level 3 (no lessons)", lessonsCompleted: 0, lessonsTotal: 0, completed: false,
    });
    expect(curA.levelsTotal).toBe(3);
    expect(curA.levelsCompleted).toBe(1);
  });

  it("(d) ignores another student's flags and queries the flags for the token's studentid", async () => {
    levelFlagRows = [
      { studentid: "student-2", levelid: "level-L1", completed: true },
      { studentid: "student-2", levelid: "level-L2", completed: true },
      { studentid: "student-1", levelid: "level-LB1", completed: true },
    ];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.levelsCompleted).toBe(0);
    expect(result.totals.levelsCompleted).toBe(1); // only student-1's LB1
    expect(levelFlagsFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ studentid: "student-1" }) })
    );
    const where = levelFlagsFindAllSpy.mock.calls[0][0].where;
    expect([...where.levelid].sort()).toEqual(["level-L1", "level-L2", "level-L4", "level-LB1"]); // L3 has no lessons
  });

  it("(e) gives a null currentLevel when every counted level is flagged, even with lessons undone", async () => {
    levelFlagRows = ["level-L1", "level-L2", "level-L4", "level-LB1"].map((levelid) => ({
      studentid: "student-1", levelid, completed: true,
    }));
    progressRows = [];

    const result = await new StudentBusiness().getprogresssummary(user);

    for (const cur of result.curricula) {
      expect(cur.currentLevel).toBeNull();
      expect(cur.levelsCompleted).toBe(cur.levelsTotal);
    }
    expect(result.totals).toMatchObject({ levelsCompleted: 4, levelsTotal: 4, lessonsCompleted: 0, lessonsTotal: 5 });
  });

  it("(f) adds totals and per-grade level counts up across two curricula on the flags", async () => {
    levelFlagRows = ["level-L2", "level-L4", "level-LB1"].map((levelid) => ({
      studentid: "student-1", levelid, completed: true,
    }));

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;
    const curB = result.curricula.find((c) => c.curriculumid === "cur-B")!;

    expect(curA).toMatchObject({ levelsTotal: 3, levelsCompleted: 2 });
    expect(curA.currentLevel).toMatchObject({ levelid: "level-L1" });
    expect(curA.grades.map((g) => [g.gradeid, g.levelsCompleted, g.levelsTotal])).toEqual([
      ["grade-A1", 1, 2],
      ["grade-A2", 1, 1],
    ]);
    expect(curB).toMatchObject({ levelsTotal: 1, levelsCompleted: 1 });
    expect(curB.currentLevel).toBeNull();
    expect(result.totals.levelsCompleted).toBe(curA.levelsCompleted + curB.levelsCompleted);
    expect(result.totals.levelsTotal).toBe(curA.levelsTotal + curB.levelsTotal);
    expect(result.totals).toMatchObject({ levelsCompleted: 3, levelsTotal: 4 });
  });

  it("(g) keeps a level completed when its flag has dropped to false but the award was earned", async () => {
    levelFlagRows = [
      { studentid: "student-1", levelid: "level-L1", completed: false },
      { studentid: "student-1", levelid: "level-LB1", completed: true },
    ];
    awardRows = [{ studentid: "student-1", levelid: "level-L1" }];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.levelsCompleted).toBe(1);
    expect(curA.grades[0].levels[0]).toMatchObject({ levelid: "level-L1", completed: true });
    expect(curA.currentLevel).toMatchObject({ levelid: "level-L2" });
  });

  it("(h) does not count another student's award", async () => {
    levelFlagRows = [];
    awardRows = [{ studentid: "student-2", levelid: "level-L1" }];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.levelsCompleted).toBe(0);
    expect(curA.currentLevel).toMatchObject({ levelid: "level-L1" });
    expect(awardsFindAllSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ studentid: "student-1" }) })
    );
  });

  it.each([
    ["false then true", [false, true]],
    ["true then false", [true, false]],
  ])("(i) completes a level when two flag rows disagree (%s)", async (_name, flags) => {
    levelFlagRows = (flags as boolean[]).map((completed) => ({ studentid: "student-1", levelid: "level-L2", completed }));
    levelFlagRows.push({ studentid: "student-1", levelid: "level-L1", completed: true });

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;

    expect(curA.grades[0].levels.find((l) => l.levelid === "level-L2")).toMatchObject({ completed: true });
    expect(curA.levelsCompleted).toBe(1 + 1); // L1 (flagged) and L2
  });

  it("(j) an award on a level with no active lessons changes nothing", async () => {
    awardRows = [{ studentid: "student-1", levelid: "level-L3" }];

    const result = await new StudentBusiness().getprogresssummary(user);
    const curA = result.curricula.find((c) => c.curriculumid === "cur-A")!;
    const gradeA2Out = curA.grades.find((g) => g.gradeid === "grade-A2")!;

    expect(gradeA2Out.levels[0]).toMatchObject({ levelid: "level-L3", completed: false });
    expect(curA.levelsTotal).toBe(3);
    expect(curA.levelsCompleted).toBe(1);
    expect(awardsFindAllSpy.mock.calls[0][0].where.levelid).not.toContain("level-L3");
  });
});
