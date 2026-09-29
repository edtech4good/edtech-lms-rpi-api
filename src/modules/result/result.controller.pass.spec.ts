import { LessonBusiness } from "src/business/lesson.business";
import { studentprogress, lessonquizquestions, levelquizquestions, lessonpracticequestions } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * Route level: with GRADING_MODE=enforce and REQUIRE_GRADED_ANSWERS on, an
 * earlier UNVERIFIED pass must not short-circuit a new lesson-quiz or
 * level-quiz attempt, while a verified one still does. In every other
 * combination an earlier pass short-circuits as before. Practice always
 * short-circuits on any earlier pass.
 *
 * ResultBusiness keeps its real ispass(); only its save methods are stubbed.
 * The studentprogress table is faked: count() honours `verified` in the
 * where clause, so this exercises the real clause the code builds.
 */
const saves = { quiz: jest.fn(), level: jest.fn() };
jest.mock("src/business/result.business", () => {
  const actual = jest.requireActual("src/business/result.business");
  class TestResultBusiness extends actual.ResultBusiness {
    createlessonquizprogress = saves.quiz;
    createlevelquizprogress = saves.level;
    updateQuizPoints = jest.fn().mockResolvedValue(undefined);
    updateLevelQuizPoints = jest.fn().mockResolvedValue(undefined);
    updatePracticePoints = jest.fn().mockResolvedValue(undefined);
    getoldpoints = jest.fn().mockResolvedValue(null);
  }
  return { ...actual, ResultBusiness: TestResultBusiness };
});
jest.mock("src/business/lesson.business");
jest.mock("src/services/dbservice", () => ({
  dbinstance: { getdbinstance: () => ({ transaction: jest.fn().mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() }) }) },
}));

const MockedLesson = LessonBusiness as jest.MockedClass<typeof LessonBusiness>;

const COMBOS = [
  { mode: "shadow", require: "", gated: false },
  { mode: "shadow", require: "true", gated: false },
  { mode: "enforce", require: "", gated: false },
  { mode: "enforce", require: "true", gated: true },
] as const;

describe.each(COMBOS)("earlier pass, GRADING_MODE=$mode REQUIRE_GRADED_ANSWERS=$require", ({ mode, require, gated }) => {
  const saved = { m: process.env.GRADING_MODE, r: process.env.REQUIRE_GRADED_ANSWERS };
  const user = { studentid: "s1", studentfirstname: "T" } as any;
  const body = { result: [], starttime: new Date(), endtime: new Date() } as any;
  let rows: { ispass: boolean; verified: boolean }[];

  beforeEach(() => {
    process.env.GRADING_MODE = mode;
    if (require) process.env.REQUIRE_GRADED_ANSWERS = require; else delete process.env.REQUIRE_GRADED_ANSWERS;
    rows = [];
    saves.quiz.mockReset().mockResolvedValue(undefined);
    saves.level.mockReset().mockResolvedValue(undefined);
    jest.spyOn(studentprogress, "count").mockImplementation((async (o: any) =>
      rows.filter((r) => r.ispass === !!o.where.ispass && (o.where.verified === undefined || r.verified === !!o.where.verified)).length) as any);
    jest.spyOn(lessonquizquestions, "findAll").mockResolvedValue([{ lessonquizquestionid: "q1" }] as never);
    jest.spyOn(levelquizquestions, "findAll").mockResolvedValue([{ levelquizquestionid: "q1" }] as never);
    jest.spyOn(lessonpracticequestions, "findAll").mockResolvedValue([{ lessonpracticequestionid: "q1" }] as never);
    const lb = MockedLesson.prototype as any;
    lb.getlessonquiz = jest.fn().mockResolvedValue({ lessonquizid: "lq1", lessonid: "l1", points: 1 });
    lb.getlevelquiz = jest.fn().mockResolvedValue({ levelid: "lv1", quiz_points: 1 });
    lb.getlessonpractice = jest.fn().mockResolvedValue({ lessonpracticeid: "lp1", lessonid: "l1", points: 1 });
    lb.calculateQuizScore = jest.fn().mockResolvedValue({ userpoints: 0, fullpoints: 0, lesson: {} });
    lb.calculateLevelQuizScore = jest.fn().mockResolvedValue({ userpoints: 0, fullpoints: 0, level: {} });
    for (const f of ["setstudentactive", "updateuserdailypoints", "updateuserdailypointsBylevelquiz", "updateUserReward", "updateLevelQuizReward"]) lb[f] = jest.fn().mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (saved.m === undefined) delete process.env.GRADING_MODE; else process.env.GRADING_MODE = saved.m;
    if (saved.r === undefined) delete process.env.REQUIRE_GRADED_ANSWERS; else process.env.REQUIRE_GRADED_ANSWERS = saved.r;
  });

  const cases = [
    ["lesson quiz", (c: ResultController) => c.savelessonquizresult("lq1", body, user), () => saves.quiz],
    ["level quiz", (c: ResultController) => c.savelevelquizresult("lv1", body, user), () => saves.level],
  ] as const;

  describe.each(cases)("%s", (_n, run, save) => {
    it("no earlier pass: saves the attempt", async () => {
      await run(new ResultController());
      expect(save()).toHaveBeenCalledTimes(1);
    });
    it("earlier UNVERIFIED pass: short-circuits, except under enforce+REQUIRE where the new attempt is saved", async () => {
      rows = [{ ispass: true, verified: false }];
      await run(new ResultController());
      expect(save()).toHaveBeenCalledTimes(gated ? 1 : 0);
    });
    it("earlier VERIFIED pass: always short-circuits", async () => {
      rows = [{ ispass: true, verified: true }];
      await run(new ResultController());
      expect(save()).not.toHaveBeenCalled();
    });
  });

  it("practice: any earlier pass short-circuits, even unverified under enforce+REQUIRE", async () => {
    rows = [{ ispass: true, verified: false }];
    const r = await new ResultController().savelessonpracticeresult("lp1", body, user);
    expect(r.data).toBe(true);
    expect((MockedLesson.prototype as any).getlessonpractice).toHaveBeenCalled();
  });
});
