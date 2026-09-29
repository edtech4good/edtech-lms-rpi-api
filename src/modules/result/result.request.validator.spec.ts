import { ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { SchemaValidationInterceptor } from "src/interceptors/schemavalidation.interceptor";
import { isAnswerV1 } from "src/business/grading";
import { resultbaselinequestion, resultlevelquiz, resultpractice, resultquiz } from "./result.request.validator";

/**
 * The practice submission body must carry a `result` array. An empty array
 * is legitimate (the Expo client sends only correct answers, so an all-wrong
 * attempt submits `[]`), but a body with no `result` key at all is rejected
 * rather than silently scored as a zero.
 *
 * Runs through SchemaValidationInterceptor so the test sees the same
 * compile/validate call the route does.
 */
const Q = "11111111-1111-4111-8111-111111111111";

const validate = (body: unknown) => {
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext;
  return new SchemaValidationInterceptor(resultpractice).intercept(context, {
    handle: () => of(null),
  });
};

describe("resultpractice validator", () => {
  it("accepts a practice submission with answers", () => {
    expect(() =>
      validate({
        result: [
          {
            iscorrect: true,
            lessonpracticeid: Q,
            lessonpracticequestionid: Q,
            questionid: Q,
            tries: 1,
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts an empty result array (all-wrong attempt)", () => {
    expect(() => validate({ result: [] })).not.toThrow();
  });

  it("rejects a body with no result key", () => {
    // #75's error contract humanizes Joi's raw "\"result\" is required"
    // message via src/utils/joi-message.ts; every `any.required` failure
    // now reads "Enter a value for <field>." regardless of the field name.
    expect(() => validate({})).toThrow(/Enter a value for result/);
  });
});

/**
 * the server-grading protocol: each item may carry an optional `answer` object.
 * The joi schema here only checks the AnswerV1 envelope (`v`, `type`) —
 * detailed per-template validation is isAnswerV1 in src/business/grading.
 *
 * The critical old-client guarantee: a payload with NO `answer` field at
 * all must still validate exactly as before (#4 in the task — a 400 here
 * makes the app drop queued results after 24h). And the validator must
 * still reject a genuinely unknown key, so a typo or a future protocol
 * change is caught rather than silently ignored.
 */
describe("answer field (the server-grading protocol)", () => {
  const baseItem = {
    iscorrect: true,
    lessonpracticeid: Q,
    lessonpracticequestionid: Q,
    questionid: Q,
    tries: 1,
  };

  it("still accepts an old-format item with no answer field at all", () => {
    expect(() => validate({ result: [baseItem] })).not.toThrow();
  });

  it("accepts an item with a valid AnswerV1 envelope", () => {
    expect(() =>
      validate({
        result: [{ ...baseItem, answer: { v: 1, type: "choice", selected: ["a"] } }],
      }),
    ).not.toThrow();
  });

  it("rejects an answer with the wrong version", () => {
    expect(() =>
      validate({
        result: [{ ...baseItem, answer: { v: 2, type: "choice" } }],
      }),
    ).toThrow();
  });

  it("rejects an answer with an unrecognized type", () => {
    expect(() =>
      validate({
        result: [{ ...baseItem, answer: { v: 1, type: "essay" } }],
      }),
    ).toThrow();
  });

  it("still rejects an unrelated unknown key on the item (unknown keys are not just waved through)", () => {
    expect(() =>
      validate({
        result: [{ ...baseItem, somethingelse: "nope" }],
      }),
    ).toThrow();
  });
});

describe("resultquiz / resultlevelquiz / resultbaselinequestion accept the same optional answer field", () => {
  const validateWith = (schema: typeof resultquiz) => (body: unknown) => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ body }) }),
    } as unknown as ExecutionContext;
    return new SchemaValidationInterceptor(schema).intercept(context, {
      handle: () => of(null),
    });
  };

  it("resultquiz: old format still passes, and answer is accepted", () => {
    const v = validateWith(resultquiz);
    expect(() =>
      v({ result: [{ iscorrect: true, lessonquizid: Q, lessonquizquestionid: Q, questionid: Q }] }),
    ).not.toThrow();
    expect(() =>
      v({
        result: [
          {
            iscorrect: true,
            lessonquizid: Q,
            lessonquizquestionid: Q,
            questionid: Q,
            answer: { v: 1, type: "text", value: "42" },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("resultlevelquiz: old format still passes, and answer is accepted", () => {
    const v = validateWith(resultlevelquiz);
    expect(() =>
      v({ result: [{ iscorrect: true, levelid: Q, levelquizquestionid: Q, questionid: Q }] }),
    ).not.toThrow();
    expect(() =>
      v({
        result: [
          {
            iscorrect: true,
            levelid: Q,
            levelquizquestionid: Q,
            questionid: Q,
            answer: { v: 1, type: "fraction", numerator: 1, denominator: 2 },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("resultbaselinequestion: old format still passes, and answer is accepted", () => {
    const v = validateWith(resultbaselinequestion);
    expect(() =>
      v({ result: [{ iscorrect: true, curriculumbaselineid: Q, baselinequestionid: Q, questionid: Q }] }),
    ).not.toThrow();
    expect(() =>
      v({
        result: [
          {
            iscorrect: true,
            curriculumbaselineid: Q,
            baselinequestionid: Q,
            questionid: Q,
            answer: { v: 1, type: "order", order: ["opt-1", "opt-2", "opt-3"] },
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe("answer: null and size caps", () => {
  const baseItem = {
    iscorrect: true,
    lessonquizid: Q,
    lessonquizquestionid: Q,
    questionid: Q,
  };
  const validateQuiz = (body: unknown) => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ body }) }),
    } as unknown as ExecutionContext;
    return new SchemaValidationInterceptor(resultquiz).intercept(context, { handle: () => of(null) });
  };

  it("answer: null is accepted, not a 400 (treated as absent)", () => {
    expect(() => validateQuiz({ result: [{ ...baseItem, answer: null }] })).not.toThrow();
  });

  it("a string field over 200 characters is rejected", () => {
    expect(() =>
      validateQuiz({ result: [{ ...baseItem, answer: { v: 1, type: "text", value: "a".repeat(201) } }] }),
    ).toThrow();
  });

  it("a string field at exactly 200 characters is accepted", () => {
    expect(() =>
      validateQuiz({ result: [{ ...baseItem, answer: { v: 1, type: "text", value: "a".repeat(200) } }] }),
    ).not.toThrow();
  });

  it("an array field (selected) over 50 entries is rejected — guards a multi-megabyte answer payload", () => {
    expect(() =>
      validateQuiz({
        result: [{ ...baseItem, answer: { v: 1, type: "choice", selected: Array(51).fill("a") } }],
      }),
    ).toThrow();
  });

  it("an array field at exactly 50 entries is accepted", () => {
    expect(() =>
      validateQuiz({
        result: [{ ...baseItem, answer: { v: 1, type: "choice", selected: Array(50).fill("a") } }],
      }),
    ).not.toThrow();
  });

  it("a record field (counts) over 50 keys is rejected", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 51; i++) counts[`k${i}`] = i;
    expect(() => validateQuiz({ result: [{ ...baseItem, answer: { v: 1, type: "counts", counts } }] })).toThrow();
  });

  it("an unknown field not in the explicit list is still bounded by the wildcard pattern", () => {
    expect(() =>
      validateQuiz({
        result: [{ ...baseItem, answer: { v: 1, type: "text", somethingnew: "x".repeat(201) } }],
      }),
    ).toThrow();
  });

  it("a result array over 200 items is rejected", () => {
    const items = Array.from({ length: 201 }, () => ({ ...baseItem }));
    expect(() => validateQuiz({ result: items })).toThrow();
  });

  it("a result array at exactly 200 items is accepted", () => {
    const items = Array.from({ length: 200 }, () => ({ ...baseItem }));
    expect(() => validateQuiz({ result: items })).not.toThrow();
  });

  it("a huge single answer string (millions of characters, as a real attack would try) is rejected, not merely slow", () => {
    const huge = { v: 1, type: "text", value: "េ".repeat(5_000_000) };
    expect(() => validateQuiz({ result: [{ ...baseItem, answer: huge }] })).toThrow();
  });
});

/**
 * Guards a real regression: `pairs`/`parts` were once schema'd as arrays
 * (`boundedArray`), but #93's `AnswerV1` defines them as records
 * (`Record<string, string>` / `Record<string, {numerator, denominator}>`).
 * A well-formed `match` (drag-drop, template 7 — graded) or `fraction`
 * answer got a 400 here even though `isAnswerV1` accepted it; once the app
 * sends `answer`, a whole quiz result containing one such question would be
 * rejected outright and dropped after 24h (pendingResultsQueue).
 *
 * These fixtures are the canonical AnswerV1 shapes from #93's own tests
 * (src/business/grading/index.spec.ts's "accepts a well-formed answer of
 * every kind" and "rejects a wrong version..." fixtures, plus a few more
 * real shapes drawn from the same file's individual template tests) run
 * through BOTH the validator and `isAnswerV1` — for every shape, the two
 * must agree: both accept, or both reject. `null` is the one deliberate,
 * documented exception (the validator treats it as "absent"; `isAnswerV1`
 * correctly says it's not a valid answer) and is excluded here.
 */
describe("agrees with isAnswerV1 on every #93 fixture shape", () => {
  const validateItem = (answer: unknown) => {
    const base = {
      iscorrect: true,
      lessonquizid: Q,
      lessonquizquestionid: Q,
      questionid: Q,
      answer,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ body: { result: [base] } }) }),
    } as unknown as ExecutionContext;
    try {
      new SchemaValidationInterceptor(resultquiz).intercept(context, { handle: () => of(null) });
      return true;
    } catch {
      return false;
    }
  };

  // From index.spec.ts's "accepts a well-formed answer of every kind" — one canonical shape per type.
  const validShapes: unknown[] = [
    { v: 1, type: "choice", selected: ["a"] },
    { v: 1, type: "order", order: ["a", "b"] },
    { v: 1, type: "match", pairs: { a: "a" } },
    { v: 1, type: "blanks", filled: ["a"] },
    { v: 1, type: "counts", counts: { a: 2 } },
    { v: 1, type: "text", entries: { a: "hi" } },
    { v: 1, type: "fraction", parts: { a: { numerator: "1", denominator: "2" } } },
    // Further real shapes exercised elsewhere in index.spec.ts's individual template tests.
    { v: 1, type: "choice", selected: ["opt-1", "opt-2", "opt-3"] }, // multi-select MCQ
    { v: 1, type: "choice", selected: [] }, // nothing selected — still a valid (if ungradeable-as-correct) shape
    { v: 1, type: "order", order: ["opt-1", "opt-2", "opt-3"] },
    { v: 1, type: "match", pairs: { cat: "cat", dog: "dog" } }, // drag-drop / template 7
    { v: 1, type: "blanks", filled: ["opt-1", "opt-2"] },
    { v: 1, type: "counts", counts: { a: 0 } }, // zero taps is valid (non-negative integer)
  ];

  // From index.spec.ts's "rejects a wrong version, an unknown type, and
  // wrongly-typed payloads" and "never throws on primitives..." (minus
  // `null`/`undefined`, the validator's own documented "absent" cases).
  const invalidShapes: unknown[] = [
    { v: 2, type: "choice", selected: ["a"] }, // wrong version
    { v: 1, type: "nonsense", foo: "bar" }, // unknown type
    { v: 1, type: "choice", selected: [1, 2] }, // wrong element type
    { v: 1, type: "counts", counts: { a: "2" } }, // counts must be numbers, not numeric strings
    { v: 1, type: "counts", counts: { a: -1 } }, // counts must be non-negative
    { v: 1, type: "counts", counts: { a: 1.5 } }, // counts must be integers
    "string",
    42,
    [1, 2, 3],
  ];

  it.each(validShapes)("accepts (both validator and isAnswerV1): %j", (answer) => {
    expect(isAnswerV1(answer)).toBe(true);
    expect(validateItem(answer)).toBe(true);
  });

  it.each(invalidShapes)("rejects (both validator and isAnswerV1): %j", (answer) => {
    expect(isAnswerV1(answer)).toBe(false);
    expect(validateItem(answer)).toBe(false);
  });
});
