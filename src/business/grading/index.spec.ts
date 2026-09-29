import { AnswerV1, QuestionForGrading, gradeAnswer, isAnswerV1 } from "./index";

/**
 * Fixtures are shaped after real `questions.questionoptions` rows pulled
 * from the local seed (edtech_lms_rpi.questions, templates 1-8), with
 * Khmer content substituted in for the text/typed-answer cases workspace#79
 * calls out (decision 4). Field names and nesting match
 * src/models/questionoption.model.ts and the QuestionOption shape read
 * from edtech-expo src/models/Lesson.ts.
 */

function mcqQuestion(templatetypeid: number): QuestionForGrading {
  return {
    templatetypeid,
    questionoptions: [
      { questionoptionid: "opt-1", questionoptiontext: "ឆ្កែ", questionoptioniscorrect: false, questionoptionsequence: 1 },
      { questionoptionid: "opt-2", questionoptiontext: "ឆ្មា", questionoptioniscorrect: true, questionoptionsequence: 2 },
      { questionoptionid: "opt-3", questionoptiontext: "សត្វមាន់", questionoptioniscorrect: false, questionoptionsequence: 3 },
    ],
  };
}

function mcqMultiQuestion(templatetypeid: number): QuestionForGrading {
  return {
    templatetypeid,
    questionoptions: [
      { questionoptionid: "opt-1", questionoptiontext: "2", questionoptioniscorrect: true, questionoptionsequence: 1 },
      { questionoptionid: "opt-2", questionoptiontext: "5", questionoptioniscorrect: false, questionoptionsequence: 2 },
      { questionoptionid: "opt-3", questionoptiontext: "8", questionoptioniscorrect: true, questionoptionsequence: 3 },
    ],
  };
}

function orderQuestion(templatetypeid: number): QuestionForGrading {
  return {
    templatetypeid,
    questionoptions: [
      { questionoptionid: "opt-1", questionoptiontext: "The", questionoptioniscorrect: true, questionoptionsequence: 1 },
      { questionoptionid: "opt-2", questionoptiontext: "dog", questionoptioniscorrect: true, questionoptionsequence: 2 },
      { questionoptionid: "opt-3", questionoptiontext: "runs", questionoptioniscorrect: true, questionoptionsequence: 3 },
    ],
  };
}

function matchQuestion(): QuestionForGrading {
  return {
    templatetypeid: 7,
    questionoptions: [
      { questionoptionid: "cat", questionoptiontext: "cat", questionassociate: { questionassociatetext: "hat" } },
      { questionoptionid: "dog", questionoptiontext: "dog", questionassociate: { questionassociatetext: "log" } },
    ],
  };
}

function blanksQuestion(realOptionCount: number): QuestionForGrading {
  const options = [];
  for (let i = 1; i <= realOptionCount; i++) {
    options.push({
      questionoptionid: `opt-${i}`,
      questionoptiontext: `word-${i}`,
      questionoptioniscorrect: true,
      questionoptionsequence: i,
    });
  }
  return { templatetypeid: 8, questionoptions: options };
}

