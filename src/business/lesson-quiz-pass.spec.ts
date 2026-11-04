import { lessonQuizAttemptPoints, lessonQuizPassRequired, requiresLessonQuizPass } from "./lesson-quiz-pass";
import { organisations } from "src/models/data-models/organisations";

describe("requiresLessonQuizPass: only the boolean true turns the rule on", () => {
  it.each([
    [{ requireLessonQuizPass: true }, true],
    [{ requireLessonQuizPass: false }, false],
    [{ requireLessonQuizPass: "true" }, false],
    [{ requireLessonQuizPass: 1 }, false],
    [{ requireLessonQuizPass: null }, false],
    [{}, false],
    [{ other: true }, false],
    [null, false],
    [undefined, false],
    ["{\"requireLessonQuizPass\":true}", false],
    [[true], false],
    [1, false],
  ])("settingsconfig %j is %s", (value, expected) => {
    expect(requiresLessonQuizPass(value)).toBe(expected);
  });
});

describe("lessonQuizAttemptPoints", () => {
  it("rule on: a fail earns 0, a pass earns the points", () => {
    expect(lessonQuizAttemptPoints(true, false, 40)).toBe(0);
    expect(lessonQuizAttemptPoints(true, true, 40)).toBe(40);
  });
  it("rule off: the points are passed through unchanged, pass or fail", () => {
    expect(lessonQuizAttemptPoints(false, false, 40)).toBe(40);
    expect(lessonQuizAttemptPoints(false, true, 40)).toBe(40);
    expect(lessonQuizAttemptPoints(false, false, null)).toBeNull();
    expect(lessonQuizAttemptPoints(false, false, undefined)).toBeUndefined();
  });
});

describe("lessonQuizPassRequired", () => {
  afterEach(() => jest.restoreAllMocks());
  it("reads the organisation named by the token", async () => {
    const find = jest.spyOn(organisations, "findOne").mockResolvedValue({ settingsconfig: { requireLessonQuizPass: true } } as never);
    expect(await lessonQuizPassRequired({ organisationid: " org-1 " })).toBe(true);
    expect(find.mock.calls[0][0]).toMatchObject({ where: { organisationid: "org-1" } });
  });
  it("is off with no organisation on the token, without reading anything", async () => {
    const find = jest.spyOn(organisations, "findOne");
    expect(await lessonQuizPassRequired({})).toBe(false);
    expect(await lessonQuizPassRequired({ organisationid: null })).toBe(false);
    expect(find).not.toHaveBeenCalled();
  });
  it("is off when the organisation row is missing or the read fails", async () => {
    const find = jest.spyOn(organisations, "findOne").mockResolvedValueOnce(null);
    expect(await lessonQuizPassRequired({ organisationid: "o" })).toBe(false);
    find.mockRejectedValueOnce(new Error("db down"));
    expect(await lessonQuizPassRequired({ organisationid: "o" })).toBe(false);
  });
});
