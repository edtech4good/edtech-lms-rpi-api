import { grades } from "src/models/data-models/grades";
import { lessons } from "src/models/data-models/lessons";
import { levels } from "src/models/data-models/levels";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { standards } from "src/models/data-models/standards";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentprogress } from "src/models/data-models/studentprogress";
import { students } from "src/models/data-models/students";
import { ReportBusiness } from "./report.business";

/**
 * workspace#79 step 2: the `report/*` routes central proxies must include
 * `verified` per result row alongside the fields they already return
 * (scores/resultpercentage/marks/ispass/starttime), without touching the
 * existing response shape otherwise.
 *
 * There are 8 call sites in report.business.ts: 4 methods
 * (getStudentsScoresData, getClassScoresData, getLevelQuizScoresData,
 * getClassLevelQuizScoresData), each doing TWO `studentprogress.findOne`
 * calls per row — a "pass" branch (order ASC, ispass:1) and, if that finds
 * nothing, a "fail" fallback (order DESC, ispass:0). All 8 must carry
 * `verified` in their `attributes` list.
 *
 * `studentprogress.findOne` is mocked to always resolve `null`, which makes
 * BOTH the pass and fail branches run for every row (the fail branch only
 * fires when the pass branch found nothing) without needing to fake a real
 * quiz row or the downstream `setDataValue`/count calls that only run when
 * a quiz is found — the two `findOne` calls' `attributes` options are all
 * this suite needs to inspect. Every other model call the method makes
 * along the way (students.findOne, the listing findAndCountAll, and the
 * per-row lookups gated by `if (x) ...`) is mocked to a minimal stand-in or
 * `null` so the method runs to completion — no MySQL involved.
 *
 * No MySQL/Docker involved anywhere in this suite — every Sequelize model
 * call is a mocked `jest.spyOn`, not a real query.
 */

const makeListingRow = (extra: Record<string, unknown>) => ({
  setDataValue: jest.fn(),
  getDataValue: jest.fn(),
  ...extra,
});

const student = {
  studentid: "s1",
  standard: "std1",
  // No curriculumid: keeps the "find a lesson/level to show" branch (gated
  // on `student?.curriculumid`) from firing in getClassScoresData /
  // getClassLevelQuizScoresData, so curriculums.findOne need not be mocked.
  curriculumid: undefined,
  schoolname: "school1",
  schooluserid: "su1",
  setDataValue: jest.fn(),
};

type MethodCase = {
  name: string;
  setup: () => void;
  invoke: () => Promise<unknown>;
};

const methodCases: MethodCase[] = [
  {
    name: "getStudentsScoresData",
    setup: () => {
      jest.spyOn(students, "findOne").mockResolvedValue(student as never);
      jest.spyOn(lessons, "findAndCountAll").mockResolvedValue(
        { rows: [makeListingRow({ studentlessonsprogresses: [{ lessonid: "lesson1" }], levelid: "level1" })], count: 1 } as never,
      );
      jest.spyOn(levels, "findOne").mockResolvedValue(null as never);
      jest.spyOn(standards, "findOne").mockResolvedValue(null as never);
      jest.spyOn(schools, "findOne").mockResolvedValue(null as never);
    },
    invoke: () => new ReportBusiness().getStudentsScoresData({ filter: [] } as never),
  },
  {
    name: "getClassScoresData",
    setup: () => {
      jest.spyOn(students, "findOne").mockResolvedValue(student as never);
      jest.spyOn(lessons, "findOne").mockResolvedValue(null as never);
      jest.spyOn(students, "findAndCountAll").mockResolvedValue(
        {
          rows: [
            makeListingRow({
              studentlessonsprogresses: [{ lessonid: "lesson1" }],
              studentid: "s1",
              schooluserid: "su1",
              schoolname: "school1",
              standard: "std1",
            }),
          ],
          count: 1,
        } as never,
      );
      jest.spyOn(standards, "findOne").mockResolvedValue(null as never);
      jest.spyOn(schools, "findOne").mockResolvedValue(null as never);
      jest.spyOn(schoolusers, "findOne").mockResolvedValue(null as never);
    },
    invoke: () => new ReportBusiness().getClassScoresData({ filter: [] } as never),
  },
  {
    name: "getLevelQuizScoresData",
    setup: () => {
      // The method (re-)declares these associations on every call; the
      // model classes here are never `initModel`-ed against a live
      // Sequelize instance in a unit test, so the real hasMany/belongsTo
      // would throw. No-op them — association wiring isn't what this
      // suite is about.
      jest.spyOn(levels, "hasMany").mockImplementation(() => undefined as never);
      jest.spyOn(studentprogress, "belongsTo").mockImplementation(() => undefined as never);
      jest.spyOn(studentlevelsprogress, "belongsTo").mockImplementation(() => undefined as never);
      jest.spyOn(students, "findOne").mockResolvedValue(student as never);
      jest.spyOn(levels, "findAndCountAll").mockResolvedValue(
        { rows: [makeListingRow({ studentlevelsprogresses: [{ levelid: "level1" }], gradeid: "grade1" })], count: 1 } as never,
      );
      jest.spyOn(grades, "findOne").mockResolvedValue(null as never);
      jest.spyOn(standards, "findOne").mockResolvedValue(null as never);
      jest.spyOn(schools, "findOne").mockResolvedValue(null as never);
    },
    invoke: () => new ReportBusiness().getLevelQuizScoresData({ filter: [] } as never),
  },
  {
    name: "getClassLevelQuizScoresData",
    setup: () => {
      jest.spyOn(levels, "hasMany").mockImplementation(() => undefined as never);
      jest.spyOn(studentprogress, "belongsTo").mockImplementation(() => undefined as never);
      jest.spyOn(students, "findOne").mockResolvedValue(student as never);
      jest.spyOn(levels, "findOne").mockResolvedValue(null as never);
      jest.spyOn(students, "findAndCountAll").mockResolvedValue(
        {
          rows: [
            makeListingRow({
              studentlevelsprogresses: [{ levelid: "level1" }],
              studentid: "s1",
              schooluserid: "su1",
              schoolname: "school1",
              standard: "std1",
            }),
          ],
          count: 1,
        } as never,
      );
      jest.spyOn(standards, "findOne").mockResolvedValue(null as never);
      jest.spyOn(schools, "findOne").mockResolvedValue(null as never);
      jest.spyOn(schoolusers, "findOne").mockResolvedValue(null as never);
    },
    invoke: () => new ReportBusiness().getClassLevelQuizScoresData({ filter: [] } as never),
  },
];

describe("ReportBusiness includes verified in every studentprogress.findOne (workspace#79 step 2, all 8 call sites)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each(methodCases)(
    "$name: both the pass-branch and fail-branch findOne calls request verified",
    async ({ setup, invoke }) => {
      setup();
      const spqSpy = jest.spyOn(studentprogress, "findOne").mockResolvedValue(null as never);

      await invoke();

      // null on the pass branch is what makes the fail branch run too —
      // this is how a single test call exercises BOTH of a method's two
      // call sites in one go.
      expect(spqSpy).toHaveBeenCalledTimes(2);
      for (const call of spqSpy.mock.calls) {
        const options = call[0] as { attributes?: string[] };
        expect(options.attributes).toEqual(expect.arrayContaining(["verified"]));
      }
    },
  );
});
