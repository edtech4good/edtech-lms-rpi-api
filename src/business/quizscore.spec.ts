import { Op } from "sequelize";
import { baselinequestion, lessonquizquestions, levelquizquestions } from "../models/data-models/init-models";
import { UNRENDERED_TEMPLATE_TYPES } from "../models/enums/constant.enum";
import { quizPassResult, scorebaseline, scorelessonquiz, scorelevelquiz } from "./quizscore";

/**
 * Guards the quiz pass rule (workspace#79 step 0): distinct correct answers
 * to THIS quiz's ACTIVE, RENDERABLE questions ÷ active question count, pass
 * at 80% inclusive.
 *
 * The old rule divided by the submitted payload length. Practice already
 * had this fix (practicescore.ts); these tests drive the quiz scorer the
 * same way, with the active question list mocked, so a regression to
 * payload-relative scoring or to counting unrenderable templates shows up
 * as a wrong percentage.
 */
const LESSONQUIZ = "22222222-2222-4222-8222-222222222222";
const LEVEL = "33333333-3333-4333-8333-333333333333";
const Q = ["q1", "q2", "q3", "q4", "q5"];

const correctLesson = (id: string) => ({ iscorrect: true, lessonquizquestionid: id });
const wrongLesson = (id: string) => ({ iscorrect: false, lessonquizquestionid: id });
const correctLevel = (id: string) => ({ iscorrect: true, levelquizquestionid: id });

describe("scorelessonquiz (lesson quiz pass mark, 80% inclusive)", () => {
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((lessonquizquestionid) => ({ lessonquizquestionid })) as never);

  beforeEach(() => {
    findAllSpy = jest.spyOn(lessonquizquestions, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
  });

  it("queries only this quiz's active, renderable questions", async () => {
    activeQuestions(Q);
    await scorelessonquiz(LESSONQUIZ, []);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
    const [options]: any = findAllSpy.mock.calls[0];
    expect(options.where).toEqual({ lessonquizid: LESSONQUIZ, lessonquizquestionstatus: true });
    expect(options.include[0].where).toEqual({ templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } });
  });

  it("an honest full submission (one item per active question) is unchanged: all correct is 100%", async () => {
    activeQuestions(Q);
    const r = await scorelessonquiz(LESSONQUIZ, Q.map(correctLesson));
    expect(r).toEqual({ marks: 5, percentage: 100, ispass: true });
  });

  it("scores against active questions, not the payload: 1 correct of 4 is 25%, not 100%", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelessonquiz(LESSONQUIZ, [correctLesson("q1")]);
    expect(r).toEqual({ marks: 1, percentage: 25, ispass: false });
  });

  it("1 of 4 fails (25% < 80%)", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelessonquiz(LESSONQUIZ, [correctLesson("q1")]);
    expect(r.ispass).toBe(false);
  });

  it("counts a duplicated correct item for one question once", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelessonquiz(LESSONQUIZ, [
      correctLesson("q1"),
      correctLesson("q1"),
      correctLesson("q1"),
      correctLesson("q2"),
    ]);
    expect(r).toEqual({ marks: 2, percentage: 50, ispass: false });
  });

  it("ignores items for questions not in this quiz (or inactive/unrenderable — excluded by the active-question query)", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelessonquiz(LESSONQUIZ, [
      correctLesson("q1"),
      correctLesson("q2"),
      correctLesson("q3"),
      correctLesson("other-quiz-question"),
      correctLesson("q5"), // q5 is inactive/unrenderable here: not returned by the active-question query
    ]);
    expect(r).toEqual({ marks: 3, percentage: 75, ispass: false });
  });

  it("ignores answers marked iscorrect false", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelessonquiz(LESSONQUIZ, [correctLesson("q1"), wrongLesson("q2"), wrongLesson("q3"), wrongLesson("q4")]);
    expect(r).toEqual({ marks: 1, percentage: 25, ispass: false });
  });

  it("a quiz with no active (renderable) questions is 0% and FAILS (unlike practice) — an empty submission must never pass", async () => {
    activeQuestions([]);
    expect(await scorelessonquiz(LESSONQUIZ, [])).toEqual({ marks: 0, percentage: 0, ispass: false });
  });

  it("a quiz with no active (renderable) questions still fails even with a submitted (unscoreable) item", async () => {
    activeQuestions([]);
    expect(await scorelessonquiz(LESSONQUIZ, [correctLesson("q1")])).toEqual({ marks: 0, percentage: 0, ispass: false });
  });

  it("a 4-question quiz where one question has no tablet renderer (templatetype 9-17): an honest all-correct submission of the 3 renderable questions scores 100%", async () => {
    // The active-question query already excludes template 9-17 (asserted
    // above), so its result never includes q4 — simulating that exclusion
    // by mocking the query's result to only the 3 renderable questions.
    activeQuestions(["q1", "q2", "q3"]);
    const r = await scorelessonquiz(LESSONQUIZ, [correctLesson("q1"), correctLesson("q2"), correctLesson("q3")]);
    expect(r).toEqual({ marks: 3, percentage: 100, ispass: true });
  });
});

