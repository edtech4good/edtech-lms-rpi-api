import { studentawards } from "src/models/data-models/studentawards";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import * as levelAward from "./level-award";
import { StudentProgressBusiness } from "./studentprogress.business";

/**
 * The roster import (`PUT /import/students`) writes level progress, then awards. No database: the model writes are
 * recorded; the SQL that picks the levels to award runs on MySQL in src/db/20261111110100-backfill-level-awards.spec.ts.
 */
describe("importStudentLevelsProgress: awards for the learners imported", () => {
  const tx = {} as never;
  const calls: string[] = [];
  let awardIds: string[][];
  let stored: Array<Record<string, unknown>>;
  const row = (studentid: string, levelid: string, completed: boolean) => ({ studentlevelprogressid: studentid + levelid, studentid, levelid, gradeid: "g", curid: "c", completed } as never);

  beforeEach(() => {
    calls.length = 0;
    awardIds = [];
    stored = [];
    jest.spyOn(studentlevelsprogress, "bulkCreate").mockImplementation((async () => void calls.push("levels")) as never);
    jest.spyOn(studentawards, "bulkCreate").mockImplementation((async (rows: Array<Record<string, unknown>>, options: { ignoreDuplicates?: boolean }) => {
      calls.push("imported-awards");
      expect(options.ignoreDuplicates).toBe(true);
      stored.push(...rows);
      return rows;
    }) as never);
    jest.spyOn(levelAward, "awardCompletedLevels").mockImplementation((async (ids: string[] | null) => {
      calls.push("approximate");
      awardIds.push(ids ?? []);
      return 0;
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("f. makes approximate awards for the imported learners that have a complete row, after the progress is written, and no one else", async () => {
    await new StudentProgressBusiness().importStudentLevelsProgress([row("s1", "l1", true), row("s1", "l2", false), row("s2", "l1", false), row("s3", "l1", true)], tx);
    expect(calls).toEqual(["levels", "approximate"]);
    expect(awardIds).toEqual([["s1", "s3"]]);
  });

  it("f. stores an imported studentawards array (ignoring a pair this server already has) before the approximate ones", async () => {
    const earned = new Date("2026-02-03T04:05:06Z");
    await new StudentProgressBusiness().importStudentLevelsProgress([row("s1", "l1", true)], tx, [
      { studentawardid: "a1", studentid: "s1", levelid: "l1", gradeid: "g", curid: "c", earnedat: earned, earnedat_approximate: false, lastupdated: new Date() },
    ]);
    expect(calls).toEqual(["levels", "imported-awards", "approximate"]);
    expect(stored).toEqual([{ studentawardid: "a1", studentid: "s1", levelid: "l1", gradeid: "g", curid: "c", earnedat: earned, earnedat_approximate: false }]);
  });

  it("f. with no studentawards key, nothing is imported as an award", async () => {
    await new StudentProgressBusiness().importStudentLevelsProgress([row("s1", "l1", false)], tx);
    await new StudentProgressBusiness().importStudentLevelsProgress([row("s1", "l1", false)], tx, []);
    expect(calls).toEqual(["levels", "approximate", "levels", "approximate"]);
    expect(awardIds).toEqual([[], []]);
  });
});
