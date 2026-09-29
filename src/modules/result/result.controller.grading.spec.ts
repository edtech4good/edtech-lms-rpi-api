import { ResultBusiness } from "src/business/result.business";
import { LessonBusiness } from "src/business/lesson.business";
import { lessonquizquestions, lessonpracticequestions } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * Route-level guard for workspace#79 step 1b: server grading wired into
 * savelessonquizresult and savelessonpracticeresult end to end — the
 * validator accepting `answer`, storage of answer/clientiscorrect/
 * servergrade/verified, the GRADING_MODE shadow/enforce switch, and
 * REQUIRE_GRADED_ANSWERS gating `ispass`.
 *
 * `src/business/grading` is mocked so these tests control gradeAnswer's
 * verdict directly, the same test-double approach as gradesubmission.spec.ts
 * but exercised through the real controller route.
 */
jest.mock("src/business/result.business");
jest.mock("src/business/lesson.business");
jest.mock("src/business/grading", () => ({
  gradeAnswer: jest.fn(),
  isAnswerV1: jest.fn((x: unknown) => {
    if (typeof x !== "object" || x === null) return false;
    const v = x as Record<string, unknown>;
    return v.v === 1 && typeof v.type === "string";
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const grading = require("src/business/grading");

const MockedResultBusiness = ResultBusiness as jest.MockedClass<typeof ResultBusiness>;
const MockedLessonBusiness = LessonBusiness as jest.MockedClass<typeof LessonBusiness>;

const ANSWER = { v: 1, type: "choice", selected: ["a"] };

describe("ResultController.savelessonquizresult server grading (workspace#79 step 1b)", () => {
  let createlessonquizprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestionsWithJoin = (ids: string[]) =>
    findAllSpy.mockResolvedValue(
      ids.map((lessonquizquestionid) => ({
        lessonquizquestionid,
        question: { templatetypeid: 1, questionoptions: {}, questioncorrectvalue: undefined, questiondistractors: undefined },
      })) as never,
    );

  const submit = (items: { iscorrect: boolean; lessonquizquestionid: string; answer?: unknown }[]) =>
    new ResultController().savelessonquizresult(
      "lq1",
      {
        result: items.map((x) => ({ ...x, lessonquizid: "lq1", questionid: x.lessonquizquestionid })),
        starttime: new Date(),
        endtime: new Date(),
      } as any,
      { studentid: "s1", studentfirstname: "Test" } as any,
    );

  beforeEach(() => {
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
    grading.gradeAnswer.mockReset();

    createlessonquizprogress = jest.fn().mockResolvedValue(undefined);
    (MockedResultBusiness.prototype as any).ispass = jest.fn().mockResolvedValue(false);
    (MockedResultBusiness.prototype as any).createlessonquizprogress = createlessonquizprogress;
    (MockedLessonBusiness.prototype as any).calculateQuizScore = jest.fn().mockResolvedValue({
      marks: 999,
      userpoints: 40,
      fullpoints: 40,
      lesson: { lessonid: "l1" },
    });
    (MockedLessonBusiness.prototype as any).updateuserdailypoints = jest.fn().mockResolvedValue(undefined);

    findAllSpy = jest.spyOn(lessonquizquestions, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  it("an old-format payload (no answer field) is still accepted, stored unverified, with unchanged scoring", async () => {
    activeQuestionsWithJoin(["q1", "q2", "q3", "q4"]);
    await submit([{ iscorrect: true, lessonquizquestionid: "q1" }]);

    expect(createlessonquizprogress).toHaveBeenCalledTimes(1);
    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.passpercentage).toBe(25);
    expect(progress.ispass).toBe(false);
    expect(grading.gradeAnswer).not.toHaveBeenCalled();
  });

  it("with the stub/unsupported grader (gradable:false for everything), a fully-answered quiz is still unverified", async () => {
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    activeQuestionsWithJoin(["q1", "q2", "q3", "q4"]);
    await submit(
      ["q1", "q2", "q3", "q4"].map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: ANSWER })),
    );

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    // shadow mode (default): scoring is untouched by the ungradable grades
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
  });

  it("shadow mode (default): server grades are recorded but scoring still follows the client's claim, even when they disagree", async () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false }); // server says wrong
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, lessonquizquestionid: "q1", answer: ANSWER }]); // client claims right

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(true);
    expect(progress.passpercentage).toBe(100); // client's claim still wins the score in shadow mode
    expect(progress.ispass).toBe(true);
  });

  it("enforce mode: a forged iscorrect:true is caught once the server grade disagrees", async () => {
    process.env.GRADING_MODE = "enforce";
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false }); // server says wrong
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, lessonquizquestionid: "q1", answer: ANSWER }]); // client claims right

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(true);
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
  });

  it("enforce mode: a gradable server grade also passes a client who under-claimed", async () => {
    process.env.GRADING_MODE = "enforce";
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: true });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: false, lessonquizquestionid: "q1", answer: ANSWER }]);

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
  });

  it("REQUIRE_GRADED_ANSWERS=true: an unverified result cannot pass, even at 100% by the client's own count", async () => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: ANSWER })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.passpercentage).toBe(100); // percentage is unaffected...
    expect(progress.ispass).toBe(false); // ...but ispass is forced false
  });

  it("REQUIRE_GRADED_ANSWERS=true: a fully-verified pass still passes", async () => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: true });
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: ANSWER })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(true);
    expect(progress.ispass).toBe(true);
  });

  it("REQUIRE_GRADED_ANSWERS=true: old-format payloads (no answer) are still accepted, just unverified and not a pass", async () => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id })));

    expect(createlessonquizprogress).toHaveBeenCalledTimes(1); // accepted, not rejected
    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.ispass).toBe(false);
  });
});

