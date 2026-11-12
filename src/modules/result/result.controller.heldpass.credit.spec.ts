import { lessonquizquestions, levelquizquestions, studentgradesprogress, studentlessonsprogress, studentlevelsprogress, studentprogress, studentprogressquestions, lessons, grades, organisations } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * The credit a quiz holds, through the REAL point arithmetic: ResultBusiness.updateQuizPoints / updateLevelQuizPoints /
 * getoldpoints / getpassoldpoints / storeheldattempt and LessonBusiness.updateUserReward / updateLevelQuizReward, against
 * in-memory models (a row is an object that is saved in place). Only LessonBusiness's reads of content, its daily-points
 * and its active-activity writes are stubbed. Nothing here ran on MySQL.
 *
 * The story: a learner holds a pass of a quiz that the server did not mark (credit 10). The quiz's points are raised to
 * 20 in the content. The learner retakes it several times; however many retakes there are, the lesson, level and grade
 * totals gain the 10 points of the difference exactly once. Then the same again for a rise to 30 after a marked pass is
 * stored (from then on a marked pass stops every submission).
 */
const fns = { daily: jest.fn(), dailyLevel: jest.fn(), awards: jest.fn() };
const state: { quiz: any; level: any } = { quiz: null, level: null }; // eslint-disable-line @typescript-eslint/no-explicit-any
jest.mock("src/business/level-award", () => ({
  ...jest.requireActual("src/business/level-award"),
  awardLevelIfCompleted: (...args: unknown[]) => fns.awards(...args),
}));
jest.mock("src/business/lesson.business", () => {
  // (made on first use: the business modules import one another, and the real one may still be loading)
  let made: unknown;
  return new Proxy({}, {
    get: (_t, prop) => {
      const actual = jest.requireActual("src/business/lesson.business");
      if (prop !== "LessonBusiness") return actual[prop];
      if (!made) {
        made = class extends actual.LessonBusiness {
          getlessonquiz = async () => state.quiz;
          getlevelquiz = async () => state.level;
          setstudentactive = async () => undefined;
          updateuserdailypoints = (...a: unknown[]) => fns.daily(...a);
          updateuserdailypointsBylevelquiz = (...a: unknown[]) => fns.dailyLevel(...a);
          calculateQuizScore = async () => ({ userpoints: 40, fullpoints: 40, lesson: { lessonid: "l1" } });
          calculateLevelQuizScore = async () => ({ userpoints: 40, fullpoints: 40, level: state.level });
          addstudentscores = jest.fn();
          addstudentlevelquizscores = jest.fn();
        };
      }
      return made;
    },
  });
});
jest.mock("src/services/dbservice", () => ({
  dbinstance: { getdbinstance: () => ({ transaction: jest.fn().mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() }) }) },
}));

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OPTIONS = [
  { questionoptionid: "opt-1", questionoptiontext: "correct", questionoptioniscorrect: true, questionoptionsequence: 1 },
  { questionoptionid: "opt-2", questionoptiontext: "wrong", questionoptioniscorrect: false, questionoptionsequence: 2 },
];
const RIGHT = { v: 1, type: "choice", selected: ["opt-1"] };
const WRONG = { v: 1, type: "choice", selected: ["opt-2"] };
const day = (n: number) => new Date(`2026-11-${String(n).padStart(2, "0")}T08:00:00Z`);
const eq = (a: unknown, b: unknown) =>
  (typeof a === "boolean" || typeof a === "number") && (typeof b === "boolean" || typeof b === "number") ? Number(a) === Number(b) : a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
const match = (r: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => eq(r[k], v));
const saveable = (row: Row): Row => {
  Object.defineProperty(row, "save", { value: async () => undefined, enumerable: false });
  return row;
};

