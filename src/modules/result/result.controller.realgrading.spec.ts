import { ResultBusiness } from "src/business/result.business";
import { LessonBusiness } from "src/business/lesson.business";
import { lessonquizquestions } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * End-to-end integration guard: the REAL grading library (edtech-lms-rpi-api#93,
 * now merged) driving actual `ResultController.savelessonquizresult` calls,
 * with no mock of `./grading` at all — only the DB layer (`ResultBusiness`,
 * `LessonBusiness`, `lessonquizquestions.findAll`) is mocked, the same way
 * every other controller spec in this file does it.
 *
 * This is the highest-fidelity check that the wiring in gradesubmission.ts
 * (first-item-only scoring, the badanswer/noinfo split, enforce-only
 * `verified`) actually holds up against the real `gradeAnswer`/`isAnswerV1`,
 * not just against a test double that could silently drift from the real
 * library's behaviour.
 */
jest.mock("src/business/result.business");
jest.mock("src/business/lesson.business");

const MockedResultBusiness = ResultBusiness as jest.MockedClass<typeof ResultBusiness>;
const MockedLessonBusiness = LessonBusiness as jest.MockedClass<typeof LessonBusiness>;

// Single-choice MCQ (templatetypeid 1): "opt-1" is the only correct option,
// shaped exactly like the real library's own fixtures (src/business/grading/index.spec.ts).
const OPTIONS = [
  { questionoptionid: "opt-1", questionoptiontext: "correct", questionoptioniscorrect: true, questionoptionsequence: 1 },
  { questionoptionid: "opt-2", questionoptiontext: "wrong-b", questionoptioniscorrect: false, questionoptionsequence: 2 },
  { questionoptionid: "opt-3", questionoptiontext: "wrong-c", questionoptioniscorrect: false, questionoptionsequence: 3 },
];

const RIGHT = { v: 1, type: "choice", selected: ["opt-1"] };
const WRONG = { v: 1, type: "choice", selected: ["opt-2"] };
const WRONG2 = { v: 1, type: "choice", selected: ["opt-3"] };
const MALFORMED = { v: 1, type: "choice" }; // no `selected` at all — fails the real isAnswerV1's shape check

const QIDS = ["q1", "q2", "q3", "q4", "q5"];

describe("ResultController.savelessonquizresult with the REAL grading library (#93, no mock of ./grading)", () => {
  let createlessonquizprogress: jest.Mock;
  let findAllSpy: jest.SpyInstance;

  const activeQuestionsWithJoin = (ids: string[]) =>
    findAllSpy.mockResolvedValue(
      ids.map((lessonquizquestionid) => ({
        lessonquizquestionid,
        question: { templatetypeid: 1, questionoptions: OPTIONS, questioncorrectvalue: undefined, questiondistractors: undefined },
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
    activeQuestionsWithJoin(QIDS);
  });

  afterEach(() => {
    findAllSpy.mockRestore();
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  it("(a) enforce: five honest, correct MCQ answers score 100%, pass, and verify", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    await submit(QIDS.map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: RIGHT })));

    const [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.verified).toBe(true);
  });

  it("(b) enforce: a forged iscorrect:true with a genuinely wrong answer is scored incorrect and unverified for that question", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    await submit([
      ...QIDS.slice(0, 4).map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: RIGHT })),
      { iscorrect: true, lessonquizquestionid: "q5", answer: WRONG }, // forged claim; real answer is wrong
    ]);

    const [progress] = createlessonquizprogress.mock.calls[0];
    // 4 of 5 correct — the forged claim on q5 did not buy it credit.
    expect(progress.passpercentage).toBe(80);
    expect(progress.ispass).toBe(true); // 80% still clears the pass mark
    // Still fully verified: q5's real (wrong) answer was gradable — a wrong
    // answer that gets correctly identified as wrong is a verified failure
    // on that question, not an unverifiable one.
    expect(progress.verified).toBe(true);
    const stored = JSON.parse(progress.actualanswers);
    const q5row = stored.find((x: any) => x.lessonquizquestionid === "q5");
    expect(q5row.servergrade).toBe("incorrect");
    expect(q5row.iscorrect).toBe(false);
    expect(q5row.clientiscorrect).toBe(true); // the forged claim, preserved for the record
  });

  it("(c) enforce: the reviewer's three duplicate/malformed attacks — none scores 100%, none verifies as a pass built on them, none passes with REQUIRE on", async () => {
    process.env.GRADING_MODE = "enforce";
    process.env.REQUIRE_GRADED_ANSWERS = "true";

    // Attack 1: a real wrong graded answer plus a bare iscorrect:true duplicate (no answer at all).
    await submit(
      QIDS.flatMap((id) => [
        { iscorrect: false, lessonquizquestionid: id, answer: WRONG },
        { iscorrect: true, lessonquizquestionid: id },
      ]),
    );
    let [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).not.toBe(100);
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);

    createlessonquizprogress.mockClear();

    // Attack 2: a real wrong graded answer plus a malformed duplicate claiming correct.
    await submit(
      QIDS.flatMap((id) => [
        { iscorrect: false, lessonquizquestionid: id, answer: WRONG },
        { iscorrect: true, lessonquizquestionid: id, answer: MALFORMED },
      ]),
    );
    [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).not.toBe(100);
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);

    createlessonquizprogress.mockClear();

    // Attack 3 (brute force): every option submitted as its own item, all
    // claiming iscorrect:false, with the actually-correct option submitted
    // LAST — the first (wrong) item must still be the one that counts.
    await submit(
      QIDS.flatMap((id) => [
        { iscorrect: false, lessonquizquestionid: id, answer: WRONG },
        { iscorrect: false, lessonquizquestionid: id, answer: WRONG2 },
        { iscorrect: false, lessonquizquestionid: id, answer: RIGHT },
      ]),
    );
    [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).not.toBe(100);
    expect(progress.passpercentage).toBe(0);
    expect(progress.ispass).toBe(false);
  });

  it("(d) shadow mode: the same honest and attack payloads score purely by the client's own claim, and are never verified", async () => {
    // No GRADING_MODE set => shadow (default).
    await submit(QIDS.map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: RIGHT })));
    let [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.verified).toBe(false);

    createlessonquizprogress.mockClear();

    // A forged claim of correct with a genuinely wrong answer: shadow scores
    // by the claim, so this legitimately (if dishonestly) reads as correct —
    // proving shadow really does leave scoring untouched, disagreements and
    // all, exactly as it's documented to.
    await submit(QIDS.map((id) => ({ iscorrect: true, lessonquizquestionid: id, answer: WRONG })));
    [progress] = createlessonquizprogress.mock.calls[0];
    expect(progress.passpercentage).toBe(100);
    expect(progress.ispass).toBe(true);
    expect(progress.verified).toBe(false);
  });
});
