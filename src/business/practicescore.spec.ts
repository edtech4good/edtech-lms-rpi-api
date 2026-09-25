import { lessonpracticequestions } from "../models/data-models/init-models";
import { practicePassResult, scorepractice } from "./practicescore";

/**
 * Guards the practice pass rule: distinct correct answers to THIS practice's
 * ACTIVE questions ÷ active question count, pass at 80% inclusive.
 *
 * The old rule divided by the submitted payload length. The Expo client only
 * sends correct answers, so any attempt with one right answer scored 100%
 * and passed. These tests drive scorepractice with the active question list
 * mocked, so a regression to payload-relative scoring shows up as a wrong
 * percentage (e.g. 1 correct of 4 active must be 25, not 100).
 */
const PRACTICE = "11111111-1111-4111-8111-111111111111";
const Q = ["q1", "q2", "q3", "q4", "q5"];

const correct = (id: string) => ({ iscorrect: true, lessonpracticequestionid: id });
const wrong = (id: string) => ({ iscorrect: false, lessonpracticequestionid: id });

describe("scorepractice (practice pass mark, 80% inclusive)", () => {
  let findAllSpy: jest.SpyInstance;

  const activeQuestions = (ids: string[]) =>
    findAllSpy.mockResolvedValue(ids.map((lessonpracticequestionid) => ({ lessonpracticequestionid })) as never);

  beforeEach(() => {
    findAllSpy = jest.spyOn(lessonpracticequestions, "findAll");
  });

  afterEach(() => {
    findAllSpy.mockRestore();
  });

  it("queries only this practice's active questions", async () => {
    activeQuestions(Q);
    await scorepractice(PRACTICE, []);
    expect(findAllSpy).toHaveBeenCalledTimes(1);
    const [options]: any = findAllSpy.mock.calls[0];
    expect(options.where).toEqual({ lessonpracticeid: PRACTICE, lessonpracticequestionstatus: true });
  });

  it("4 of 5 correct is 80% and passes (inclusive)", async () => {
    activeQuestions(Q);
    const r = await scorepractice(PRACTICE, ["q1", "q2", "q3", "q4"].map(correct));
    expect(r).toEqual({ marks: 4, percentage: 80, ispass: true });
  });

  it("3 of 4 correct is 75% and fails", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorepractice(PRACTICE, ["q1", "q2", "q3"].map(correct));
    expect(r).toEqual({ marks: 3, percentage: 75, ispass: false });
  });

  it("scores against active questions, not the payload: 1 correct of 4 is 25%", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorepractice(PRACTICE, [correct("q1")]);
    expect(r).toEqual({ marks: 1, percentage: 25, ispass: false });
  });

  it("counts a duplicated correct answer once", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorepractice(PRACTICE, [correct("q1"), correct("q1"), correct("q1"), correct("q2")]);
    expect(r).toEqual({ marks: 2, percentage: 50, ispass: false });
  });

  it("ignores other practices' and inactive questions", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorepractice(PRACTICE, [
      correct("q1"),
      correct("q2"),
      correct("q3"),
      correct("other-practice-question"),
      correct("q5"), // q5 is inactive here: not returned by the active filter
    ]);
    expect(r).toEqual({ marks: 3, percentage: 75, ispass: false });
  });

  it("ignores answers marked iscorrect false (legacy full-answer payloads)", async () => {
    activeQuestions(Q.slice(0, 4));
    const r = await scorepractice(PRACTICE, [correct("q1"), wrong("q2"), wrong("q3"), wrong("q4")]);
    expect(r).toEqual({ marks: 1, percentage: 25, ispass: false });
  });

  it("an empty payload is 0% and fails (not NaN)", async () => {
    activeQuestions(Q.slice(0, 4));
    expect(await scorepractice(PRACTICE, [])).toEqual({ marks: 0, percentage: 0, ispass: false });
  });

  it("a missing payload is treated as empty", async () => {
    activeQuestions(Q.slice(0, 4));
    expect(await scorepractice(PRACTICE, undefined)).toEqual({ marks: 0, percentage: 0, ispass: false });
  });

  it("a practice with no active questions is 100% and passes", async () => {
    activeQuestions([]);
    expect(await scorepractice(PRACTICE, [correct("q1")])).toEqual({ marks: 0, percentage: 100, ispass: true });
  });

  it("rounds to 2 dp", async () => {
    activeQuestions(Q.slice(0, 3));
    expect(await scorepractice(PRACTICE, [correct("q1")])).toEqual({ marks: 1, percentage: 33.33, ispass: false });
  });
});

describe("practicePassResult", () => {
  it("caps the percentage at 100", () => {
    expect(practicePassResult(7, 4)).toEqual({ marks: 7, percentage: 100, ispass: true });
  });

  it("passes at exactly 80 and fails just below", () => {
    expect(practicePassResult(8, 10).ispass).toBe(true);
    expect(practicePassResult(79, 100).ispass).toBe(false);
  });

  it("zero active questions passes at 100", () => {
    expect(practicePassResult(0, 0)).toEqual({ marks: 0, percentage: 100, ispass: true });
  });
});
