import {
  gradeDOption1,
  gradeDOption3,
  gradeDOption4,
  gradeFOption1,
  gradeFOption2,
  gradeFOption4,
  gradeFraction,
} from "./prototypes";
import { GradingOption } from "./option";

function opt(partial: Partial<GradingOption> & { questionoptionid: string }): GradingOption {
  return {
    questionoptiontext: undefined,
    questionoptioniscorrect: false,
    questionoptionsequence: undefined,
    questionoptionvalue: undefined,
    questionoptionnumeratorvalue: undefined,
    questionoptionnumeratorisstatic: false,
    questionoptiondenominatorvalue: undefined,
    questionoptiondenominatorisstatic: false,
    questionoptionisfraction: false,
    questionoptionistext: false,
    ...partial,
  };
}

describe("gradeDOption1 (template 18: single choice)", () => {
  const options = [
    opt({ questionoptionid: "a", questionoptioniscorrect: false }),
    opt({ questionoptionid: "b", questionoptioniscorrect: true }),
  ];

  it("the correct single selection is correct", () => {
    expect(gradeDOption1(options, ["b"])).toBe(true);
  });

  it("the wrong single selection is incorrect", () => {
    expect(gradeDOption1(options, ["a"])).toBe(false);
  });
});

describe("gradeDOption3 (template 19: per-area counts)", () => {
  // 2 x [+3] should fill an area whose questionoptionvalue is 6; a "+"
  // label option carries no numeric value and is never tappable.
  const options = [
    opt({ questionoptionid: "label-plus", questionoptiontext: "+", questionoptionvalue: undefined }),
    opt({ questionoptionid: "area-1", questionoptionvalue: 6 }),
    opt({ questionoptionid: "area-2", questionoptionvalue: 2 }),
  ];

  it("every tappable area matching its target count is correct", () => {
    expect(gradeDOption3(options, { "area-1": 6, "area-2": 2 })).toBe(true);
  });

  it("a wrong count on a tapped area is incorrect", () => {
    expect(gradeDOption3(options, { "area-1": 5, "area-2": 2 })).toBe(false);
  });

  it("fixes the app's own bug: an untapped area that needed a nonzero count is incorrect", () => {
    // The real app (DOption3.tsx handleSubmit) only walks `data.answers` —
    // areas never tapped are never checked, so this partial answer would
    // wrongly pass in the app. The intended grader here catches it.
    expect(gradeDOption3(options, { "area-1": 6 })).toBe(false);
  });

  it("a label option with no numeric value is ignored", () => {
    expect(gradeDOption3(options, { "area-1": 6, "area-2": 2, "label-plus": 99 })).toBe(true);
  });
});

describe("gradeDOption4 (template 20: total-value counts)", () => {
  const options = [
    opt({ questionoptionid: "coin-1", questionoptionvalue: 1 }),
    opt({ questionoptionid: "coin-5", questionoptionvalue: 5 }),
  ];

  it("counts that sum to the correct total are correct", () => {
    expect(gradeDOption4(options, { "coin-1": 3, "coin-5": 1 }, 8)).toBe(true);
  });

  it("counts that sum to the wrong total are incorrect", () => {
    expect(gradeDOption4(options, { "coin-1": 3, "coin-5": 1 }, 9)).toBe(false);
  });

  it("a missing/non-numeric questioncorrectvalue is reported, not silently graded", () => {
    expect(gradeDOption4(options, { "coin-1": 3 }, undefined)).toBeUndefined();
  });
});

describe("gradeFOption1 (template 21: typed text per option)", () => {
  const options = [
    opt({ questionoptionid: "blank-1", questionoptiontext: "ឆ្កែ" }),
    opt({ questionoptionid: "blank-2", questionoptiontext: "ឆ្មា" }),
  ];

  it("exact typed text is correct", () => {
    expect(gradeFOption1(options, { "blank-1": "ឆ្កែ", "blank-2": "ឆ្មា" })).toBe(true);
  });

  it("forgiving match: case, spacing and zero-width noise don't matter", () => {
    expect(gradeFOption1(options, { "blank-1": "  ឆ្កែ​ ", "blank-2": "ឆ្មា" })).toBe(true);
  });

  it("wrong typed text is incorrect", () => {
    expect(gradeFOption1(options, { "blank-1": "ឆ្មា", "blank-2": "ឆ្មា" })).toBe(false);
  });

  it("a missing entry is incorrect", () => {
    expect(gradeFOption1(options, { "blank-1": "ឆ្កែ" })).toBe(false);
  });
});

