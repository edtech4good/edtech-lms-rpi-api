import { ResultBusiness } from "src/business/result.business";
import { LessonBusiness } from "src/business/lesson.business";
import { CurriculumBaseLineBusiness } from "src/business/curriculumbaseline.business";
import { baselinequestion, lessonquizquestions, levelquizquestions } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * Route-level guard for workspace#79 step 0: savelessonquizresult must store
 * a percentage scored against the quiz's own active questions, not the
 * submitted payload — the bug that let one correct item score 100%.
 *
 * ResultBusiness and LessonBusiness are auto-mocked (their real methods are
 * instance fields, not prototype methods, so they cannot be spied on
 * directly) so this test isolates the controller's own scoring wiring —
 * that it calls scorelessonquiz and passes ITS percentage/ispass/marks
 * through to createlessonquizprogress, not calculateQuizScore's raw count.
 * lessonquizquestions.findAll is the real model call scorelessonquiz makes,
 * mocked the same way practicescore.spec.ts and quizscore.spec.ts mock it.
 */
jest.mock("src/business/result.business");
jest.mock("src/business/lesson.business");
jest.mock("src/business/curriculumbaseline.business");

const MockedResultBusiness = ResultBusiness as jest.MockedClass<typeof ResultBusiness>;
const MockedLessonBusiness = LessonBusiness as jest.MockedClass<typeof LessonBusiness>;
const MockedCurriculumBaseLineBusiness = CurriculumBaseLineBusiness as jest.MockedClass<typeof CurriculumBaseLineBusiness>;

describe("ResultController.savelessonquizresult scores against active questions (workspace#79 step 0)", () => {
  let createlessonquizprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((lessonquizquestionid) => ({ lessonquizquestionid })) as never);

  const submit = (items: { iscorrect: boolean; lessonquizquestionid: string }[]) =>
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
    createlessonquizprogress = jest.fn().mockResolvedValue(undefined);
    (MockedResultBusiness.prototype as any).ispass = jest.fn().mockResolvedValue(false);
    (MockedResultBusiness.prototype as any).createlessonquizprogress = createlessonquizprogress;

    // calculateQuizScore's own `marks` (raw submitted-correct count) must be
    // ignored by the controller — a regression back to using it would show
    // up as marks 999 in the assertions below instead of the scorer's count.
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
  });

  it("one correct submitted item on a 4-question quiz stores 25%, not 100%, and fails", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([{ iscorrect: true, lessonquizquestionid: "q1" }]);

    expect(createlessonquizprogress).toHaveBeenCalledTimes(1);
    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(25);
    expect(progress.ispass).toBe(false);
    expect(progress.marks).toBe(1);
  });

  it("all 4 correct is 100% and passes", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit(["q1", "q2", "q3", "q4"].map((id) => ({ iscorrect: true, lessonquizquestionid: id })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.marks).toBe(4);
  });

  it("an honest full submission (one item per active question, all correct) is unchanged from before the fix", async () => {
    // Before the fix, `correct.length * 100 / data.length` on a full honest
    // submission (every active question submitted, all correct) was already
    // 100% — the bug only inflated a PARTIAL submission. This pins that an
    // honest old client still gets the same result.
    activeQuestions(["q1", "q2", "q3"]);
    await submit(["q1", "q2", "q3"].map((id) => ({ iscorrect: true, lessonquizquestionid: id })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
  });

  it("duplicate items for one question don't count twice", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([
      { iscorrect: true, lessonquizquestionid: "q1" },
      { iscorrect: true, lessonquizquestionid: "q1" },
      { iscorrect: true, lessonquizquestionid: "q2" },
    ]);

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.marks).toBe(2);
    expect(progress.passpercentage).toBe(50);
  });

  it("items for a question not in this quiz (excluded by the active-question query) are ignored", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([
      { iscorrect: true, lessonquizquestionid: "q1" },
      { iscorrect: true, lessonquizquestionid: "other-quiz-question" },
    ]);

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.marks).toBe(1);
    expect(progress.passpercentage).toBe(25);
  });

  it("a quiz with no active (renderable) questions never passes, even on an empty submission", async () => {
    activeQuestions([]);
    await submit([]);

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
    expect(progress.marks).toBe(0);
  });
});

