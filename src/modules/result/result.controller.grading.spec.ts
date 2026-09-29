import { ResultBusiness } from "src/business/result.business";
import { LessonBusiness } from "src/business/lesson.business";
import { CurriculumBaseLineBusiness } from "src/business/curriculumbaseline.business";
import { lessonquizquestions, lessonpracticequestions, levelquizquestions, baselinequestion } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * Route-level guard for the server-grading protocol: server grading wired
 * into savelessonquizresult, savelevelquizresult, savebaselineresult and
 * savelessonpracticeresult end to end — the validator accepting `answer`,
 * storage of answer/clientiscorrect/servergrade/verified, the GRADING_MODE
 * shadow/enforce switch, REQUIRE_GRADED_ANSWERS gating `ispass` (enforce
 * only), and — the fix in this round — that duplicate items for the same
 * question can never inflate a score past what the first, honestly
 * submitted item actually graded as.
 *
 * `src/business/grading` is mocked so these tests control gradeAnswer's
 * verdict directly. `mockAnswerGrading` below makes it content-aware
 * (checks the submitted `selected` array against a fixed "correct" choice)
 * so the duplicate/brute-force attack tests are grading REAL distinct
 * answers rather than one fixed verdict for every call.
 */
jest.mock("src/business/result.business");
jest.mock("src/business/lesson.business");
jest.mock("src/business/curriculumbaseline.business");
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
const MockedCurriculumBaseLineBusiness = CurriculumBaseLineBusiness as jest.MockedClass<typeof CurriculumBaseLineBusiness>;

const ANSWER = { v: 1, type: "choice", selected: ["a"] };

/** The correct option is always "A"; anything else is a real, gradable wrong answer; no `selected` at all is malformed. */
const RIGHT = { v: 1, type: "choice", selected: ["A"] };
const WRONG = { v: 1, type: "choice", selected: ["B"] };
const WRONG2 = { v: 1, type: "choice", selected: ["C"] };
const MALFORMED = { v: 1, type: "choice" }; // valid envelope (v/type), but the library can't grade it

function mockAnswerGrading() {
  grading.gradeAnswer.mockImplementation((_q: unknown, answer: { selected?: string[] }) => {
    if (!answer.selected) {
      return { gradable: false, reason: "malformed" };
    }
    return { gradable: true, correct: answer.selected[0] === "A" };
  });
}

