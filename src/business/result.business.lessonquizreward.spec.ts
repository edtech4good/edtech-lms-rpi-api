import { ResultBusiness } from "./result.business";
import { LessonBusiness } from "./lesson.business";
import { studentprogress, studentprogressquestions } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";

/**
 * createlessonquizprogress decides when a lesson quiz attempt moves the lesson's points, and by how much.
 * The models are an in-memory table (no database, no .env) and LessonBusiness is replaced by a recorder, so
 * what is pinned is the call to updateUserReward: its points, its old points, and whether it is made at all.
 */
jest.mock("./lesson.business");

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("createlessonquizprogress: when an attempt moves the lesson's points", () => {
  let rows: Row[];
  let reward: jest.Mock;
  const user = { studentid: "s1", studentfirstname: "សុភា" } as never;
  const lesson = { lessonid: "l1" };
  const t = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 8, minutes));

  beforeEach(() => {
    rows = [];
    reward = jest.fn().mockResolvedValue(undefined);
    const proto = (LessonBusiness as unknown as { prototype: Record<string, unknown> }).prototype;
    proto.updateUserReward = reward;
    proto.setstudentactive = jest.fn().mockResolvedValue(undefined);
    proto.addstudentscores = jest.fn().mockResolvedValue(undefined);
    proto.updateuserdailypoints = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(dbinstance, "getdbinstance").mockReturnValue({ transaction: async () => ({ commit: async () => undefined, rollback: async () => undefined }) } as never);
    jest.spyOn(studentprogressquestions, "create").mockResolvedValue({} as never);
    jest.spyOn(studentprogress, "findOne").mockImplementation((async (options: { where: Row; order?: [string, string][] }) => {
      const where = options.where;
      let found = rows.filter((r) => Object.keys(where).every((k) => k === "verified" || r[k] === where[k]));
      const order = options.order?.[0];
      if (order) {
        found = [...found].sort((a, b) => (a.starttime.getTime() - b.starttime.getTime()) * (order[1] === "DESC" ? -1 : 1));
      }
      return found[0] ?? null;
    }) as never);
    jest.spyOn(studentprogress, "findOrCreate").mockImplementation((async (options: { where: Row; defaults: Row }) => {
      const existing = rows.find((r) => r.studentid === options.where.studentid && r.studentprogressreferenceid === options.where.studentprogressreferenceid && r.starttime.getTime() === options.where.starttime.getTime());
      if (existing) return [existing, false];
      const row = { ...options.defaults };
      rows.push(row);
      return [row, true];
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const save = (minute: number, points: number, ispass: boolean, passrule: boolean, fullpoints = 60) =>
    new ResultBusiness().createlessonquizprogress(
      { studentid: "s1", starttime: t(minute), endtime: t(minute), ispass, passpercentage: ispass ? 100 : 50, actualanswers: "[]", studentprogressreferenceid: "quiz1", marks: 1, points, fullpoints, verified: false },
      lesson,
      user,
      passrule,
    );
  const rewardArgs = () => reward.mock.calls.map((c) => [c[2], c[3]]);

  it("the first attempt, a fail earning 0, reaches updateUserReward with 0 points and no old points", async () => {
    await save(1, 0, false, true);
    expect(rewardArgs()).toEqual([[0, null]]);
    expect(rows).toHaveLength(1);
  });

  it("a second fail earning 0 again moves nothing but is saved", async () => {
    await save(1, 0, false, true);
    await save(2, 0, false, true);
    expect(rewardArgs()).toEqual([[0, null]]);
    expect(rows).toHaveLength(2);
  });

  it("a pass after a fail that earned 0 gives the quiz's points (not the lesson's full points) over an old 0", async () => {
    await save(1, 0, false, true);
    await save(2, 40, true, true, 60);
    expect(rewardArgs()).toEqual([
      [0, null],
      [40, 0],
    ]);
  });

  it("a pass on the first attempt gives the quiz's points", async () => {
    await save(1, 40, true, true, 60);
    expect(rewardArgs()).toEqual([[40, null]]);
  });

  it("a fail after an earlier attempt that held 40 points takes the 40 back", async () => {
    await save(1, 40, false, false);
    await save(2, 0, false, true);
    expect(rewardArgs()).toEqual([
      [40, null],
      [0, 40],
    ]);
  });

  it("a replay of a saved attempt (same start time) moves nothing and adds no row", async () => {
    await save(1, 0, false, true);
    await save(1, 0, false, true);
    expect(rewardArgs()).toEqual([[0, null]]);
    expect(rows).toHaveLength(1);
  });

  it("rule on: a failed attempt dated before the newest stored attempt moves no points, and is saved", async () => {
    await save(10, 40, false, false);
    await save(5, 0, false, true);
    expect(rewardArgs()).toEqual([[40, null]]);
    expect(rows).toHaveLength(2);
  });

  it("rule on: a pass dated before a stored failed attempt is still credited", async () => {
    await save(10, 0, false, true);
    await save(5, 40, true, true);
    expect(rewardArgs()).toEqual([
      [0, null],
      [40, 0],
    ]);
  });

  it("rule off: a failed attempt dated before the newest stored one moves points exactly as before", async () => {
    await save(10, 40, false, false);
    await save(5, 30, false, false);
    expect(rewardArgs()).toEqual([
      [40, null],
      [30, 40],
    ]);
  });
});
