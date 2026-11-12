import { LessonBusiness } from "src/business/lesson.business";
import { quizState } from "src/business/certificate-eligibility";
import { lessonquizquestions, levelquizquestions, studentprogress, studentprogressquestions } from "src/models/data-models/init-models";
import { ResultController } from "./result.controller";

/**
 * A learner whose only pass of a quiz was not marked by the server (verified 0) can still store a marked pass.
 *
 * The rule: a submission stops early (no row) only when the learner already holds a VERIFIED pass of the quiz. With only
 * unverified passes the attempt is stored as a normal row, but earns nothing more: the credit is settled by exactly the
 * calls the early stop makes, no stars are added, no award and no reward are made for the attempt, and the row carries the
 * points, full points and stars of the newest stored attempt. With REQUIRE_GRADED_ANSWERS on an unverified pass does not
 * count at all, as before.
 *
 * What is real: the ResultBusiness (ispass, hasverifiedpass, storeheldattempt, getoldpoints), the grading library and the
 * controller. What is faked: the studentprogress table (in memory) and LessonBusiness (every call is recorded). The
 * certificate-side reading of the rows is checked with the rule's own `quizState`. Nothing here ran on MySQL.
 */
const fns = { held: jest.fn(), lessonfull: jest.fn(), levelfull: jest.fn(), quizpoints: jest.fn(), levelpoints: jest.fn() };
jest.mock("src/business/result.business", () => {
  const actual = jest.requireActual("src/business/result.business");
  class TestResultBusiness extends actual.ResultBusiness {
    constructor() {
      super();
      const store = this.storeheldattempt;
      this.storeheldattempt = (...args: unknown[]) => {
        fns.held(...args);
        return store(...args);
      };
    }
    createlessonquizprogress = fns.lessonfull;
    createlevelquizprogress = fns.levelfull;
    updateQuizPoints = fns.quizpoints;
    updateLevelQuizPoints = fns.levelpoints;
  }
  return { ...actual, ResultBusiness: TestResultBusiness };
});
jest.mock("src/business/lesson.business");
jest.mock("src/services/dbservice", () => ({
  dbinstance: { getdbinstance: () => ({ transaction: jest.fn().mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() }) }) },
}));
const MockedLesson = LessonBusiness as jest.MockedClass<typeof LessonBusiness>;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const OPTIONS = [
  { questionoptionid: "opt-1", questionoptiontext: "correct", questionoptioniscorrect: true, questionoptionsequence: 1 },
  { questionoptionid: "opt-2", questionoptiontext: "wrong", questionoptioniscorrect: false, questionoptionsequence: 2 },
];
const RIGHT = { v: 1, type: "choice", selected: ["opt-1"] };
const WRONG = { v: 1, type: "choice", selected: ["opt-2"] };
const user = { studentid: "s1", studentfirstname: "T" } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const attemptAt = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T08:00:00Z`);

describe.each([
  ["lesson quiz", "lq1", 2, "lessonquizquestionid"],
  ["level quiz", "lv1", 3, "levelquizquestionid"],
] as const)("%s: an unverified pass", (_name, refid, progresstype, questionkey) => {
  let rows: Row[];
  let answers: Row[];
  let held: jest.Mock;
  let full: jest.Mock;
  const saved = { m: process.env.GRADING_MODE, r: process.env.REQUIRE_GRADED_ANSWERS };
  const lb = () => MockedLesson.prototype as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls = () => ({
    reward: lb().updateUserReward.mock.calls.length + lb().updateLevelQuizReward.mock.calls.length,
    rewardArgs: [...lb().updateUserReward.mock.calls, ...lb().updateLevelQuizReward.mock.calls].map((c: unknown[]) => c.slice(0, 5).map((x) => (x && typeof x === "object" && "studentid" in (x as object) ? "user" : x && typeof x === "object" && "commit" in (x as object) ? "tx" : x))),
    active: lb().setstudentactive.mock.calls.map((c: unknown[]) => [c[1], c[2]]),
    daily: lb().updateuserdailypoints.mock.calls.length + lb().updateuserdailypointsBylevelquiz.mock.calls.length,
    stars: lb().addstudentscores.mock.calls.length + lb().addstudentlevelquizscores.mock.calls.length,
  });

  const pass = (verified: boolean, day: number, extra: Row = {}): Row => ({
    studentprogressid: `p${rows.length}`, studentid: "s1", studentprogressreferenceid: refid, progresstype, ispass: true, verified,
    resultpercentage: 100, points: 40, fullpoints: 40, scores: 3, starttime: attemptAt(day), ...extra,
  });
  const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => (v instanceof Date ? r[k]?.getTime() === v.getTime() : r[k] === v));
  const submit = (correct: boolean) => {
    const items = [{ iscorrect: correct, [questionkey]: "q1", answer: correct ? RIGHT : WRONG, ...(progresstype === 2 ? { lessonquizid: refid } : { levelid: refid }), questionid: "q1" }];
    const body = { result: items, starttime: attemptAt(20), endtime: attemptAt(20) } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = new ResultController();
    return progresstype === 2 ? c.savelessonquizresult(refid, body, user) : c.savelevelquizresult(refid, body, user);
  };
  const eligibility = () =>
    quizState(rows.filter((r) => r.studentprogressreferenceid === refid).map((r) => ({ verified: Boolean(r.verified), percentage: Number(r.resultpercentage) })));

  beforeEach(() => {
    process.env.GRADING_MODE = "enforce";
    delete process.env.REQUIRE_GRADED_ANSWERS;
    rows = [];
    answers = [];
    jest.spyOn(studentprogress, "count").mockImplementation((async (o: any) => rows.filter((r) => match(r, o.where)).length) as never); // eslint-disable-line @typescript-eslint/no-explicit-any
    jest.spyOn(studentprogress, "findOne").mockImplementation((async (o: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const hit = rows.filter((r) => match(r, o.where)).sort((a, b) => b.starttime.getTime() - a.starttime.getTime());
      return hit[0] ? { ...hit[0] } : null;
    }) as never);
    jest.spyOn(studentprogress, "findOrCreate").mockImplementation((async (o: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const found = rows.find((r) => match(r, o.where));
      if (found) return [found, false];
      const row = { ...o.defaults };
      rows.push(row);
      return [row, true];
    }) as never);
    jest.spyOn(studentprogressquestions, "create").mockImplementation((async (v: Row) => void answers.push(v)) as never);
    const active = [{ [questionkey]: "q1", question: { templatetypeid: 1, questionoptions: OPTIONS } }];
    jest.spyOn(lessonquizquestions, "findAll").mockResolvedValue(active.map((a) => ({ ...a, lessonquizquestionid: "q1" })) as never);
    jest.spyOn(levelquizquestions, "findAll").mockResolvedValue(active.map((a) => ({ ...a, levelquizquestionid: "q1" })) as never);
    for (const f of Object.values(fns)) f.mockReset().mockResolvedValue(undefined);
    full = progresstype === 2 ? fns.lessonfull : fns.levelfull;
    held = fns.held;
    lb().getlessonquiz = jest.fn().mockResolvedValue({ lessonquizid: "lq1", lessonid: "l1", points: 50 });
    lb().getlevelquiz = jest.fn().mockResolvedValue({ levelid: "lv1", quiz_points: 50 });
    lb().calculateQuizScore = jest.fn().mockResolvedValue({ userpoints: 40, fullpoints: 40, lesson: { lessonid: "l1" } });
    lb().calculateLevelQuizScore = jest.fn().mockResolvedValue({ userpoints: 40, fullpoints: 40, level: { levelid: "lv1" } });
    for (const f of ["updateUserReward", "updateLevelQuizReward", "setstudentactive", "updateuserdailypoints", "updateuserdailypointsBylevelquiz", "addstudentscores", "addstudentlevelquizscores"]) {
      lb()[f] = jest.fn().mockResolvedValue(undefined);
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (saved.m === undefined) delete process.env.GRADING_MODE; else process.env.GRADING_MODE = saved.m;
    if (saved.r === undefined) delete process.env.REQUIRE_GRADED_ANSWERS; else process.env.REQUIRE_GRADED_ANSWERS = saved.r;
  });

  /** What the early stop does for a learner with a marked pass: the baseline the held attempt must match. */
  const stopped = async () => {
    rows = [pass(true, 1)];
    await submit(true);
    expect(rows).toHaveLength(1); // (c) no row
    const out = calls();
    for (const f of Object.keys(lb())) if (jest.isMockFunction(lb()[f])) lb()[f].mockClear();
    return out;
  };

  it("(a) a new marked pass is stored (verified 1) and ends as the early stop does: same calls, no reward, no stars; eligibility goes from unverified to passed", async () => {
    const expected = await stopped();
    rows = [pass(false, 1)];
    expect(eligibility()).toEqual({ state: "unverified", bestpercent: 100 });
    await submit(true);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ studentid: "s1", studentprogressreferenceid: refid, progresstype, verified: true, ispass: true, resultpercentage: 100, points: 40, fullpoints: 40, scores: 3 });
    expect(answers).toHaveLength(1);
    expect(held).toHaveBeenCalledTimes(1);
    expect(full).not.toHaveBeenCalled();
    expect(calls()).toEqual(expected);
    expect(calls().stars).toBe(0);
    expect(eligibility()).toEqual({ state: "passed", bestpercent: 100 });
  });

  it("(a) the stored row carries the credit the settle step has just written (not the attempt's own points), and the newest row's stars", async () => {
    rows = [pass(false, 1, { points: 25, fullpoints: 30, scores: 1 })];
    fns.quizpoints.mockResolvedValue({ points: 50, fullpoints: 60 });
    fns.levelpoints.mockResolvedValue({ points: 50, fullpoints: 60 });
    await submit(true); // the attempt itself scored 40 points
    expect(rows[1]).toMatchObject({ points: 50, fullpoints: 60, scores: 1 });
  });

  it("shadow grading (the default): no result is ever marked, so the early stop is unchanged: no row, no attempt", async () => {
    process.env.GRADING_MODE = "shadow";
    rows = [pass(false, 1)];
    await submit(true);
    expect(rows).toHaveLength(1);
    expect(held).not.toHaveBeenCalled();
    expect(full).not.toHaveBeenCalled();
  });

  it("(b) a new failing attempt is stored and nothing else changes: the unverified pass stays the best unmarked result", async () => {
    const expected = await stopped();
    rows = [pass(false, 1)];
    await submit(false);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ ispass: false, verified: true, resultpercentage: 0, points: 40, scores: 3 });
    expect(calls()).toEqual(expected);
    expect(full).not.toHaveBeenCalled();
    expect(eligibility()).toEqual({ state: "unverified", bestpercent: 100 });
  });

  it("(b) the same submission sent twice (a retry) is stored once", async () => {
    rows = [pass(false, 1)];
    await submit(true);
    await submit(true);
    expect(rows).toHaveLength(2);
  });

  it("(c) a marked pass stops the submission: no row, no new attempt", async () => {
    rows = [pass(true, 1), pass(false, 2)];
    await submit(true);
    expect(rows).toHaveLength(2);
    expect(held).not.toHaveBeenCalled();
    expect(full).not.toHaveBeenCalled();
    expect(answers).toHaveLength(0);
  });

  it("(d) no pass yet: the attempt is saved in full, as before", async () => {
    rows = [pass(false, 1, { ispass: false, resultpercentage: 40 })];
    await submit(true);
    expect(full).toHaveBeenCalledTimes(1);
    expect(held).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("(f) with REQUIRE_GRADED_ANSWERS on, an unverified pass does not count: the attempt is saved in full, as before", async () => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    rows = [pass(false, 1)];
    await submit(true);
    expect(full).toHaveBeenCalledTimes(1);
    expect(held).not.toHaveBeenCalled();
  });

  it("(f) with REQUIRE on, a marked pass still stops the submission", async () => {
    process.env.REQUIRE_GRADED_ANSWERS = "true";
    rows = [pass(true, 1)];
    await submit(true);
    expect(full).not.toHaveBeenCalled();
    expect(held).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });
});
