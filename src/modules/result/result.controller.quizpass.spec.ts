import { ResultBusiness } from "src/business/result.business";
import { LessonBusiness } from "src/business/lesson.business";
import { organisations, lessonquizquestions } from "src/models/data-models/init-models";
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
});
