import { Logger } from "src/config";
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

  const award = (id: string, studentid: string, levelid: string, extra: Record<string, unknown> = {}) =>
    ({ studentawardid: id, studentid, levelid, gradeid: "g", curid: "c", earnedat: "2026-02-03T04:05:06.000Z", earnedat_approximate: false, lastupdated: new Date(), ...extra } as never);

  it("c. an imported award with no earnedat, an empty one or one that is not a date is not stored, only a count is logged, and the approximate pass is left to award that pair", async () => {
    const logged: string[] = [];
    jest.spyOn(Logger, "info").mockImplementation(((m: string) => void logged.push(String(m))) as never);
    let storedWhenApproximateRan: string[] = [];
    (levelAward.awardCompletedLevels as jest.Mock).mockImplementation(async (ids: string[] | null) => {
      calls.push("approximate");
      awardIds.push(ids ?? []);
      storedWhenApproximateRan = stored.map((r) => `${r.studentid}/${r.levelid}`);
      return 0;
    });
    await new StudentProgressBusiness().importStudentLevelsProgress([row("s1", "l1", true), row("s1", "l2", true), row("s1", "l3", true), row("s1", "l4", true), row("s1", "l5", true)], tx, [
      award("a1", "s1", "l1", { earnedat: undefined }),
      award("a2", "s1", "l2", { earnedat: "" }),
      award("a3", "s1", "l3", { earnedat: "not a date" }),
      award("a4", "s1", "l4", { earnedat: null }),
      award("a5", "s1", "l5"),
    ]);
    // only the usable row is stored, so the unique key does not stand in the approximate pass's way for the other pairs
    expect(stored.map((r) => r.studentawardid)).toEqual(["a5"]);
    expect(storedWhenApproximateRan).toEqual(["s1/l5"]);
    expect(awardIds).toEqual([["s1"]]);
    expect(calls).toEqual(["levels", "imported-awards", "approximate"]);
    expect(logged).toEqual(["import students: 4 award row(s) skipped (no valid earnedat)"]);
  });

  it("c. when no imported award is usable nothing is written for them, and the approximate pass still runs", async () => {
    jest.spyOn(Logger, "info").mockImplementation((() => undefined) as never);
    await new StudentProgressBusiness().importStudentLevelsProgress([row("s1", "l1", true)], tx, [award("a1", "s1", "l1", { earnedat: undefined })]);
    expect(calls).toEqual(["levels", "approximate"]);
    expect(awardIds).toEqual([["s1"]]);
  });

  it("earnedat_approximate is read as a boolean: missing is false, true and 1 are true, anything else is false", async () => {
    await new StudentProgressBusiness().importStudentLevelsProgress([], tx, [
      award("a1", "s1", "l1", { earnedat_approximate: undefined }),
      award("a2", "s1", "l2", { earnedat_approximate: true }),
      award("a3", "s1", "l3", { earnedat_approximate: 1 }),
      award("a4", "s1", "l4", { earnedat_approximate: "yes" }),
      award("a5", "s1", "l5", { earnedat_approximate: null }),
    ]);
    expect(stored.map((r) => [r.studentawardid, r.earnedat_approximate])).toEqual([["a1", false], ["a2", true], ["a3", true], ["a4", false], ["a5", false]]);
  });
});