describe("gradeAnswer: choice (templates 1-4)", () => {
  it.each([1, 2, 3, 4])("template %i: exact correct set is correct", (t) => {
    const q = t === 3 ? mcqMultiQuestion(t) : mcqQuestion(t);
    const answer: AnswerV1 = { v: 1, type: "choice", selected: t === 3 ? ["opt-1", "opt-3"] : ["opt-2"] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: true, correct: true });
  });

  it("single-choice: selecting the wrong option is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1"] };
    expect(gradeAnswer(mcqQuestion(1), answer)).toEqual({ gradable: true, correct: false });
  });

  it("single-choice: selecting nothing is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: [] };
    expect(gradeAnswer(mcqQuestion(1), answer)).toEqual({ gradable: true, correct: false });
  });

  it("multi-choice: a partial (missing one correct) selection is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1"] };
    expect(gradeAnswer(mcqMultiQuestion(3), answer)).toEqual({ gradable: true, correct: false });
  });

  it("multi-choice: correct set plus one extra incorrect option is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1", "opt-2", "opt-3"] };
    expect(gradeAnswer(mcqMultiQuestion(3), answer)).toEqual({ gradable: true, correct: false });
  });

  it("wrong answer type is a type-mismatch", () => {
    const answer: AnswerV1 = { v: 1, type: "order", order: ["opt-1"] };
    expect(gradeAnswer(mcqQuestion(1), answer)).toEqual({ gradable: false, reason: "type-mismatch" });
  });

  it("missing answer is no-answer", () => {
    expect(gradeAnswer(mcqQuestion(1), undefined)).toEqual({ gradable: false, reason: "no-answer" });
    expect(gradeAnswer(mcqQuestion(1), null)).toEqual({ gradable: false, reason: "no-answer" });
  });

  it("malformed answer shape never throws", () => {
    expect(gradeAnswer(mcqQuestion(1), { v: 1, type: "choice", selected: "opt-2" })).toEqual({
      gradable: false,
      reason: "malformed",
    });
    expect(gradeAnswer(mcqQuestion(1), "not even an object")).toEqual({ gradable: false, reason: "malformed" });
    expect(gradeAnswer(mcqQuestion(1), 42)).toEqual({ gradable: false, reason: "malformed" });
  });

  it("malformed question data (unparseable questionoptions) never throws", () => {
    const q: QuestionForGrading = { templatetypeid: 1, questionoptions: "{not json" };
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-2"] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: false, reason: "malformed" });
  });

  it("questionoptions given as a JSON string is parsed the same as an array", () => {
    const q = mcqQuestion(1);
    const asString: QuestionForGrading = { ...q, questionoptions: JSON.stringify(q.questionoptions) };
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-2"] };
    expect(gradeAnswer(asString, answer)).toEqual({ gradable: true, correct: true });
  });

  it("a duplicated selection is not a legitimate single choice, even if the id is correct", () => {
    // Single-choice question, only opt-2 is correct: selecting it twice
    // must not be treated the same as selecting it once.
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-2", "opt-2"] };
    expect(gradeAnswer(mcqQuestion(1), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a duplicated correct selection does not fill in for a missing second correct option (multi-choice)", () => {
    // opt-1 and opt-3 are both correct; submitting opt-1 twice must not
    // count as having also selected opt-3.
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1", "opt-1"] };
    expect(gradeAnswer(mcqMultiQuestion(3), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a foreign option id (not part of this question) is incorrect, not a crash", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["not-a-real-option"] };
    expect(gradeAnswer(mcqQuestion(1), answer)).toEqual({ gradable: true, correct: false });
  });

  it("empty questionoptions is malformed, not vacuously correct", () => {
    const q: QuestionForGrading = { templatetypeid: 1, questionoptions: [] };
    const answer: AnswerV1 = { v: 1, type: "choice", selected: [] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: false, reason: "malformed" });
  });

  it("questionoptions with every entry missing an id is malformed", () => {
    const q: QuestionForGrading = { templatetypeid: 1, questionoptions: [{ questionoptiontext: "no id" }] };
    const answer: AnswerV1 = { v: 1, type: "choice", selected: [] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: false, reason: "malformed" });
  });

  it("questionoptions where even one entry is missing an id is malformed (not partially graded)", () => {
    const q: QuestionForGrading = {
      templatetypeid: 1,
      questionoptions: [
        { questionoptionid: "opt-1", questionoptioniscorrect: true },
        { questionoptiontext: "dropped, no id" },
      ],
    };
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1"] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: false, reason: "malformed" });
  });

  it("questionoptioniscorrect is read forgivingly (1 and \"true\" count as correct)", () => {
    const q: QuestionForGrading = {
      templatetypeid: 1,
      questionoptions: [
        { questionoptionid: "opt-1", questionoptioniscorrect: 1 },
        { questionoptionid: "opt-2", questionoptioniscorrect: "false" },
      ],
    };
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1"] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: true, correct: true });
  });
});

