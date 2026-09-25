import { QueryTypes } from "sequelize";
import { dbinstance } from "src/services/dbservice";
import { CurriculumBaseLineBusiness } from "./curriculumbaseline.business";

/**
 * Guards #16's "defense-in-depth" half: getStudentBaselineProgress is dead
 * code today (no live caller), but #16 parameterized it anyway since a
 * future caller wouldn't know that. Same shape as the student.business.ts
 * stats queries: both studentid and the baseline curriculum id must be
 * bind replacements, never concatenated into the SQL string.
 */
const HOSTILE = "1 OR 1=1; --";

describe("CurriculumBaseLineBusiness.getStudentBaselineProgress SQL parameterization (#16)", () => {
  it("binds studentid and baselinecurriculumid as replacements, not string concatenation", async () => {
    const querySpy = jest
      .spyOn(dbinstance.getdbinstance(), "query")
      .mockResolvedValue([] as never);

    try {
      await new CurriculumBaseLineBusiness().getStudentBaselineProgress(HOSTILE, HOSTILE);

      expect(querySpy).toHaveBeenCalledTimes(1);
      const call: any = querySpy.mock.calls[0];
      const [sql, options] = call;

      expect(sql).not.toContain(HOSTILE);
      expect(options.type).toBe(QueryTypes.SELECT);
      expect(options.replacements).toEqual([HOSTILE, HOSTILE]);
    } finally {
      querySpy.mockRestore();
    }
  });
});
