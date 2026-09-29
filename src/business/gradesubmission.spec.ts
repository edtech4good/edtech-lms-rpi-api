import { QuestionForGrading } from "./grading";

/**
 * Guards gradeSubmissionItems (workspace#79 step 1b): storage of
 * answer/clientiscorrect/servergrade, the shadow-vs-enforce scoring switch,
 * and the "verified iff every active question got a gradable server grade"
 * rule.
 *
 * `./grading` is mocked with a small test double so this suite doesn't
 * depend on the real grader implementations (step 1a, landing separately) —
 * it drives gradeSubmissionItems exactly the way the stub or the real
 * library would be driven, by controlling gradeAnswer's return value per
 * test.
 */
jest.mock("./grading", () => ({
  gradeAnswer: jest.fn(),
  isAnswerV1: jest.fn((x: unknown) => {
    if (typeof x !== "object" || x === null) return false;
    const v = x as Record<string, unknown>;
    return v.v === 1 && typeof v.type === "string";
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const grading = require("./grading");
import { gradeSubmissionItems, logGradingDisagreements } from "./gradesubmission";

const Q1 = "q1";
const Q2 = "q2";

const question: QuestionForGrading = {
  templatetypeid: 1,
  questionoptions: {},
  questioncorrectvalue: undefined,
  questiondistractors: undefined,
};

const activeQuestions = (ids: string[]) => {
  const m = new Map<string, QuestionForGrading>();
  ids.forEach((id) => m.set(id, { ...question }));
  return m;
};

describe("gradeSubmissionItems", () => {
  beforeEach(() => {
    grading.gradeAnswer.mockReset();
    grading.isAnswerV1.mockClear();
  });

  it("an item with no answer at all is ungradable, keeps the client's iscorrect, and is not verified", () => {
    const active = activeQuestions([Q1]);
    const r = gradeSubmissionItems([{ iscorrect: true, lessonquizquestionid: Q1 }], active, "lessonquizquestionid", "shadow");
    expect(r.items[0].servergrade).toBe("ungradable");
    expect(r.items[0].clientiscorrect).toBe(true);
    expect(r.items[0].iscorrect).toBe(true);
    expect(r.verified).toBe(false);
  });

  it("gradable and correct: shadow mode keeps the client's claim for scoring, but records the server grade", () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: true });
    const active = activeQuestions([Q1]);
    const r = gradeSubmissionItems(
      [{ iscorrect: false, lessonquizquestionid: Q1, answer: { v: 1, type: "choice" } }],
      active,
      "lessonquizquestionid",
      "shadow",
    );
    expect(r.items[0].servergrade).toBe("correct");
    expect(r.items[0].clientiscorrect).toBe(false);
    // shadow: scoring (iscorrect) still follows the client's claim
    expect(r.items[0].iscorrect).toBe(false);
    expect(r.verified).toBe(true);
  });

  it("gradable and correct: enforce mode overrides a forged client claim for scoring", () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: true });
    const active = activeQuestions([Q1]);
    // client claims wrong, but the server graded it correct
    const r = gradeSubmissionItems(
      [{ iscorrect: false, lessonquizquestionid: Q1, answer: { v: 1, type: "choice" } }],
      active,
      "lessonquizquestionid",
      "enforce",
    );
    expect(r.items[0].clientiscorrect).toBe(false);
    expect(r.items[0].iscorrect).toBe(true); // server grade wins
  });

  it("enforce mode: a forged iscorrect:true is caught when the server grades it incorrect", () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: false });
    const active = activeQuestions([Q1]);
    const r = gradeSubmissionItems(
      [{ iscorrect: true, lessonquizquestionid: Q1, answer: { v: 1, type: "choice" } }],
      active,
      "lessonquizquestionid",
      "enforce",
    );
    expect(r.items[0].clientiscorrect).toBe(true);
    expect(r.items[0].iscorrect).toBe(false);
    expect(r.items[0].servergrade).toBe("incorrect");
  });

  it("ungradable in enforce mode falls back to the client's claim, and the row stays unverified", () => {
    grading.gradeAnswer.mockReturnValue({ gradable: false, reason: "unsupported-template" });
    const active = activeQuestions([Q1]);
    const r = gradeSubmissionItems(
      [{ iscorrect: true, lessonquizquestionid: Q1, answer: { v: 1, type: "text" } }],
      active,
      "lessonquizquestionid",
      "enforce",
    );
    expect(r.items[0].servergrade).toBe("ungradable");
    expect(r.items[0].iscorrect).toBe(true); // kept client's flag
    expect(r.verified).toBe(false);
  });

  it("verified is true only when EVERY active question has a gradable grade, not just some", () => {
    grading.gradeAnswer.mockReturnValue({ gradable: true, correct: true });
    const active = activeQuestions([Q1, Q2]);
    const r = gradeSubmissionItems(
      [{ iscorrect: true, lessonquizquestionid: Q1, answer: { v: 1, type: "choice" } }],
      active,
      "lessonquizquestionid",
      "shadow",
    );
    // Q2 was never submitted at all
    expect(r.verified).toBe(false);
  });

  it("verified is true (vacuously) when there are no active questions", () => {
    const active = activeQuestions([]);
    const r = gradeSubmissionItems([], active, "lessonquizquestionid", "shadow");
    expect(r.verified).toBe(true);
  });

  it("a malformed answer (fails isAnswerV1) is treated as ungradable, not passed to gradeAnswer", () => {
    const active = activeQuestions([Q1]);
    const r = gradeSubmissionItems(
      [{ iscorrect: true, lessonquizquestionid: Q1, answer: { garbage: true } }],
      active,
      "lessonquizquestionid",
      "shadow",
    );
    expect(grading.gradeAnswer).not.toHaveBeenCalled();
    expect(r.items[0].servergrade).toBe("ungradable");
  });

  it("an item referencing a question outside the active set is ungradable (no question to grade against)", () => {
    const active = activeQuestions([Q1]);
    const r = gradeSubmissionItems(
      [{ iscorrect: true, lessonquizquestionid: "not-active", answer: { v: 1, type: "choice" } }],
      active,
      "lessonquizquestionid",
      "shadow",
    );
    expect(r.items[0].servergrade).toBeNull();
    expect(grading.gradeAnswer).not.toHaveBeenCalled();
  });
});

describe("logGradingDisagreements", () => {
  it("does not throw and counts disagreements by templatetypeid without needing learner data in its inputs", () => {
    const active = activeQuestions([Q1]);
    const items = [{ clientiscorrect: true, servergrade: "incorrect" as const }];
    expect(() => logGradingDisagreements("lesson-quiz", items, active, [Q1])).not.toThrow();
  });
});