describe("gradeAnswer: order (templates 5-6)", () => {
  it.each([5, 6])("template %i: correct non-decreasing full order is correct", (t) => {
    const answer: AnswerV1 = { v: 1, type: "order", order: ["opt-1", "opt-2", "opt-3"] };
    expect(gradeAnswer(orderQuestion(t), answer)).toEqual({ gradable: true, correct: true });
  });

  it("ties (equal sequence numbers) are accepted, matching the app", () => {
    const q: QuestionForGrading = {
      templatetypeid: 5,
      questionoptions: [
        { questionoptionid: "a", questionoptioniscorrect: true, questionoptionsequence: 1 },
        { questionoptionid: "b", questionoptioniscorrect: true, questionoptionsequence: 1 },
        { questionoptionid: "c", questionoptioniscorrect: true, questionoptionsequence: 2 },
      ],
    };
    const answer: AnswerV1 = { v: 1, type: "order", order: ["a", "b", "c"] };
    expect(gradeAnswer(q, answer)).toEqual({ gradable: true, correct: true });
    // the tied pair the other way round is also fine
    const swapped: AnswerV1 = { v: 1, type: "order", order: ["b", "a", "c"] };
    expect(gradeAnswer(q, swapped)).toEqual({ gradable: true, correct: true });
  });

  it("an out-of-sequence order is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "order", order: ["opt-2", "opt-1", "opt-3"] };
    expect(gradeAnswer(orderQuestion(5), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a missing item (short order) is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "order", order: ["opt-1", "opt-2"] };
    expect(gradeAnswer(orderQuestion(5), answer)).toEqual({ gradable: true, correct: false });
  });

  it("wrong type is a type-mismatch", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1"] };
    expect(gradeAnswer(orderQuestion(5), answer)).toEqual({ gradable: false, reason: "type-mismatch" });
  });

  it("malformed order (not an array of strings) never throws", () => {
    expect(gradeAnswer(orderQuestion(5), { v: 1, type: "order", order: [1, 2, 3] })).toEqual({
      gradable: false,
      reason: "malformed",
    });
  });

  it("a duplicated id padding out the right length is incorrect, not a shortcut past the real third item", () => {
    // opt-1 twice plus opt-2 has the right length (3) but never places
    // opt-3 at all; must not be treated as equivalent to the real order.
    const answer: AnswerV1 = { v: 1, type: "order", order: ["opt-1", "opt-1", "opt-2"] };
    expect(gradeAnswer(orderQuestion(5), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a foreign id in place of a real option is incorrect, not a crash", () => {
    const answer: AnswerV1 = { v: 1, type: "order", order: ["opt-1", "not-a-real-option", "opt-3"] };
    expect(gradeAnswer(orderQuestion(5), answer)).toEqual({ gradable: true, correct: false });
  });
});

describe("gradeAnswer: match (template 7, DragDrop)", () => {
  it("every option mapped to itself is correct", () => {
    const answer: AnswerV1 = { v: 1, type: "match", pairs: { cat: "cat", dog: "dog" } };
    expect(gradeAnswer(matchQuestion(), answer)).toEqual({ gradable: true, correct: true });
  });

  it("a swapped pair is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "match", pairs: { cat: "dog", dog: "cat" } };
    expect(gradeAnswer(matchQuestion(), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a missing pair is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "match", pairs: { cat: "cat" } };
    expect(gradeAnswer(matchQuestion(), answer)).toEqual({ gradable: true, correct: false });
  });

  it("wrong type is a type-mismatch", () => {
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["cat", "dog"] };
    expect(gradeAnswer(matchQuestion(), answer)).toEqual({ gradable: false, reason: "type-mismatch" });
  });

  it("malformed pairs (not a string record) never throws", () => {
    expect(gradeAnswer(matchQuestion(), { v: 1, type: "match", pairs: { cat: 1 } })).toEqual({
      gradable: false,
      reason: "malformed",
    });
  });
});

describe("gradeAnswer: blanks (template 8, FillInBlank)", () => {
  it("filling every blank correctly, in sequence, is correct", () => {
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["opt-1", "opt-2"] };
    expect(gradeAnswer(blanksQuestion(2), answer)).toEqual({ gradable: true, correct: true });
  });

  it("wrong count (fewer than required) is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["opt-1"] };
    expect(gradeAnswer(blanksQuestion(2), answer)).toEqual({ gradable: true, correct: false });
  });

  it("out-of-sequence blanks are incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["opt-2", "opt-1"] };
    expect(gradeAnswer(blanksQuestion(2), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a distractor id (no sequence, not a real option) is incorrect", () => {
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["distractor-id"] };
    expect(gradeAnswer(blanksQuestion(1), answer)).toEqual({ gradable: true, correct: false });
  });

  it("single-blank quirk: the app's own check skips iscorrect when there's one real option", () => {
    const q: QuestionForGrading = {
      templatetypeid: 8,
      questionoptions: [
        { questionoptionid: "opt-1", questionoptioniscorrect: false, questionoptionsequence: 1 },
      ],
    };
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["opt-1"] };
    // Mirrors PracticeFillBlank.tsx: with questionOptions.length === 1 the
    // iscorrect check is skipped entirely, so this (data-mistake) option is
    // still accepted by the app, and by this grader.
    expect(gradeAnswer(q, answer)).toEqual({ gradable: true, correct: true });
  });

  it("wrong type is a type-mismatch", () => {
    const answer: AnswerV1 = { v: 1, type: "choice", selected: ["opt-1"] };
    expect(gradeAnswer(blanksQuestion(2), answer)).toEqual({ gradable: false, reason: "type-mismatch" });
  });

  it("filling the same blank twice does not substitute for the missing second blank", () => {
    // Right length (2), but opt-1 is repeated instead of also placing
    // opt-2 — must not be accepted just because the count matches.
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["opt-1", "opt-1"] };
    expect(gradeAnswer(blanksQuestion(2), answer)).toEqual({ gradable: true, correct: false });
  });

  it("a foreign id among otherwise-correct blanks is incorrect, not a crash", () => {
    const answer: AnswerV1 = { v: 1, type: "blanks", filled: ["opt-1", "not-a-real-option"] };
    expect(gradeAnswer(blanksQuestion(2), answer)).toEqual({ gradable: true, correct: false });
  });
});

