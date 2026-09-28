/**
 * GradeBusiness.getusergradesprogess used to fetch grades with a
 * `studentgradesprogresses` include AND a `levels` include used only for
 * `COUNT(levels.levelid)`, grouped by `grades.gradeid`. Under
 * ONLY_FULL_GROUP_BY (the default sql_mode on MySQL 8 in local dev, UAT and
 * prod) that GROUP BY failed: the studentgradesprogresses include
 * auto-selects its primary key (studentgradesprogresses.studentgradeprogressid),
 * which is not functionally dependent on grades.gradeid, so it had to
 * appear in the GROUP BY too.
 *
 * The fix drops the `group`/aggregate from the grades query entirely and
 * computes number_levels with a separate, plain `COUNT ... GROUP BY gradeid`
 * query over `levels` (no other model's columns involved, so no
 * ONLY_FULL_GROUP_BY conflict). This spec proves that shape without a DB, in
 * the style of search-filter-sqli.spec.ts / curriculumbaseline.business.spec.ts:
 * models are initialized against the lazy `dbinstance.getdbinstance()`
 * Sequelize instance (which never actually connects unless queried), and
 * `findAll` is mocked so no query ever reaches a database.
 */
import { dbinstance } from "src/services/dbservice";
import { initModels } from "src/models/data-models/init-models";
import { grades } from "src/models/data-models/grades";
import { levels } from "src/models/data-models/levels";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { GradeBusiness } from "./grade.business";

initModels(dbinstance.getdbinstance());

describe("GradeBusiness.getusergradesprogess GROUP BY fix", () => {
  const user: any = { studentid: "student-1" };
  const curriculumid = "cur-1";

  it("does not GROUP BY grades and computes number_levels from a separate grouped levels query, including 0 for a grade with no active levels", async () => {
    const gradeA = grades.build({
      gradeid: "grade-A",
      curriculumid,
      gradestatus: true,
      gradename: "Grade A",
      gradeorder: 2,
      isdeleted: false,
    } as any);
    (gradeA as any).studentgradesprogresses = [{ points: 10, completed: false, scores: 5 }];

    const gradeB = grades.build({
      gradeid: "grade-B",
      curriculumid,
      gradestatus: true,
      gradename: "Grade B",
      gradeorder: 1,
      isdeleted: false,
    } as any);
    (gradeB as any).studentgradesprogresses = [];

    const findAllSpy = jest.spyOn(grades, "findAll").mockResolvedValue([gradeB, gradeA] as never);

    const levelsFindAllSpy = jest
      .spyOn(levels, "findAll")
      .mockImplementationOnce(async (options: any) => {
        // First call: the level-count aggregate query.
        expect(options.group).toEqual(["gradeid"]);
        expect(options.raw).toBe(true);
        expect(options.where).toMatchObject({ levelstatus: true, isdeleted: false });
        // Only grade-A has active levels; grade-B has none and must still
        // come out as 0, not undefined/missing.
        return [{ gradeid: "grade-A", number_levels: "3" }] as never;
      })
      .mockImplementationOnce(async () => {
        // Second call: the unrelated levelsprogresses/completed-levels query.
        return [] as never;
      });

    const result = await new GradeBusiness().getusergradesprogess(curriculumid, user);

    // The grades query itself must carry no group/aggregate, and must ask
    // the DB to sort by gradeorder ascending (the mock above returns rows
    // already in that order, since a mocked findAll -- unlike a real one --
    // does not apply `order` itself).
    const gradesOptions: any = findAllSpy.mock.calls[0][0];
    expect(gradesOptions.group).toBeUndefined();
    expect(JSON.stringify(gradesOptions.attributes)).not.toMatch(/COUNT/i);
    expect(gradesOptions.include).toHaveLength(1);
    expect(gradesOptions.include[0].model).toBe(studentgradesprogress);
    expect(gradesOptions.order).toEqual([["gradeorder", "ASC"]]);

    expect(levelsFindAllSpy).toHaveBeenCalledTimes(2);

    expect(result.gradesresult.map((g: any) => g.gradeid)).toEqual(["grade-B", "grade-A"]);

    const resultA: any = result.gradesresult.find((g: any) => g.gradeid === "grade-A");
    const resultB: any = result.gradesresult.find((g: any) => g.gradeid === "grade-B");
    expect(resultA).toBeDefined();
    expect(resultB).toBeDefined();
    expect(resultA.getDataValue("number_levels")).toBe(3);
    expect(resultB.getDataValue("number_levels")).toBe(0);

    expect(result.total_points).toBe(5);

    findAllSpy.mockRestore();
    levelsFindAllSpy.mockRestore();
  });
});