describe("ResultController.savelessonquizresult server grading (the server-grading protocol)", () => {
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
    // "verified" means "this was actually scored by the server". Shadow
    // mode never scores from the server, by definition — so even a single,
    // fully-gradable question must never come back verified here, or an
    // unverified shadow-period row could still slip past a certificate gate.
    expect(progress.verified).toBe(false);
    expect(progress.passpercentage).toBe(100); // client's claim still wins the score in shadow mode
    expect(progress.ispass).toBe(true);
  });

  it("REQUIRE_GRADED_ANSWERS does nothing in shadow mode (it only applies once GRADING_MODE=enforce)", async () => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: ANSWER })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false); // shadow is never verified...
    expect(progress.ispass).toBe(true); // ...but REQUIRE_GRADED_ANSWERS has no effect outside enforce
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

  it("enforce mode: a malformed FIRST answer is scored incorrect, not a fallback to the client's forged claim", async () => {
    process.env.GRADING_MODE = "enforce";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "malformed" });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, lessonquizquestionid: "q1", answer: MALFORMED }]);

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
    expect(progress.verified).toBe(false); // ungradable, so not server-scored
  });

  it("REQUIRE_GRADED_ANSWERS=true (enforce): an unverified result cannot pass, even at 100% by the client's own count", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: ANSWER })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.passpercentage).toBe(100); // percentage is unaffected...
    expect(progress.ispass).toBe(false); // ...but ispass is forced false
  });

  it("REQUIRE_GRADED_ANSWERS=true (enforce): a fully-verified pass still passes", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: true });
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: ANSWER })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(true);
    expect(progress.ispass).toBe(true);
  });

  it("REQUIRE_GRADED_ANSWERS=true (enforce): old-format payloads (no answer) are still accepted, just unverified and not a pass", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    activeQuestionsWithJoin(["q1", "q2"]);
    await submit(["q1", "q2"].map((id) => ({ iscorrect: true, lessonquizquestionid: id })));

    expect(createlessonquizprogress).toHaveBeenCalledTimes(1); // accepted, not rejected
    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.ispass).toBe(false);
  });

  describe("duplicate-item attacks (each question really is answered wrong first; only that first item may count)", () => {
    const QIDS = ["q1", "q2", "q3", "q4"];

    beforeEach(() => {
      process.env.GRADING_MODE = "enforce";
      process.env.REQUIRE_GRADED_ANSWERS = "true";
      mockAnswerGrading();
      activeQuestionsWithJoin(QIDS);
    });

    it("a real wrong graded answer plus a bare iscorrect:true duplicate (no answer) does not inflate the score", async () => {
      await submit(
        QIDS.flatMap((id) => [
          { iscorrect: false, lessonquizquestionid: id, answer: WRONG },
          { iscorrect: true, lessonquizquestionid: id }, // no answer at all — bare claim
        ]),
      );

      const [progress] = createlessonquizprogress.mock.calls[0];
      expect(progress.passpercentage).toBe(0); // NOT 100 — the exploit this fixes
      expect(progress.ispass).toBe(false);
      // The first item genuinely was graded (wrong) for every question, so
      // this is a true, honest, server-confirmed failure — verified=true is
      // correct here; the fix's job is stopping false credit, not hiding a
      // real (if wrong) grade.
      expect(progress.verified).toBe(true);
      const stored = JSON.parse(progress.actualanswers);
      expect(stored).toHaveLength(8); // both items per question are still stored
    });

    it("a real wrong graded answer plus a malformed duplicate claiming correct does not inflate the score", async () => {
      await submit(
        QIDS.flatMap((id) => [
          { iscorrect: false, lessonquizquestionid: id, answer: WRONG },
          { iscorrect: true, lessonquizquestionid: id, answer: MALFORMED },
        ]),
      );

      const [progress] = createlessonquizprogress.mock.calls[0];
      expect(progress.passpercentage).toBe(0);
      expect(progress.ispass).toBe(false);
      expect(progress.verified).toBe(true);
    });

    it("submitting every option as its own item does not let a later, correct guess retroactively fix an already-wrong first answer", async () => {
      // Order matters: the actually-correct option ("A") is submitted LAST.
      // Old ("any submitted item correct") scoring would have picked it up
      // regardless of order; only the FIRST item may count now.
      await submit(
        QIDS.flatMap((id) => [
          { iscorrect: false, lessonquizquestionid: id, answer: WRONG },
          { iscorrect: false, lessonquizquestionid: id, answer: WRONG2 },
          { iscorrect: false, lessonquizquestionid: id, answer: RIGHT },
        ]),
      );

      const [progress] = createlessonquizprogress.mock.calls[0];
      expect(progress.passpercentage).toBe(0); // NOT 100
      expect(progress.ispass).toBe(false);
      expect(progress.verified).toBe(true); // the (wrong) first answer was genuinely gradable
    });

    it("control: an honest single-item submission of the correct answer legitimately scores 100%", async () => {
      await submit(QIDS.map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: RIGHT })));

      const [progress] = createlessonquizprogress.mock.calls[0];
      expect(progress.passpercentage).toBe(100);
      expect(progress.ispass).toBe(true);
      expect(progress.verified).toBe(true);
    });
  });

  describe("shadow mode scores exactly like main did before this protocol shipped", () => {
    const QIDS = ["q1", "q2", "q3", "q4", "q5"];
    // An old-format payload (no `answer` field at all): two conflicting
    // items per question, [iscorrect:false, iscorrect:true] — this is
    // exactly what main's scorer already dedups via "any submitted item
    // correct" (quizscore.ts), so shadow mode (default, no grading
    // involved at all here since there's no `answer`) MUST reproduce that:
    // 100%, marks 5. Only enforce may restrict counting to the first item.
    const conflictingDuplicates = () =>
      QIDS.flatMap((id) => [
        { iscorrect: false, lessonquizquestionid: id },
        { iscorrect: true, lessonquizquestionid: id },
      ]);

    it("shadow (default): scores 100%, marks 5 — identical to main's own dedup rule", async () => {
      activeQuestionsWithJoin(QIDS);
      await submit(conflictingDuplicates());

      const [progress] = createlessonquizprogress.mock.calls[0];
      expect(progress.passpercentage).toBe(100);
      expect(progress.marks).toBe(5);
      expect(progress.ispass).toBe(true);
      expect(progress.verified).toBe(false);
    });

    it("enforce: the same payload does NOT score 100% — only the first submitted item per question counts", async () => {
      process.env.GRADING_MODE = "enforce";
      activeQuestionsWithJoin(QIDS);
      await submit(conflictingDuplicates());

      const [progress] = createlessonquizprogress.mock.calls[0];
      expect(progress.passpercentage).not.toBe(100);
      expect(progress.passpercentage).toBe(0);
      expect(progress.ispass).toBe(false);
    });
  });
});