describe("gradeAnswer: unsupported templates 9-17", () => {
  it.each([9, 10, 11, 12, 13, 14, 15, 16, 17])("template %i is unsupported-template regardless of answer", (t) => {
    const q: QuestionForGrading = { templatetypeid: t, questionoptions: [] };
    expect(gradeAnswer(q, { v: 1, type: "choice", selected: [] })).toEqual({
      gradable: false,
      reason: "unsupported-template",
    });
    expect(gradeAnswer(q, undefined)).toEqual({ gradable: false, reason: "unsupported-template" });
  });

  it("an entirely unknown template id is also unsupported-template, not a crash", () => {
    const q: QuestionForGrading = { templatetypeid: 999, questionoptions: [] };
    expect(gradeAnswer(q, undefined)).toEqual({ gradable: false, reason: "unsupported-template" });
  });
});

describe("gradeAnswer: prototype templates 18-24 stay ungraded (workspace#79 decision 5)", () => {
  it.each([18, 19, 20, 21, 22, 23, 24])("template %i is always prototype-not-graded", (t) => {
    const q: QuestionForGrading = { templatetypeid: t, questionoptions: [] };
    expect(gradeAnswer(q, { v: 1, type: "choice", selected: [] })).toEqual({
      gradable: false,
      reason: "prototype-not-graded",
    });
    expect(gradeAnswer(q, undefined)).toEqual({ gradable: false, reason: "prototype-not-graded" });
    expect(gradeAnswer(q, "garbage")).toEqual({ gradable: false, reason: "prototype-not-graded" });
  });
});

describe("isAnswerV1", () => {
  it("accepts a well-formed answer of every kind", () => {
    const answers: unknown[] = [
      { v: 1, type: "choice", selected: ["a"] },
      { v: 1, type: "order", order: ["a", "b"] },
      { v: 1, type: "match", pairs: { a: "a" } },
      { v: 1, type: "blanks", filled: ["a"] },
      { v: 1, type: "counts", counts: { a: 2 } },
      { v: 1, type: "text", entries: { a: "hi" } },
      { v: 1, type: "fraction", parts: { a: { numerator: "1", denominator: "2" } } },
    ];
    for (const a of answers) expect(isAnswerV1(a)).toBe(true);
  });

  it("rejects a wrong version, an unknown type, and wrongly-typed payloads", () => {
    expect(isAnswerV1({ v: 2, type: "choice", selected: ["a"] })).toBe(false);
    expect(isAnswerV1({ v: 1, type: "nonsense", foo: "bar" })).toBe(false);
    expect(isAnswerV1({ v: 1, type: "choice", selected: [1, 2] })).toBe(false);
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: "2" } })).toBe(false);
  });

  it("never throws on primitives, arrays, null or undefined", () => {
    expect(isAnswerV1(null)).toBe(false);
    expect(isAnswerV1(undefined)).toBe(false);
    expect(isAnswerV1("string")).toBe(false);
    expect(isAnswerV1(42)).toBe(false);
    expect(isAnswerV1([1, 2, 3])).toBe(false);
  });

  it("counts must be non-negative integers", () => {
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: 3 } })).toBe(true);
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: 0 } })).toBe(true);
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: -1 } })).toBe(false);
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: 1.5 } })).toBe(false);
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: NaN } })).toBe(false);
    expect(isAnswerV1({ v: 1, type: "counts", counts: { a: Infinity } })).toBe(false);
  });
});