describe("ResultController.savelessonpracticeresult: REQUIRE_GRADED_ANSWERS never affects practice", () => {
  let createlessonpracticeprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestionsWithJoin = (ids: string[]) =>
    findAllSpy.mockResolvedValue(
      ids.map((lessonpracticequestionid) => ({
        lessonpracticequestionid,
        question: { templatetypeid: 1, questionoptions: {}, questioncorrectvalue: undefined, questiondistractors: undefined },
      })) as never,
    );

  const submit = (items: { iscorrect: boolean; lessonpracticequestionid: string; answer?: unknown }[]) =>
    new ResultController().savelessonpracticeresult(
      "lp1",
      {
        result: items.map((x) => ({ ...x, lessonpracticeid: "lp1", questionid: x.lessonpracticequestionid, tries: 1 })),
        starttime: new Date(),
        endtime: new Date(),
      } as any,
      { studentid: "s1", studentfirstname: "Test" } as any,
    );

  beforeEach(() => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });

    createlessonpracticeprogress = jest.fn().mockResolvedValue(undefined);
    (MockedResultBusiness.prototype as any).ispass = jest.fn().mockResolvedValue(false);
    (MockedResultBusiness.prototype as any).createlessonpracticeprogress = createlessonpracticeprogress;
    (MockedLessonBusiness.prototype as any).calculatePracticeScore = jest.fn().mockResolvedValue({
      marks: 999,
      userpoints: 40,
      fullpoints: 40,
      lesson: { lessonid: "l1" },
    });
    (MockedLessonBusiness.prototype as any).updateuserdailypoints = jest.fn().mockResolvedValue(undefined);

    findAllSpy = jest.spyOn(lessonpracticequestions, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  it("an unverified practice attempt still passes at 80%+, unaffected by REQUIRE_GRADED_ANSWERS", async () => {
    activeQuestionsWithJoin(["q1", "q2", "q3", "q4"]);
    await submit(["q1", "q2", "q3", "q4"].map((id) => ({ iscorrect: true, lessonpracticequestionid: id, answer: ANSWER })));

    const [progress] = createlessonpracticeprogress.mock.calls[0];
    expect(progress.verified).toBe(false); // still recorded honestly...
    expect(progress.ispass).toBe(true); // ...but practice's pass is untouched
  });
});
