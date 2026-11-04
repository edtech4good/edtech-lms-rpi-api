import { ResultBusiness } from "./result.business";
import { studentprogress } from "src/models/data-models/init-models";

/**
 * getpassoldpoints is the credit an already-passed quiz holds when the setting is on: the points of the
 * earliest COUNTED pass row, or null when they equal the quiz's current points. The real method runs here
 * against an in-memory table (no database, no .env) that honours every key of the `where` it is given,
 * including `verified`, which the counted-pass clause adds when server grading is enforced and required.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("getpassoldpoints reads the counted pass row, not any row and not the newest", () => {
  let rows: Row[];
  const saved = { mode: process.env.GRADING_MODE, require: process.env.REQUIRE_GRADED_ANSWERS };
  const t = (minute: number) => new Date(Date.UTC(2026, 10, 1, 8, minute));
  const row = (minute: number, points: number, ispass: boolean, verified = false, studentid = "s1"): Row => ({
    studentid,
    studentprogressreferenceid: "quiz1",
    starttime: t(minute),
    points,
    ispass,
    verified,
  });
  const old = (newpoints = 40) => new ResultBusiness().getpassoldpoints("s1", "quiz1", newpoints);

  beforeEach(() => {
    rows = [];
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
    jest.spyOn(studentprogress, "findOne").mockImplementation((async (options: { where: Row; order?: [string, string][] }) => {
      let found = rows.filter((r) => Object.entries(options.where).every(([key, value]) => r[key] === value));
      const order = options.order?.[0];
      if (order) {
        found = [...found].sort((a, b) => (a.starttime.getTime() - b.starttime.getTime()) * (order[1] === "DESC" ? -1 : 1));
      }
      return found[0] ?? null;
    }) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [key, value] of [["GRADING_MODE", saved.mode], ["REQUIRE_GRADED_ANSWERS", saved.require]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("an earlier failed attempt does not stand in for the pass row", async () => {
    rows = [row(1, 0, false), row(2, 40, true)];
    expect(await old()).toBeNull();
  });

  it("a later failed attempt does not stand in for the pass row", async () => {
    rows = [row(1, 40, true), row(2, 0, false)];
    expect(await old()).toBeNull();
  });

  it("answers the pass row's points when they differ from the quiz's points", async () => {
    rows = [row(1, 0, false), row(2, 25, true)];
    expect(await old(40)).toBe(25);
  });

  it("answers null when there is no pass row at all", async () => {
    rows = [row(1, 0, false), row(2, 15, false)];
    expect(await old()).toBeNull();
  });

  it("with more than one counted pass row, the earliest one is the credit", async () => {
    rows = [row(1, 25, true), row(2, 40, true)];
    expect(await old(40)).toBe(25);
    rows = [row(1, 40, true), row(2, 25, true)];
    expect(await old(40)).toBeNull();
  });

  it("another learner's pass row is not used", async () => {
    rows = [row(1, 25, true, false, "s2")];
    expect(await old()).toBeNull();
  });

  describe("with server grading enforced and graded answers required", () => {
    beforeEach(() => {
      process.env.GRADING_MODE = "enforce";
      process.env.REQUIRE_GRADED_ANSWERS = "true";
    });

    it("an earlier unverified pass is not the credit: the verified pass row is", async () => {
      rows = [row(1, 10, true, false), row(2, 40, true, true)];
      expect(await old(40)).toBeNull();
    });

    it("with only an unverified pass there is no counted pass row", async () => {
      rows = [row(1, 10, true, false)];
      expect(await old(40)).toBeNull();
    });

    it("answers the verified pass row's points when they differ", async () => {
      rows = [row(1, 10, true, false), row(2, 25, true, true)];
      expect(await old(40)).toBe(25);
    });
  });
});
