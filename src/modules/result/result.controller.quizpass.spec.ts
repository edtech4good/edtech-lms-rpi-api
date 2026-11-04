import { ResultBusiness } from "src/business/result.business";
import { LessonBusiness } from "src/business/lesson.business";
import { organisations, lessonquizquestions } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { ResultController } from "./result.controller";

/**
 * Wiring of the per-organisation lesson quiz rule in savelessonquizresult, with the business classes mocked
 * (the same arrangement as result.controller.quizscore.spec.ts). The behaviour against real tables is in
 * result.controller.quizpass.db.spec.ts, which needs a scratch database.
 */
jest.mock("src/business/result.business");
jest.mock("src/business/lesson.business");

describe("savelessonquizresult stores the points the organisation's rule allows", () => {
  let createlessonquizprogress: jest.Mock;
  let orgSpy: jest.SpyInstance;

  const submit = (correct: number, organisationid: string | null = "org-1") =>
    new ResultController().savelessonquizresult(
      "lq1",
      {
        result: ["q1", "q2"].map((id, i) => ({ iscorrect: i < correct, lessonquizquestionid: id, lessonquizid: "lq1", questionid: id })),
        starttime: new Date(),
        endtime: new Date(),
      } as never,
      { studentid: "s1", studentfirstname: "Test", organisationid } as never,
    );

  beforeEach(() => {
    createlessonquizprogress = jest.fn().mockResolvedValue(undefined);
    ((ResultBusiness as unknown as { prototype: Record<string, unknown> }).prototype).ispass = jest.fn().mockResolvedValue(false);
    // The learner has attempted this quiz before: a rule keyed on history (first attempt only) would not apply.
    ((ResultBusiness as unknown as { prototype: Record<string, unknown> }).prototype).hasTried = jest.fn().mockResolvedValue({ studentprogressid: "earlier" });
    ((ResultBusiness as unknown as { prototype: Record<string, unknown> }).prototype).createlessonquizprogress = createlessonquizprogress;
    ((LessonBusiness as unknown as { prototype: Record<string, unknown> }).prototype).calculateQuizScore = jest
      .fn()
      .mockResolvedValue({ marks: 0, userpoints: 40, fullpoints: 40, lesson: { lessonid: "l1" } });
    ((LessonBusiness as unknown as { prototype: Record<string, unknown> }).prototype).updateuserdailypoints = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(lessonquizquestions, "findAll").mockResolvedValue(["q1", "q2"].map((lessonquizquestionid) => ({ lessonquizquestionid })) as never);
    orgSpy = jest.spyOn(organisations, "findOne");
  });
  afterEach(() => jest.restoreAllMocks());

  const stored = () => createlessonquizprogress.mock.calls[0][0];

  it("rule on: a failed attempt is stored with its real percentage and 0 points", async () => {
    orgSpy.mockResolvedValue({ settingsconfig: { requireLessonQuizPass: true } } as never);
    await submit(1);
    expect(stored()).toMatchObject({ ispass: false, passpercentage: 50, points: 0 });
  });

  it("rule on: a passing attempt is stored with the quiz's points", async () => {
    orgSpy.mockResolvedValue({ settingsconfig: { requireLessonQuizPass: true } } as never);
    await submit(2);
    expect(stored()).toMatchObject({ ispass: true, passpercentage: 100, points: 40 });
  });

  it.each([[{}], [null], [{ requireLessonQuizPass: "true" }], [{ requireLessonQuizPass: 1 }]])("rule off (%j): a failed attempt keeps the quiz's points", async (settingsconfig) => {
    orgSpy.mockResolvedValue({ settingsconfig } as never);
    await submit(1);
    expect(stored()).toMatchObject({ ispass: false, points: 40 });
  });

  it("an unreadable setting never breaks the submission: scored as before", async () => {
    orgSpy.mockRejectedValue(new Error("db down"));
    await submit(1);
    expect(stored()).toMatchObject({ ispass: false, points: 40 });
  });

  it("a token with no organisation is scored as before and reads no organisation", async () => {
    await submit(1, null);
    expect(orgSpy).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({ points: 40 });
  });

  it("rule on: every failed attempt is stored with 0 points, not only the first, and the rule reaches the saver", async () => {
    orgSpy.mockResolvedValue({ settingsconfig: { requireLessonQuizPass: true } } as never);
    await submit(1);
    await submit(0);
    await submit(1);
    expect(createlessonquizprogress.mock.calls.map((c) => c[0].points)).toEqual([0, 0, 0]);
    expect(createlessonquizprogress.mock.calls.map((c) => c[3])).toEqual([true, true, true]);
  });

  it("rule off: the saver is told the rule is off", async () => {
    orgSpy.mockResolvedValue({ settingsconfig: {} } as never);
    await submit(1);
    expect(createlessonquizprogress.mock.calls[0][3]).toBe(false);
  });

  describe("an attempt that REQUIRE_GRADED_ANSWERS forces to a non-pass earns nothing", () => {
    const saved = { mode: process.env.GRADING_MODE, require: process.env.REQUIRE_GRADED_ANSWERS };
    beforeEach(() => {
      process.env.GRADING_MODE = "enforce";
      process.env.REQUIRE_GRADED_ANSWERS = "true";
      // each active question carries its grading data; the submitted items carry no `answer`, so none can be verified
      jest.spyOn(lessonquizquestions, "findAll").mockResolvedValue(
        ["q1", "q2"].map((lessonquizquestionid) => ({ lessonquizquestionid, question: { templatetypeid: 1, questionoptions: null, questioncorrectvalue: 1, questiondistractors: null } })) as never,
      );
    });
    afterEach(() => {
      for (const [key, value] of [["GRADING_MODE", saved.mode], ["REQUIRE_GRADED_ANSWERS", saved.require]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it("rule on: an unverified attempt scoring 100% is stored as a non-pass with 0 points", async () => {
      orgSpy.mockResolvedValue({ settingsconfig: { requireLessonQuizPass: true } } as never);
      await submit(2);
      expect(stored()).toMatchObject({ ispass: false, passpercentage: 100, verified: false, points: 0 });
    });

    it("rule off: the same attempt keeps the quiz's points", async () => {
      orgSpy.mockResolvedValue({ settingsconfig: {} } as never);
      await submit(2);
      expect(stored()).toMatchObject({ ispass: false, passpercentage: 100, verified: false, points: 40 });
    });
  });

  describe("an already-passed quiz", () => {
    let getoldpoints: jest.Mock;
    let getpassoldpoints: jest.Mock;
    let updateUserReward: jest.Mock;
    beforeEach(() => {
      const rbproto = (ResultBusiness as unknown as { prototype: Record<string, unknown> }).prototype;
      const lbproto = (LessonBusiness as unknown as { prototype: Record<string, unknown> }).prototype;
      rbproto.ispass = jest.fn().mockResolvedValue(true);
      getoldpoints = jest.fn().mockResolvedValue(0);
      getpassoldpoints = jest.fn().mockResolvedValue(null);
      rbproto.getoldpoints = getoldpoints;
      rbproto.getpassoldpoints = getpassoldpoints;
      rbproto.updateQuizPoints = jest.fn().mockResolvedValue(undefined);
      updateUserReward = jest.fn().mockResolvedValue(undefined);
      lbproto.getlessonquiz = jest.fn().mockResolvedValue({ lessonquizid: "lq1", lessonid: "l1", points: 40 });
      lbproto.updateUserReward = updateUserReward;
      lbproto.setstudentactive = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(dbinstance, "getdbinstance").mockReturnValue({ transaction: async () => ({ commit: async () => undefined, rollback: async () => undefined }) } as never);
    });

    it("rule on: the credit is compared with the pass row, not the newest row", async () => {
      orgSpy.mockResolvedValue({ settingsconfig: { requireLessonQuizPass: true } } as never);
      await submit(1);
      expect(getpassoldpoints).toHaveBeenCalledTimes(1);
      expect(getoldpoints).not.toHaveBeenCalled();
      expect(updateUserReward).not.toHaveBeenCalled();
      expect(createlessonquizprogress).not.toHaveBeenCalled();
    });

    it("rule off: the newest row is used, as before", async () => {
      orgSpy.mockResolvedValue({ settingsconfig: {} } as never);
      await submit(1);
      expect(getoldpoints).toHaveBeenCalledTimes(1);
      expect(getpassoldpoints).not.toHaveBeenCalled();
      expect(updateUserReward.mock.calls[0][2]).toBe(40);
      expect(updateUserReward.mock.calls[0][3]).toBe(0);
    });
  });
});