describe("scorelevelquiz (level quiz pass mark, 80% inclusive)", () => {
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((levelquizquestionid) => ({ levelquizquestionid })) as never);

  beforeEach(() => {
    findAllSpy = jest.spyOn(levelquizquestions, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
  });

  it("queries only this level's active, renderable quiz questions", async () => {
    activeQuestions(Q);
    await scorelevelquiz(LEVEL, []);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
    const [options]: any = findAllSpy.mock.calls[0];
    expect(options.where).toEqual({ levelid: LEVEL, levelquizquestionstatus: true });
    expect(options.include[0].where).toEqual({ templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } });
  });

  it("scores against active questions, not the payload: 1 correct of 4 is 25%, not 100%", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelevelquiz(LEVEL, [correctLevel("q1")]);
    expect(r).toEqual({ marks: 1, percentage: 25, ispass: false });
  });

  it("an honest full submission (one item per active question) is unchanged: all correct is 100%", async () => {
    activeQuestions(Q);
    const r = await scorelevelquiz(LEVEL, Q.map(correctLevel));
    expect(r).toEqual({ marks: 5, percentage: 100, ispass: true });
  });

  it("counts a duplicated correct item once", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorelevelquiz(LEVEL, [correctLevel("q1"), correctLevel("q1"), correctLevel("q2")]);
    expect(r).toEqual({ marks: 2, percentage: 50, ispass: false });
  });
});

const BASELINE = "44444444-4444-4444-8444-444444444444";
const correctBaseline = (id: string) => ({ iscorrect: true, baselinequestionid: id });

describe("scorebaseline (baseline pass mark, 80% inclusive)", () => {
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((baselinequestionid) => ({ baselinequestionid })) as never);

  beforeEach(() => {
    findAllSpy = jest.spyOn(baselinequestion, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
  });

  it("queries only this baseline's active, renderable questions", async () => {
    activeQuestions(Q);
    await scorebaseline(BASELINE, []);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
    const [options]: any = findAllSpy.mock.calls[0];
    expect(options.where).toEqual({ curriculumbaselineid: BASELINE, baselinequestionstatus: true });
    expect(options.include[0].where).toEqual({ templatetypeid: { [Op.notIn]: UNRENDERED_TEMPLATE_TYPES } });
  });

  it("scores against active questions, not the payload: 1 correct of 4 is 25%, not 100%", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorebaseline(BASELINE, [correctBaseline("q1")]);
    expect(r).toEqual({ marks: 1, percentage: 25, ispass: false });
  });

  it("an honest full submission (one item per active question) is unchanged: all correct is 100%", async () => {
    activeQuestions(Q);
    const r = await scorebaseline(BASELINE, Q.map(correctBaseline));
    expect(r).toEqual({ marks: 5, percentage: 100, ispass: true });
  });

  it("counts a duplicated correct item once", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorebaseline(BASELINE, [correctBaseline("q1"), correctBaseline("q1"), correctBaseline("q2")]);
    expect(r).toEqual({ marks: 2, percentage: 50, ispass: false });
  });

  it("a baseline with no active (renderable) questions is 0% and fails", async () => {
    activeQuestions([]);
    expect(await scorebaseline(BASELINE, [])).toEqual({ marks: 0, percentage: 0, ispass: false });
  });
});

describe("quizPassResult", () => {
  it("caps the percentage at 100", () => {
    expect(quizPassResult(7, 4)).toEqual({ marks: 7, percentage: 100, ispass: true });
  });

  it("passes at exactly 80 and fails just below", () => {
    expect(quizPassResult(8, 10).ispass).toBe(true);
    expect(quizPassResult(79, 100).ispass).toBe(false);
  });

  it("zero active questions does NOT pass (unlike practicePassResult) — must never pass on an empty/unscoreable submission", () => {
    expect(quizPassResult(0, 0)).toEqual({ marks: 0, percentage: 0, ispass: false });
    // Even a non-zero `marks` argument is zeroed out: there is nothing to
    // score against, so the reported marks must not imply otherwise.
    expect(quizPassResult(3, 0)).toEqual({ marks: 0, percentage: 0, ispass: false });
  });
});
