import { ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { SchemaValidationInterceptor } from "src/interceptors/schemavalidation.interceptor";
import { resultpractice } from "./result.request.validator";

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
