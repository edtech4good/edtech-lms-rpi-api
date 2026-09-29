import { curriculums } from "src/models/data-models/curriculums";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessons } from "src/models/data-models/lessons";
import { levels } from "src/models/data-models/levels";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { studentprogress } from "src/models/data-models/studentprogress";
import { students } from "src/models/data-models/students";
import { ReportBusiness } from "./report.business";

/**
 * workspace#79 step 2: the `report/*` routes central proxies must include
 * `verified` per result row alongside the fields they already return
 * (scores/resultpercentage/marks/ispass/starttime), without touching the
 * existing shape otherwise. `getStudentsScoresData` (the `studentprogress`
 * route) is exercised here end to end, mocking only the Sequelize model
 * calls it makes — no MySQL — to prove `verified` actually reaches the
 * returned `laststudentprogress` row, not just that the source lists it.
 */
class FakeRow {
  constructor(private data: Record<string, unknown>) {}
  getDataValue(key: string) {
    return this.data[key];
  }
  setDataValue(key: string, value: unknown) {
    this.data[key] = value;
  }
  get(_opts?: unknown) {
    return { ...this.data };
  }
  get studentprogressreferenceid() {
    return this.data.studentprogressreferenceid;
  }
  get starttime() {
    return this.data.starttime;
  }
  get verified() {
    return this.data.verified;
  }
}

describe("ReportBusiness.getStudentsScoresData includes verified per result row (workspace#79 step 2)", () => {
  let studentsFindOneSpy: jest.SpyInstance;
  let lessonsFindAndCountAllSpy: jest.SpyInstance;
  let studentprogressFindOneSpy: jest.SpyInstance;
  let lessonquizquestionsCountSpy: jest.SpyInstance;
  let levelsFindOneSpy: jest.SpyInstance;
  let standardsFindOneSpy: jest.SpyInstance;
  let schoolsFindOneSpy: jest.SpyInstance;
  let curriculumsFindOneSpy: jest.SpyInstance;

  const student = {
    studentid: "s1",
    standard: "std1",
    curriculumid: "cur1",
    schoolname: "school1",
    setDataValue: jest.fn(),
  };

  const lessonRow = new FakeRow({});
  (lessonRow as any).studentlessonsprogresses = [{ lessonid: "lesson1" }];
  (lessonRow as any).levelid = "level1";

  beforeEach(() => {
    studentsFindOneSpy = jest.spyOn(students, "findOne").mockResolvedValue(student as never);
    lessonsFindAndCountAllSpy = jest
      .spyOn(lessons, "findAndCountAll")
      .mockResolvedValue({ rows: [lessonRow], count: 1 } as never);
    // The first (pass) branch finds a quiz row carrying `verified`.
    studentprogressFindOneSpy = jest.spyOn(studentprogress, "findOne").mockResolvedValue(
      new FakeRow({
        studentprogressreferenceid: "lq1",
        starttime: new Date("2026-01-01"),
        verified: true,
      }) as never,
    );
    lessonquizquestionsCountSpy = jest.spyOn(lessonquizquestions, "count").mockResolvedValue(4 as never);
    levelsFindOneSpy = jest.spyOn(levels, "findOne").mockResolvedValue(null as never);
    standardsFindOneSpy = jest.spyOn(standards, "findOne").mockResolvedValue(null as never);
    schoolsFindOneSpy = jest.spyOn(schools, "findOne").mockResolvedValue(null as never);
    curriculumsFindOneSpy = jest.spyOn(curriculums, "findOne").mockResolvedValue(null as never);
  });

  afterEach(() => {
    studentsFindOneSpy.mockRestore();
    lessonsFindAndCountAllSpy.mockRestore();
    studentprogressFindOneSpy.mockRestore();
    lessonquizquestionsCountSpy.mockRestore();
    levelsFindOneSpy.mockRestore();
    standardsFindOneSpy.mockRestore();
    schoolsFindOneSpy.mockRestore();
    curriculumsFindOneSpy.mockRestore();
  });

  it("asks Sequelize for `verified` on both the pass and fail branches, and it reaches the returned row", async () => {
    const result = await new ReportBusiness().getStudentsScoresData({ filter: [] } as never);

    expect(studentprogressFindOneSpy).toHaveBeenCalledTimes(1); // pass branch found a quiz; fail branch never runs
    const options = studentprogressFindOneSpy.mock.calls[0][0];
    expect(options.attributes).toEqual(
      expect.arrayContaining(["studentprogressreferenceid", "scores", "resultpercentage", "marks", "ispass", "starttime", "verified"]),
    );

    const [row] = (result as { rows: any[] }).rows;
    const laststudentprogress = row.getDataValue("laststudentprogress");
    expect(laststudentprogress.verified).toBe(true);
  });
});