describe.each([
  ["lesson quiz, quiz-pass rule off", 2, false],
  ["lesson quiz, quiz-pass rule on", 2, true],
  ["level quiz", 3, false],
] as const)("%s", (_name, progresstype, rule) => {
  const refid = progresstype === 2 ? "lq1" : "lv1";
  const key = progresstype === 2 ? "lessonquizquestionid" : "levelquizquestionid";
  const saved = { m: process.env.GRADING_MODE, r: process.env.REQUIRE_GRADED_ANSWERS };
  let attempts: Row[];
  let lessonprogress: Row[], levelprogress: Row[], gradeprogress: Row[];
  const user = { studentid: "s1", studentfirstname: "T", organisationid: "org" } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** The totals after the quiz's credit is n: a level quiz moves the level and grade, a lesson quiz the lesson too. */
  const held = (n: number) => ({ lesson: progresstype === 2 ? n : 10, level: n, grade: n });
  const totals = () => ({ lesson: lessonprogress[0]?.points, level: levelprogress[0]?.points, grade: gradeprogress[0]?.points });
  const attempt = (o: Row): Row => saveable({ studentprogressid: `p${attempts.length}`, studentid: "s1", studentprogressreferenceid: refid, progresstype, resultpercentage: 100, fullpoints: 40, scores: 3, ...o });

  beforeEach(() => {
    process.env.GRADING_MODE = "enforce";
    delete process.env.REQUIRE_GRADED_ANSWERS;
    fns.daily.mockReset(); fns.dailyLevel.mockReset(); fns.awards.mockReset();
    attempts = [];
    // the learner's totals already hold the quiz's first credit of 10 (the lesson holds 10 of 100, so does the level, so does the grade)
    lessonprogress = [saveable({ studentid: "s1", lessonid: "l1", points: 10, progress: 10, completed: false })];
    levelprogress = [saveable({ studentid: "s1", levelid: "lv1", points: 10, progress: 10, completed: false })];
    gradeprogress = [saveable({ studentid: "s1", gradeid: "g1", points: 10, progress: 10, completed: false })];
    // the quiz as the content holds it now: 10 points
    state.quiz = { lessonquizid: "lq1", lessonid: "l1", points: 10, getLesson: async () => ({ quizzes_points: 40 }) };
    state.level = { levelid: "lv1", gradeid: "g1", quiz_points: 10, points: 100 };
    jest.spyOn(studentprogress, "count").mockImplementation((async (o: any) => attempts.filter((r) => match(r, o.where)).length) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(studentprogress, "findAll").mockImplementation((async (o: any) => attempts.filter((r) => match(r, o.where))) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(studentprogress, "findOne").mockImplementation((async (o: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const hit = attempts.filter((r) => match(r, o.where));
      const dir = o.order?.[0]?.[1] === "ASC" ? 1 : -1;
      hit.sort((a, b) => dir * (a.starttime.getTime() - b.starttime.getTime()));
      return hit[0] ?? null;
    }) as never);
    jest.spyOn(studentprogress, "findOrCreate").mockImplementation((async (o: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const found = attempts.find((r) => match(r, o.where));
      if (found) return [found, false];
      const row = saveable({ ...o.defaults });
      attempts.push(row);
      return [row, true];
    }) as never);
    jest.spyOn(studentprogress, "create").mockImplementation((async (v: Row) => { const r = saveable({ ...v }); attempts.push(r); return r; }) as never);
    jest.spyOn(studentprogressquestions, "create").mockResolvedValue(undefined as never);
    const active = [{ [key]: "q1", question: { templatetypeid: 1, questionoptions: OPTIONS } }];
    jest.spyOn(lessonquizquestions, "findAll").mockResolvedValue(active.map((a) => ({ ...a, lessonquizquestionid: "q1" })) as never);
    jest.spyOn(levelquizquestions, "findAll").mockResolvedValue(active.map((a) => ({ ...a, levelquizquestionid: "q1" })) as never);
    jest.spyOn(lessons, "findOne").mockResolvedValue({ lessonid: "l1", total_points: 100, passing_points: 80, level: { levelid: "lv1", gradeid: "g1", points: 100 } } as never);
    jest.spyOn(grades, "findOne").mockResolvedValue({ gradeid: "g1", curriculumid: "c1", points: 100 } as never);
    jest.spyOn(studentlessonsprogress, "findOne").mockImplementation((async () => lessonprogress[0] ?? null) as never);
    jest.spyOn(studentlevelsprogress, "findOne").mockImplementation((async () => levelprogress[0] ?? null) as never);
    jest.spyOn(studentgradesprogress, "findOne").mockImplementation((async () => gradeprogress[0] ?? null) as never);
    jest.spyOn(organisations, "findOne").mockResolvedValue({ settingsconfig: { requireLessonQuizPass: rule } } as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (saved.m === undefined) delete process.env.GRADING_MODE; else process.env.GRADING_MODE = saved.m;
    if (saved.r === undefined) delete process.env.REQUIRE_GRADED_ANSWERS; else process.env.REQUIRE_GRADED_ANSWERS = saved.r;
  });

  const retake = (correct: boolean, when: Date) => {
    const items = [{ iscorrect: correct, [key]: "q1", answer: correct ? RIGHT : WRONG, ...(progresstype === 2 ? { lessonquizid: refid } : { levelid: refid }), questionid: "q1" }];
    const body = { result: items, starttime: when, endtime: when } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = new ResultController();
    return progresstype === 2 ? c.savelessonquizresult(refid, body, user) : c.savelevelquizresult(refid, body, user);
  };
  const setQuizPoints = (n: number) => { state.quiz.points = n; state.level.quiz_points = n; };
  const heldRows = () => attempts.filter((r) => r.studentprogressid !== "p0");

  it("a rise in the quiz's points is credited once however many retakes follow; each stored row carries the credit the quiz holds", async () => {
    attempts.push(attempt({ ispass: true, verified: false, points: 10, starttime: day(1) })); // p0: the unmarked pass
    // no change in the points: a failing retake stores a row and moves nothing
    await retake(false, day(10));
    expect(totals()).toEqual(held(10));
    expect(heldRows().map((r) => [r.points, r.fullpoints])).toEqual([[10, progresstype === 2 ? 40 : 100]]);
    // the content now gives 20 points for the quiz
    setQuizPoints(20);
    await retake(false, day(30));
    expect(totals()).toEqual(held(20));
    await retake(false, day(40));
    await retake(false, day(50));
    expect(totals()).toEqual(held(20));
    expect(attempts).toHaveLength(5); // the pass and four retakes, each stored
    expect(attempts.map((r) => r.points)).toEqual([20, 20, 20, 20, 20]); // every row holds the credit
    // a marked pass is stored (its own result, verified), and from then on a marked pass stops every submission
    await retake(true, day(55));
    expect(attempts).toHaveLength(6);
    expect(attempts[5]).toMatchObject({ verified: true, ispass: true, points: 20 });
    expect(totals()).toEqual(held(20));
    // the content now gives 30: credited once, however many (now early-stopped) retakes follow
    setQuizPoints(30);
    await retake(true, day(60));
    await retake(true, day(70));
    await retake(false, day(80));
    expect(attempts).toHaveLength(6); // stopped: no rows
    expect(totals()).toEqual(held(30));
    // the rows that are read for the credit (a pass, and the newest attempt) hold it
    expect(attempts.filter((r) => r.ispass).map((r) => r.points)).toEqual([30, 30]);
    expect(attempts[5].points).toBe(30);
    expect(fns.awards.mock.calls.filter((c) => (c[0] as { isCompleted: boolean }).isCompleted)).toEqual([]);
  });

  it("a marked pass dated before the newest stored attempt is stored with the credit, and credits nothing twice", async () => {
    attempts.push(attempt({ ispass: true, verified: false, points: 10, starttime: day(1) }));
    setQuizPoints(20);
    await retake(false, day(30)); // newest row
    await retake(true, day(20)); // a marked pass dated earlier than that
    await retake(true, day(35));
    await retake(false, day(36));
    expect(totals()).toEqual(held(20));
    expect(attempts.filter((r) => r.ispass).map((r) => r.points)).toEqual([20, 20]);
  });
});
