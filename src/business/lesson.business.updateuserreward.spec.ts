import { LessonBusiness } from "./lesson.business";
import { grades, lessons, studentgradesprogress, studentlessonsprogress, studentlevelsprogress } from "src/models/data-models/init-models";

/**
 * updateUserReward adds a delta to the lesson, level and grade totals. In-memory tables, no database and no
 * .env: what is pinned is how `points` and `oldpoints` combine, with an old value of 0 distinct from none.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("updateUserReward: the delta reaches the lesson, level and grade", () => {
  let lessonrow: Row | null;
  let levelrow: Row | null;
  let graderow: Row | null;
  const user = { studentid: "s1" } as never;
  const when = new Date(Date.UTC(2026, 10, 1));

  const store = (model: unknown, get: () => Row | null, set: (r: Row) => void) => {
    jest.spyOn(model as typeof studentlessonsprogress, "findOne").mockImplementation((async () => get()) as never);
    jest.spyOn(model as typeof studentlessonsprogress, "create").mockImplementation((async (values: Row) => {
      const row = { ...values, save: async () => undefined };
      set(row);
      return row;
    }) as never);
  };

  beforeEach(() => {
    lessonrow = null;
    levelrow = null;
    graderow = null;
    jest.spyOn(lessons, "findOne").mockResolvedValue({ lessonid: "l1", total_points: 60, passing_points: 60, level: { levelid: "lv1", gradeid: "g1", points: 100 } } as never);
    jest.spyOn(grades, "findOne").mockResolvedValue({ gradeid: "g1", curriculumid: "c1", points: 100 } as never);
    store(studentlessonsprogress, () => lessonrow, (r) => (lessonrow = r));
    store(studentlevelsprogress, () => levelrow, (r) => (levelrow = r));
    store(studentgradesprogress, () => graderow, (r) => (graderow = r));
  });
  afterEach(() => jest.restoreAllMocks());

  const reward = (points: number, oldpoints: number | null) => new LessonBusiness().updateUserReward(user, "l1", points, oldpoints, {} as never, when);
  const totals = () => [lessonrow?.points, levelrow?.points, graderow?.points];

  it("a first reward creates the lesson, level and grade rows with the points", async () => {
    await reward(20, null);
    expect(totals()).toEqual([20, 20, 20]);
  });

  it("an old value of 0 is a real old value: 40 over 0 adds 40", async () => {
    await reward(20, null);
    await reward(40, 0);
    expect(totals()).toEqual([60, 60, 60]);
    expect(lessonrow?.completed).toBe(true);
  });

  it("no old value adds the whole amount", async () => {
    await reward(20, null);
    await reward(40, null);
    expect(totals()).toEqual([60, 60, 60]);
  });

  it("taking back an earlier 40 with 0 removes the 40 from all three, never below 0", async () => {
    await reward(40, null);
    await reward(0, 40);
    expect(totals()).toEqual([0, 0, 0]);
    expect(lessonrow?.completed).toBe(false);
  });

  it("a delta of 0 over an old 0 changes nothing", async () => {
    await reward(20, null);
    await reward(0, 0);
    expect(totals()).toEqual([20, 20, 20]);
  });
});