describe("ResultController.savelevelquizresult server grading", () => {
  let createlevelquizprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestionsWithJoin = (ids: string[]) =>
    findAllSpy.mockResolvedValue(
      ids.map((levelquizquestionid) => ({
        levelquizquestionid,
        question: { templatetypeid: 1, questionoptions: {}, questioncorrectvalue: undefined, questiondistractors: undefined },
      })) as never,
    );

  const submit = (items: { iscorrect: boolean; levelquizquestionid: string; answer?: unknown }[]) =>
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
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
    grading.gradeAnswer.mockReset();

    createlevelquizprogress = jest.fn().mockResolvedValue(undefined);
    (MockedResultBusiness.prototype as any).ispass = jest.fn().mockResolvedValue(false);
    (MockedResultBusiness.prototype as any).createlevelquizprogress = createlevelquizprogress;
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
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  it("shadow mode: scoring follows the client's claim and the row is never verified", async () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, levelquizquestionid: "q1", answer: ANSWER }]);

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.verified).toBe(false);
  });

  it("enforce mode: the server grade overrides a forged client claim", async () => {
    process.env.GRADING_MODE = "enforce";
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, levelquizquestionid: "q1", answer: ANSWER }]);

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
    expect(progress.verified).toBe(true);
  });

  it("REQUIRE_GRADED_ANSWERS=true (enforce): an unverified result cannot pass", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, levelquizquestionid: "q1", answer: ANSWER }]);

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.ispass).toBe(false);
  });

  it("duplicate-item attack: a wrong graded answer plus a bare-claim duplicate does not inflate the score", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    mockAnswerGrading();
    const QIDS = ["q1", "q2", "q3", "q4"];
    activeQuestionsWithJoin(QIDS);
    await submit(
      QIDS.flatMap((id) => [
        { iscorrect: false, levelquizquestionid: id, answer: WRONG },
        { iscorrect: true, levelquizquestionid: id },
      ]),
    );

    const [progress] = createlevelquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
  });
});

describe("ResultController.savebaselineresult server grading", () => {
  let createbaselinequestionprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestionsWithJoin = (ids: string[]) =>
    findAllSpy.mockResolvedValue(
      ids.map((baselinequestionid) => ({
        baselinequestionid,
        scorerquestion: { templatetypeid: 1, questionoptions: {}, questioncorrectvalue: undefined, questiondistractors: undefined },
      })) as never,
    );

  const submit = (items: { iscorrect: boolean; baselinequestionid: string; answer?: unknown }[]) =>
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
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
    grading.gradeAnswer.mockReset();

    createbaselinequestionprogress = jest.fn().mockResolvedValue(undefined);
    (MockedCurriculumBaseLineBusiness.prototype as any).calculateBaselineQuestionScore = jest.fn().mockResolvedValue({
      marks: 999,
      userpoints: 0,
      fullpoints: 0,
      baseline: { curriculumbaselineid: "cb1" },
    });
    (MockedResultBusiness.prototype as any).createbaselinequestionprogress = createbaselinequestionprogress;

    findAllSpy = jest.spyOn(baselinequestion, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  it("shadow mode: scoring follows the client's claim and the row is never verified", async () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, baselinequestionid: "q1", answer: ANSWER }]);

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.verified).toBe(false);
  });

  it("enforce mode: the server grade overrides a forged client claim", async () => {
    process.env.GRADING_MODE = "enforce";
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, baselinequestionid: "q1", answer: ANSWER }]);

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
    expect(progress.verified).toBe(true);
  });

  it("REQUIRE_GRADED_ANSWERS=true (enforce): an unverified result cannot pass", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    activeQuestionsWithJoin(["q1"]);
    await submit([{ iscorrect: true, baselinequestionid: "q1", answer: ANSWER }]);

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.verified).toBe(false);
    expect(progress.ispass).toBe(false);
  });

  it("duplicate-item attack: a wrong graded answer plus a bare-claim duplicate does not inflate the score", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    mockAnswerGrading();
    const QIDS = ["q1", "q2", "q3", "q4"];
    activeQuestionsWithJoin(QIDS);
    await submit(
      QIDS.flatMap((id) => [
        { iscorrect: false, baselinequestionid: id, answer: WRONG },
        { iscorrect: true, baselinequestionid: id },
      ]),
    );

    const [progress] = createbaselinequestionprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(0);
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
    process.env.GRADING_MODE = "enforce";
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
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  it("an unverified practice attempt still passes at 80%+, unaffected by REQUIRE_GRADED_ANSWERS (even in enforce)", async () => {
    activeQuestionsWithJoin(["q1", "q2", "q3", "q4"]);
    await submit(["q1", "q2", "q3", "q4"].map((id) => ({ iscorrect: true, lessonpracticequestionid: id, answer: ANSWER })));

    const [progress] = createlessonpracticeprogress.mock.calls[0];
    expect(progress.verified).toBe(false); // still recorded honestly...
    expect(progress.ispass).toBe(true); // ...but practice's pass is untouched
  });
});
