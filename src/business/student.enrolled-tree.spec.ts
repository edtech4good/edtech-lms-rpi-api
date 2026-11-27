/**
 * `StudentBusiness.getenrolledtree` (the awards and certificates overviews) and `loadProgressContent` ("My progress" and the admin
 * learner-progress report) select the active grades and levels of the enrolled curricula with two separate copies of the same
 * queries. This spec pins that they answer the same lists, in the same order, so they cannot drift apart unnoticed.
 *
 * The in-memory `findAll`s apply the `where` and the `order` the code passes (ties included), over rows stored in a scrambled
 * order. Nothing here ran on MySQL.
 */
import { grades } from "src/models/data-models/grades";
import { lessons } from "src/models/data-models/lessons";
import { levels } from "src/models/data-models/levels";
import { loadProgressContent, StudentBusiness } from "./student.business";

const mockEnrolled = jest.fn();
jest.mock("./curriculum.business", () => ({
  CurriculumBusiness: jest.fn().mockImplementation(() => ({ getEnrolledCurriculums: mockEnrolled })),
}));

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const gradeRows: Row[] = [
  { gradeid: "g-4", curriculumid: "cur-b", gradename: "Beta", gradeorder: 1, gradestatus: true, isdeleted: false },
  { gradeid: "g-2", curriculumid: "cur-a", gradename: "Same order, name Z", gradeorder: 2, gradestatus: true, isdeleted: false },
  { gradeid: "g-1", curriculumid: "cur-a", gradename: "First", gradeorder: 1, gradestatus: true, isdeleted: false },
  { gradeid: "g-3", curriculumid: "cur-a", gradename: "Same order, name A", gradeorder: 2, gradestatus: true, isdeleted: false },
  { gradeid: "g-off", curriculumid: "cur-a", gradename: "Off", gradeorder: 3, gradestatus: false, isdeleted: false },
  { gradeid: "g-del", curriculumid: "cur-a", gradename: "Deleted", gradeorder: 3, gradestatus: true, isdeleted: true },
  { gradeid: "g-x", curriculumid: "cur-other", gradename: "Not enrolled", gradeorder: 1, gradestatus: true, isdeleted: false },
];
const levelRows: Row[] = [
  { levelid: "l-3", gradeid: "g-1", levelname: "Level B", levelorder: 2, levelstatus: true, isdeleted: false },
  { levelid: "l-1", gradeid: "g-1", levelname: "Level A", levelorder: 1, levelstatus: true, isdeleted: false },
  { levelid: "l-2", gradeid: "g-1", levelname: "Level A2", levelorder: 1, levelstatus: true, isdeleted: false },
  { levelid: "l-4", gradeid: "g-4", levelname: "Other", levelorder: 1, levelstatus: true, isdeleted: false },
  { levelid: "l-off", gradeid: "g-1", levelname: "Off", levelorder: 3, levelstatus: false, isdeleted: false },
];

const inWhere = (row: Row, where: Row): boolean => Object.entries(where).every(([k, c]) => (Array.isArray(c) ? c.includes(row[k]) : row[k] === c));
const findAllOf = (table: Row[]) => async (options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows = table.filter((r) => inWhere(r, options.where));
  const order: Array<[string, string]> = options.order ?? [];
  return rows.sort((a, b) => {
    for (const [col, dir] of order) {
      const x = a[col];
      const y = b[col];
      if (x !== y) return (x < y ? -1 : 1) * (dir === "DESC" ? -1 : 1);
    }
    return 0;
  });
};

const idsOf = (rows: Array<{ get?: unknown } & Row>, key: string) => rows.map((r) => r[key]);

describe("getenrolledtree and loadProgressContent select the same grades and levels", () => {
  const enrolled = [{ curriculumid: "cur-a", curriculumname: "Programme A" }, { curriculumid: "cur-b", curriculumname: "Programme B" }];
  let gradeOrder: Row[];

  beforeEach(() => {
    gradeOrder = gradeRows;
    mockEnrolled.mockResolvedValue(enrolled);
    jest.spyOn(grades, "findAll").mockImplementation(((options: unknown) => findAllOf(gradeOrder.map((r) => ({ ...r })))(options)) as never);
    jest.spyOn(levels, "findAll").mockImplementation(findAllOf(levelRows.map((r) => ({ ...r }))) as never);
    jest.spyOn(lessons, "findAll").mockResolvedValue([] as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const treeOfAwards = () => (new StudentBusiness() as any).getenrolledtree({ studentid: "st-1" }); // eslint-disable-line @typescript-eslint/no-explicit-any

  it("the same active grades and levels, in the same order, for the same curricula", async () => {
    const tree = await treeOfAwards();
    const content = await loadProgressContent(enrolled);
    // the expected order is the documented one: gradeorder, gradename, gradeid; levelorder, levelname, levelid
    expect(idsOf(content.activeGrades as never, "gradeid")).toEqual(["g-4", "g-1", "g-3", "g-2"]);
    expect(idsOf(content.activeLevels as never, "levelid")).toEqual(["l-1", "l-2", "l-4", "l-3"]);
    expect(idsOf(tree.activeGrades, "gradeid")).toEqual(idsOf(content.activeGrades as never, "gradeid"));
    expect(idsOf(tree.activeLevels, "levelid")).toEqual(idsOf(content.activeLevels as never, "levelid"));
  });

  it("both leave out grades and levels that are switched off or deleted, and another curriculum's", async () => {
    const tree = await treeOfAwards();
    for (const gone of ["g-off", "g-del", "g-x"]) expect(idsOf(tree.activeGrades, "gradeid")).not.toContain(gone);
    expect(idsOf(tree.activeLevels, "levelid")).not.toContain("l-off");
  });
});