describe("ResultController.savelevelquizresult scores against active questions (workspace#79 step 0)", () => {
  let createlevelquizprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((levelquizquestionid) => ({ levelquizquestionid })) as never);

  const submit = (items: { iscorrect: boolean; levelquizquestionid: string }[]) =>
    new ResultController().savelevelquizresult(
      "lv1",
      {
        result: items.map((x) => ({ ...x, levelid: "lv1", questionid: x.levelquizquestionid })),
        starttime: new Date(),
        endtime: new Date(),
      } as any,
      { studentid: "s1", studentfirstname: "Test" } as any,
    );

  beforeEach(() => {
    createlevelquizprogress = jest.fn().mockResolvedValue(undefined);
    (MockedResultBusiness.prototype as any).ispass = jest.fn().mockResolvedValue(false);
    (MockedResultBusiness.prototype as any).createlevelquizprogress = createlevelquizprogress;

    // calculateLevelQuizScore's own `marks` (raw submitted-correct count)
    // must be ignored by the controller — a regression back to using it
    // would show up as marks 999 below instead of the scorer's count.
    (MockedLessonBusiness.prototype as any).calculateLevelQuizScore = jest.fn().mockResolvedValue({
      marks: 999,
      userpoints: 40,
      fullpoints: 40,
      level: { levelid: "lv1" },
    });
    (MockedLessonBusiness.prototype as any).updateuserdailypointsBylevelquiz = jest.fn().mockResolvedValue(undefined);

    findAllSpy = jest.spyOn(levelquizquestions, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
  });

  it("one correct submitted item on a 4-question level quiz stores 25%, not 100%, and fails", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([{ iscorrect: true, levelquizquestionid: "q1" }]);

    expect(createlevelquizprogress).toHaveBeenCalledTimes(1);
    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(25);
    expect(progress.ispass).toBe(false);
    expect(progress.marks).toBe(1);
  });

  it("all 4 correct is 100% and passes", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit(["q1", "q2", "q3", "q4"].map((id) => ({ iscorrect: true, levelquizquestionid: id })));

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.marks).toBe(4);
  });

  it("duplicate items for one question don't count twice", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([
      { iscorrect: true, levelquizquestionid: "q1" },
      { iscorrect: true, levelquizquestionid: "q1" },
      { iscorrect: true, levelquizquestionid: "q2" },
    ]);

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.marks).toBe(2);
    expect(progress.passpercentage).toBe(50);
  });

  it("a level quiz with no active (renderable) questions never passes, even on an empty submission", async () => {
    activeQuestions([]);
    await submit([]);

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
    expect(progress.marks).toBe(0);
  });
});

describe("ResultController.savebaselineresult scores against active questions (workspace#79 decision 6)", () => {
  let createbaselinequestionprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((baselinequestionid) => ({ baselinequestionid })) as never);

  const submit = (items: { iscorrect: boolean; baselinequestionid: string }[]) =>
    new ResultController().savebaselineresult(
      "cb1",
      {
        result: items.map((x) => ({ ...x, curriculumbaselineid: "cb1", questionid: x.baselinequestionid })),
        starttime: new Date(),
        endtime: new Date(),
      } as any,
      { studentid: "s1", studentfirstname: "Test" } as any,
    );

  beforeEach(() => {
    createbaselinequestionprogress = jest.fn().mockResolvedValue(undefined);
    (MockedResultBusiness.prototype as any).createbaselinequestionprogress = createbaselinequestionprogress;

    // calculateBaselineQuestionScore's own `marks` (raw submitted-correct
    // count) must be ignored by the controller — a regression back to using
    // it would show up as marks 999 below instead of the scorer's count.
    (MockedCurriculumBaseLineBusiness.prototype as any).calculateBaselineQuestionScore = jest.fn().mockResolvedValue({
      marks: 999,
      userpoints: 0,
      fullpoints: 0,
      baseline: { curriculumbaselineid: "cb1" },
    });

    findAllSpy = jest.spyOn(baselinequestion, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
  });

  it("one correct submitted item on a 4-question baseline stores 25%, not 100%, and fails", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([{ iscorrect: true, baselinequestionid: "q1" }]);

    expect(createbaselinequestionprogress).toHaveBeenCalledTimes(1);
    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(25);
    expect(progress.ispass).toBe(false);
    expect(progress.marks).toBe(1);
  });

  it("all 4 correct is 100% and passes", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit(["q1", "q2", "q3", "q4"].map((id) => ({ iscorrect: true, baselinequestionid: id })));

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.marks).toBe(4);
  });

  it("duplicate items for one question don't count twice", async () => {
    activeQuestions(["q1", "q2", "q3", "q4"]);
    await submit([
      { iscorrect: true, baselinequestionid: "q1" },
      { iscorrect: true, baselinequestionid: "q1" },
      { iscorrect: true, baselinequestionid: "q2" },
    ]);

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.marks).toBe(2);
    expect(progress.passpercentage).toBe(50);
  });

  it("a baseline with no active (renderable) questions never passes, even on an empty submission", async () => {
    activeQuestions([]);
    await submit([]);

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
    expect(progress.marks).toBe(0);
  });
});
