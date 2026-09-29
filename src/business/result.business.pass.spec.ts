import { studentprogress } from "src/models/data-models/init-models";
import { ResultBusiness, countedpassclause } from "./result.business";

/**
 * Which past passes count. With GRADING_MODE=enforce and
 * REQUIRE_GRADED_ANSWERS on, only a server-verified pass (verified = 1)
 * counts; in every other combination any ispass = 1 row counts, exactly as
 * before. Practice is never gated. Every site that consults a past pass is
 * covered: ispass() (the sticky check) and the three points updaters.
 */
const MODES = [
  { mode: "shadow", require: "", gated: false },
  { mode: "shadow", require: "true", gated: false },
  { mode: "enforce", require: "", gated: false },
  { mode: "enforce", require: "true", gated: true },
] as const;

const setEnv = (mode: string, req: string) => {
  process.env.GRADING_MODE = mode;
  if (req) process.env.REQUIRE_GRADED_ANSWERS = req;
  else delete process.env.REQUIRE_GRADED_ANSWERS;
};

describe("which past passes count", () => {
  const saved = { m: process.env.GRADING_MODE, r: process.env.REQUIRE_GRADED_ANSWERS };
  let countSpy: jest.SpyInstance;
  let findOneSpy: jest.SpyInstance;

  beforeEach(() => {
    countSpy = jest.spyOn(studentprogress, "count").mockResolvedValue(0 as never);
    findOneSpy = jest.spyOn(studentprogress, "findOne").mockResolvedValue(null as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (saved.m === undefined) delete process.env.GRADING_MODE; else process.env.GRADING_MODE = saved.m;
    if (saved.r === undefined) delete process.env.REQUIRE_GRADED_ANSWERS; else process.env.REQUIRE_GRADED_ANSWERS = saved.r;
  });

  const lesson = { getLesson: jest.fn().mockResolvedValue({}), lessonquizid: "q", lessonpracticeid: "p", points: 1 } as any;
  const user = { studentid: "s1" } as any;
  const tx = {} as any;

  describe.each(MODES)("GRADING_MODE=$mode REQUIRE_GRADED_ANSWERS=$require", ({ mode, require, gated }) => {
    beforeEach(() => setEnv(mode, require));
    const expectedWhere = (extra: object) =>
      expect.objectContaining(gated ? { ...extra, verified: true } : extra);

    it("countedpassclause is the only rule: verified only under enforce+REQUIRE", () => {
      expect(countedpassclause()).toEqual(gated ? { verified: true } : {});
    });

    it("ispass() (sticky check, quizzes and level quizzes)", async () => {
      await new ResultBusiness().ispass("s1", "ref");
      const where = countSpy.mock.calls[0][0].where;
      expect(where).toEqual(expectedWhere({ studentid: "s1", studentprogressreferenceid: "ref", ispass: true }));
      expect("verified" in where).toBe(gated);
    });

    it("ispass(..., false) (practice) is never gated", async () => {
      await new ResultBusiness().ispass("s1", "ref", false);
      const where = countSpy.mock.calls[0][0].where;
      expect("verified" in where).toBe(false);
    });

    it("updateQuizPoints", async () => {
      await new ResultBusiness().updateQuizPoints(lesson, user, tx);
      const where = findOneSpy.mock.calls[0][0].where;
      expect(where).toEqual(expectedWhere({ studentid: "s1", ispass: 1 }));
      expect("verified" in where).toBe(gated);
    });

    it("updateLevelQuizPoints", async () => {
      await new ResultBusiness().updateLevelQuizPoints({ levelid: "l1", points: 1 } as any, user, tx);
      const where = findOneSpy.mock.calls[0][0].where;
      expect(where).toEqual(expectedWhere({ studentid: "s1", studentprogressreferenceid: "l1", ispass: 1 }));
      expect("verified" in where).toBe(gated);
    });

    it("updatePracticePoints is never gated", async () => {
      await new ResultBusiness().updatePracticePoints(lesson, user, tx);
      expect("verified" in findOneSpy.mock.calls[0][0].where).toBe(false);
    });
  });
});
