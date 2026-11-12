import { Op } from "sequelize";
import { schools } from "src/models/data-models/school";
import { LessonBusiness } from "./lesson.business";
import { awardLevelIfCompleted, awardsOfStudent } from "./level-award";
import {
  curriculums,
  grades,
  lessons,
  levels,
  studentawards,
  studentgradesprogress,
  studentlessonsprogress,
  studentlevelsprogress,
} from "src/models/data-models/init-models";

/**
 * A learner's award for completing a level, made by updateUserReward and updateLevelQuizReward through one helper.
 * In-memory tables, no database and no .env. The awards table behaves like the real one on the points that matter:
 * a duplicate (studentid, levelid) is an error unless the insert says it ignores duplicates, so a helper that does not
 * ignore one fails here as it would in MySQL. `levels.count` and `levels.findAll` apply the where they are given.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("level awards", () => {
  let lessonrow: Row | null;
  let levelrow: Row | null;
  let graderow: Row | null;
  let awards: Row[];
  let contentlevels: Row[];
  let branding: unknown;
  const user = { studentid: "s1", schoolid: "sch1" } as never;
  const day = (d: number) => new Date(Date.UTC(2026, 10, d));
  const tx = {} as never;

  const store = (model: unknown, get: () => Row | null, set: (r: Row) => void) => {
    jest.spyOn(model as typeof studentlessonsprogress, "findOne").mockImplementation((async () => get()) as never);
    jest.spyOn(model as typeof studentlessonsprogress, "create").mockImplementation((async (values: Row) => {
      const row = { ...values, save: async () => undefined };
      set(row);
      return row;
    }) as never);
  };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && (v as Row)[Op.in as never] ? (v as Row)[Op.in as never].includes(row[k]) : row[k] === v));

  beforeEach(() => {
    lessonrow = null;
    levelrow = null;
    graderow = null;
    awards = [];
    branding = null;
    contentlevels = [
      { levelid: "lv1", gradeid: "g1", levelname: "Level one", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "lv2", gradeid: "g1", levelname: "Level two", levelorder: 2, levelstatus: true, isdeleted: false },
    ];
    jest.spyOn(lessons, "findOne").mockResolvedValue({ lessonid: "l1", total_points: 100, passing_points: 100, level: { levelid: "lv1", gradeid: "g1", points: 100 } } as never);
    jest.spyOn(grades, "findOne").mockResolvedValue({ gradeid: "g1", curriculumid: "c1", points: 100 } as never);
    store(studentlessonsprogress, () => lessonrow, (r) => (lessonrow = r));
    store(studentlevelsprogress, () => levelrow, (r) => (levelrow = r));
    store(studentgradesprogress, () => graderow, (r) => (graderow = r));
    jest.spyOn(schools, "findOne").mockImplementation((async () => ({ schoolid: "sch1", brandingconfig: branding })) as never);
    jest.spyOn(levels, "count").mockImplementation((async (options: { where: Row }) => contentlevels.filter((l) => matches(l, options.where)).length) as never);
    jest.spyOn(levels, "findAll").mockImplementation((async (options: { where: Row }) => contentlevels.filter((l) => matches(l, options.where))) as never);
    jest.spyOn(grades, "findAll").mockResolvedValue([{ gradeid: "g1", gradename: "Grade one" }] as never);
    jest.spyOn(curriculums, "findAll").mockResolvedValue([{ curriculumid: "c1", curriculumname: "Curriculum one" }] as never);
    jest.spyOn(studentawards, "findOne").mockImplementation((async (options: { where: Row }) => awards.find((a) => matches(a, options.where)) ?? null) as never);
    jest.spyOn(studentawards, "findAll").mockImplementation((async (options: { where: Row }) => awards.filter((a) => matches(a, options.where))) as never);
    jest.spyOn(studentawards, "bulkCreate").mockImplementation((async (rows: Row[], options: { ignoreDuplicates?: boolean }) => {
      for (const row of rows) {
        const clash = awards.some((a) => a.studentid === row.studentid && a.levelid === row.levelid);
        if (clash && !options?.ignoreDuplicates) {
          throw new Error("Duplicate entry for key uq_studentawards_student_level");
        }
        if (!clash) {
          awards.push({ ...row, earnedat_approximate: row.earnedat_approximate ?? false });
        }
      }
      return rows;
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const reward = (points: number, oldpoints: number | null, date: Date) => new LessonBusiness().updateUserReward(user, "l1", points, oldpoints, tx, date);
  const quiz = (oldpoints: number | null, date: Date) =>
    new LessonBusiness().updateLevelQuizReward(user, { levelid: "lv1", gradeid: "g1", points: 100, quiz_points: 90 } as never, oldpoints, tx, date);
  const awarded = () => awards.map((a) => [a.studentid, a.levelid, a.gradeid, a.curid, a.earnedat.getTime(), a.earnedat_approximate]);

  it("1. a result that takes the level from below 80% to 80% or more creates one award, dated by that result", async () => {
    await reward(50, null, day(1));
    expect(awards).toEqual([]);
    await reward(40, null, day(2));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(2).getTime(), false]]);
  });

  it("1b. a first result that completes the level at once creates the award", async () => {
    await reward(85, null, day(3));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
  });

  it("2. a further result on a completed level creates no second award and does not touch the first", async () => {
    await reward(85, null, day(3));
    await reward(10, null, day(4));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
  });

  it("3. points that take the level back under 80% leave the award in place, and completing it again adds none", async () => {
    await reward(85, null, day(3));
    await reward(0, 85, day(4));
    expect(levelrow?.completed).toBe(false);
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
    await reward(90, null, day(5));
    expect(levelrow?.completed).toBe(true);
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
  });

  it("4. a result that leaves the level under 80% creates no award", async () => {
    await reward(79, null, day(3));
    expect(levelrow?.completed).toBe(false);
    expect(awards).toEqual([]);
  });

  it("5. the level quiz completing the level creates the award, dated by that result", async () => {
    await quiz(null, day(6));
    expect(levelrow?.completed).toBe(true);
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(6).getTime(), false]]);
  });

  it("5b. the level quiz on a level that was already completed creates no second award", async () => {
    await reward(85, null, day(3));
    await quiz(null, day(6));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
  });

  describe("6. a grade with a single live level, in a school that hides single-item tiers, gives no award", () => {
    it("switch on, one live level: none", async () => {
      branding = { hideSingleItemTiers: true };
      contentlevels = [contentlevels[0]];
      await reward(85, null, day(3));
      expect(levelrow?.completed).toBe(true);
      expect(awards).toEqual([]);
    });
    it("switch on, two live levels: an award", async () => {
      branding = { hideSingleItemTiers: true };
      await reward(85, null, day(3));
      expect(awards).toHaveLength(1);
    });
    it("switch off (or never set), one live level: an award", async () => {
      branding = { hideSingleItemTiers: false };
      contentlevels = [contentlevels[0]];
      await reward(85, null, day(3));
      expect(awards).toHaveLength(1);
    });
    it("switch on, one live level and one deleted: none", async () => {
      branding = { hideSingleItemTiers: true };
      contentlevels[1].isdeleted = true;
      await reward(85, null, day(3));
      expect(awards).toEqual([]);
    });
    it("switch on, one live level and one switched off (levelstatus false): none", async () => {
      branding = { hideSingleItemTiers: true };
      contentlevels[1].levelstatus = false;
      await reward(85, null, day(3));
      expect(awards).toEqual([]);
    });
    it("the level quiz path applies the same rule", async () => {
      branding = { hideSingleItemTiers: true };
      contentlevels = [contentlevels[0]];
      await quiz(null, day(6));
      expect(awards).toEqual([]);
    });
  });

  it("7. an offline-queued result submitted later with an older date gives the older date", async () => {
    await reward(85, null, day(2));
    expect(awards).toHaveLength(1);
    awards = [];
    levelrow = null;
    lessonrow = null;
    graderow = null;
    await reward(85, null, day(1)); // a result flushed after the one above, carrying its original, earlier date
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(1).getTime(), false]]);
  });

  it("8. a duplicate for the same learner and level leaves one row and does not throw", async () => {
    const input = { user, levelid: "lv1", gradeid: "g1", curid: "c1", wasCompleted: false, isCompleted: true, currentdate: day(3) };
    await awardLevelIfCompleted(input, tx);
    await expect(awardLevelIfCompleted({ ...input, currentdate: day(9) }, tx)).resolves.toBeUndefined();
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
  });

  it("an award needs a learner and a level that is complete after the write", async () => {
    const input = { user, levelid: "lv1", gradeid: "g1", curid: "c1", wasCompleted: false, isCompleted: true, currentdate: day(3) };
    await awardLevelIfCompleted({ ...input, isCompleted: false }, tx);
    await awardLevelIfCompleted({ ...input, wasCompleted: true, isCompleted: false }, tx);
    await awardLevelIfCompleted({ ...input, user: {} as never }, tx);
    expect(awards).toEqual([]);
  });

  it("a. lessons take the level to 50%, then the level quiz takes it past 80% (update path): one award dated by the quiz, not approximate", async () => {
    await reward(50, null, day(1));
    expect(levelrow?.completed).toBe(false);
    await quiz(null, day(6));
    expect(levelrow?.completed).toBe(true);
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(6).getTime(), false]]);
  });

  it("b. a progress row exists and a lesson result crosses 80% (update path of updateUserReward): one award dated by it", async () => {
    await reward(70, null, day(1));
    await reward(15, null, day(2));
    expect(levelrow?.completed).toBe(true);
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(2).getTime(), false]]);
  });

  it("c. a level already complete with no award gets one on the next result: dated by that result, approximate", async () => {
    levelrow = { studentid: "s1", levelid: "lv1", points: 90, progress: 90, completed: true, save: async () => undefined };
    await reward(1, null, day(7));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(7).getTime(), true]]);
    awards = [];
    levelrow = { studentid: "s1", levelid: "lv1", points: 90, progress: 90, completed: true, save: async () => undefined };
    await quiz(null, day(8));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(8).getTime(), true]]);
  });

  it("d. a level complete with an award: further results add no row, keep the date, and run neither the school nor the level-count lookup", async () => {
    await reward(85, null, day(3));
    const schoolLookups = jest.spyOn(schools, "findOne");
    const levelCounts = jest.spyOn(levels, "count");
    schoolLookups.mockClear();
    levelCounts.mockClear();
    await reward(5, null, day(4));
    await quiz(null, day(5));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(3).getTime(), false]]);
    expect(schoolLookups).not.toHaveBeenCalled();
    expect(levelCounts).not.toHaveBeenCalled();
  });

  it("e. hidden at completion gives none; with the switch turned off, the next result gives an approximate award", async () => {
    branding = { hideSingleItemTiers: true };
    contentlevels = [contentlevels[0]];
    await reward(85, null, day(3));
    expect(awards).toEqual([]);
    branding = { hideSingleItemTiers: false };
    await reward(5, null, day(4));
    expect(awarded()).toEqual([["s1", "lv1", "g1", "c1", day(4).getTime(), true]]);
  });

  describe("9. awardsOfStudent: one learner's awards, newest first, with names from the content tables", () => {
    beforeEach(() => {
      awards = [
        { studentawardid: "a1", studentid: "s1", levelid: "lv1", gradeid: "g1", curid: "c1", earnedat: day(1), earnedat_approximate: false },
        { studentawardid: "a2", studentid: "s1", levelid: "lv2", gradeid: "g1", curid: "c1", earnedat: day(5), earnedat_approximate: true },
        { studentawardid: "a3", studentid: "s2", levelid: "lv1", gradeid: "g1", curid: "c1", earnedat: day(9), earnedat_approximate: false },
      ];
    });
    it("returns only the named learner's awards, newest first, with the fields of the endpoint", async () => {
      expect(await awardsOfStudent("s1")).toEqual([
        { studentawardid: "a2", levelid: "lv2", levelname: "Level two", levelorder: 2, gradeid: "g1", gradename: "Grade one", curid: "c1", curriculumname: "Curriculum one", earnedat: day(5), earnedat_approximate: true },
        { studentawardid: "a1", levelid: "lv1", levelname: "Level one", levelorder: 1, gradeid: "g1", gradename: "Grade one", curid: "c1", curriculumname: "Curriculum one", earnedat: day(1), earnedat_approximate: false },
      ]);
      expect((await awardsOfStudent("s2")).map((a) => a.studentawardid)).toEqual(["a3"]);
      expect(await awardsOfStudent("nobody")).toEqual([]);
    });
    it("an award whose level was deleted, or switched off, is still returned with the level's name", async () => {
      contentlevels[1].isdeleted = true;
      contentlevels[0].levelstatus = false;
      const rows = await awardsOfStudent("s1");
      expect(rows.map((a) => [a.studentawardid, a.levelname])).toEqual([["a2", "Level two"], ["a1", "Level one"]]);
    });
  });
});