describe("gradeFOption4 (template 23: typed digits per option)", () => {
  const options = [
    opt({ questionoptionid: "blank-1", questionoptionvalue: 7 }),
    opt({ questionoptionid: "blank-2", questionoptionvalue: 12 }),
  ];

  it("matching typed digits are correct", () => {
    expect(gradeFOption4(options, { "blank-1": "7", "blank-2": "12" })).toBe(true);
  });

  it("Khmer digits match their ASCII equivalents", () => {
    expect(gradeFOption4(options, { "blank-1": "៧", "blank-2": "១២" })).toBe(true);
  });

  it("wrong digits are incorrect", () => {
    expect(gradeFOption4(options, { "blank-1": "8", "blank-2": "12" })).toBe(false);
  });
});

describe("gradeFOption2 (template 22: hard-coded index-4 answer field)", () => {
  const fiveOptions = [
    opt({ questionoptionid: "o0", questionoptiontext: "1" }),
    opt({ questionoptionid: "o1", questionoptiontext: "2" }),
    opt({ questionoptionid: "o2", questionoptiontext: "3" }),
    opt({ questionoptionid: "o3", questionoptiontext: "4" }),
    opt({ questionoptionid: "o4", questionoptionvalue: 15 }), // the answer field, per the app's index-4 assumption
  ];

  it("typing the value at option index 4 is correct", () => {
    expect(gradeFOption2(fiveOptions, { o4: "15" })).toBe(true);
  });

  it("typing the wrong value is incorrect", () => {
    expect(gradeFOption2(fiveOptions, { o4: "16" })).toBe(false);
  });

  it("reproduces the app's bug: fewer than 5 options means no answer field is ever found", () => {
    const threeOptions = fiveOptions.slice(0, 3);
    expect(gradeFOption2(threeOptions, { o2: "3" })).toBeUndefined();
  });
});

describe("gradeFraction (template 24)", () => {
  it("a whole-number fraction (denominator not required) checks only the numerator", () => {
    const options = [opt({ questionoptionid: "f1", questionoptionnumeratorvalue: "3", questionoptionisfraction: false })];
    expect(gradeFraction(options, { f1: { numerator: "3", denominator: "" } })).toBe(true);
    expect(gradeFraction(options, { f1: { numerator: "4", denominator: "" } })).toBe(false);
  });

  it("a true fraction checks both numerator and denominator", () => {
    const options = [
      opt({
        questionoptionid: "f1",
        questionoptionnumeratorvalue: "1",
        questionoptiondenominatorvalue: "2",
        questionoptionisfraction: true,
      }),
    ];
    expect(gradeFraction(options, { f1: { numerator: "1", denominator: "2" } })).toBe(true);
    expect(gradeFraction(options, { f1: { numerator: "1", denominator: "3" } })).toBe(false);
  });

  it("static parts are pre-filled and never checked", () => {
    const options = [
      opt({
        questionoptionid: "f1",
        questionoptionnumeratorvalue: "1",
        questionoptionnumeratorisstatic: true,
        questionoptiondenominatorvalue: "2",
        questionoptiondenominatorisstatic: true,
        questionoptionisfraction: true,
      }),
    ];
    // Nothing was typed for a wholly-static fraction, and that's fine.
    expect(gradeFraction(options, { f1: { numerator: "anything", denominator: "anything" } })).toBe(true);
    expect(gradeFraction(options, {})).toBe(true);
  });

  it("a plain text label option is never checked", () => {
    const options = [opt({ questionoptionid: "label", questionoptionistext: true, questionoptiontext: "+" })];
    expect(gradeFraction(options, {})).toBe(true);
  });

  it("Khmer-digit numerator input matches an ASCII numerator value", () => {
    const options = [opt({ questionoptionid: "f1", questionoptionnumeratorvalue: "9" })];
    expect(gradeFraction(options, { f1: { numerator: "៩", denominator: "" } })).toBe(true);
  });
});
