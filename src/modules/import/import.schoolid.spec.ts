import { schools } from "src/models/data-models/school";
import { schoolusers, studentprogress, students } from "src/models/data-models/init-models";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * Organisations package, step 5b: the roster imports write `schoolid` with
 * `schoolname`. The id follows the school the row names (or carries), so it is
 * never left stale when a learner changes school; an old payload with no id keeps
 * working. The transaction and the writes are replaced (no database): what is
 * pinned is what each import hands to `bulkCreate` and `updateOnDuplicate`.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const A = "5c000000-0000-4000-8000-0000000000a1";
const B = "5c000000-0000-4000-8000-0000000000b2";
const user = { schooluserid: "u1", schoolusername: "central" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;

const mockZipContaining = (payload: unknown) => {
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from(JSON.stringify(payload)) }],
  }));
};

let findOne: jest.SpyInstance;
let schoolRows: Array<{ schoolid: string; schoolname: string; isdeleted?: boolean }>;
const tnx = { commit: jest.fn(), rollback: jest.fn() };

const learner = (n: number, extra: Record<string, unknown> = {}) => ({
  schooluserid: `su${n}`,
  schoolusername: `learner${n}`,
  schooluserrole: "STUDENT",
  schoolname: "School A",
  student: { studentid: `s${n}`, schooluserid: `su${n}`, schoolname: "School A" },
  ...extra,
});

beforeEach(() => {
  schoolRows = [
    { schoolid: A, schoolname: "School A" },
    { schoolid: B, schoolname: "School B" },
  ];
  tnx.commit.mockResolvedValue(undefined);
  tnx.rollback.mockResolvedValue(undefined);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
  jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where: { logic: string } }) =>
    schoolRows.filter((s) => s.schoolname.toLowerCase() === opts.where.logic.trim().toLowerCase()).map((s) => ({ isdeleted: false, ...s }))) as never);
  findOne = jest.spyOn(schools, "findOne").mockImplementation((async (opts: { where: { schoolid: string } }) =>
    schoolRows.find((s) => s.schoolid === opts.where.schoolid) ?? null) as never);
  jest.spyOn(schoolusers, "bulkCreate").mockImplementation((async (rows: Array<{ schoolusername: string }>) => rows) as never);
  jest.spyOn(students, "bulkCreate").mockResolvedValue([] as never);
  jest.spyOn(studentprogress, "bulkCreate").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (AdmZip as jest.Mock).mockReset();
});

const loginRows = () => (schoolusers.bulkCreate as jest.Mock).mock.calls[0][0] as Array<Record<string, unknown>>;
const learnerRows = () => (students.bulkCreate as jest.Mock).mock.calls.map((c) => c[0][0] as Record<string, unknown>);
const updateList = (model: typeof students | typeof schoolusers, call = 0) =>
  (model.bulkCreate as jest.Mock).mock.calls[call][1].updateOnDuplicate as string[];

describe("PUT /import/students", () => {
  it("an old payload (names only) stores each learner's and login's school id beside the name", async () => {
    mockZipContaining({ studentusers: [learner(1), learner(2, { schoolname: "school b", student: { studentid: "s2", schooluserid: "su2", schoolname: "school b" } })] });
    await new ImportController().studentsimport(file, user);
    expect(learnerRows().map((r) => [r.schoolname, r.schoolid])).toEqual([
      ["School A", A],
      ["school b", B],
    ]);
    expect(loginRows().map((r) => [r.schoolname, r.schoolid])).toEqual([
      ["School A", A],
      ["school b", B],
    ]);
  });

  it("a payload that carries schoolid stores it", async () => {
    mockZipContaining({
      studentusers: [learner(1, { schoolid: B, schoolname: "School B", student: { studentid: "s1", schooluserid: "su1", schoolname: "School B", schoolid: B } })],
    });
    await new ImportController().studentsimport(file, user);
    expect(learnerRows()[0]).toMatchObject({ schoolname: "School B", schoolid: B });
    expect(loginRows()[0]).toMatchObject({ schoolid: B });
  });

  it("a payload with only an id (no name) stores the id", async () => {
    mockZipContaining({
      studentusers: [learner(1, { schoolid: B, schoolname: undefined, student: { studentid: "s1", schooluserid: "su1", schoolid: B } })],
    });
    await new ImportController().studentsimport(file, user);
    expect(learnerRows()[0]).toMatchObject({ schoolid: B });
    expect(loginRows()[0]).toMatchObject({ schoolid: B });
  });

  it("a payload whose id and name name different schools fails: 400, rolled back, nothing written", async () => {
    mockZipContaining({
      studentusers: [learner(1, { schoolid: B, student: { studentid: "s1", schooluserid: "su1", schoolname: "School A", schoolid: B } })],
    });
    await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
    expect(students.bulkCreate).not.toHaveBeenCalled();
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
    expect(tnx.commit).not.toHaveBeenCalled();
  });

  it("a teacher payload whose id and name name different schools fails with a 400", async () => {
    mockZipContaining([{ schooluserid: "t1", schoolusername: "teacher1", schoolname: "School A", schoolid: B }]);
    await expect(new ImportController().teachersimport(file, user)).rejects.toMatchObject({ status: 400 });
    expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });

  it("a learner who moves school gets the new id with the new name (the id is rewritten, not left stale)", async () => {
    mockZipContaining({ studentusers: [learner(1, { schoolname: "School B", student: { studentid: "s1", schooluserid: "su1", schoolname: "School B" } })] });
    await new ImportController().studentsimport(file, user);
    expect(learnerRows()[0]).toMatchObject({ schoolname: "School B", schoolid: B });
  });

  it("both writes list schoolid among the columns an existing row has updated", async () => {
    mockZipContaining({ studentusers: [learner(1)] });
    await new ImportController().studentsimport(file, user);
    expect(updateList(students)).toEqual(expect.arrayContaining(["schoolname", "schoolid"]));
    expect(updateList(schoolusers)).toEqual(expect.arrayContaining(["schoolname", "schoolid"]));
  });

  it("a school this server does not have yet, or none, is written with a NULL id and the import still succeeds", async () => {
    mockZipContaining({
      studentusers: [
        learner(1, { schoolname: "Not Here Yet", student: { studentid: "s1", schooluserid: "su1", schoolname: "Not Here Yet" } }),
        learner(2, { schoolname: undefined, student: { studentid: "s2", schooluserid: "su2" } }),
      ],
    });
    await expect(new ImportController().studentsimport(file, user)).resolves.toEqual({ error: false, data: true });
    expect(learnerRows().map((r) => r.schoolid)).toEqual([null, null]);
    expect(tnx.commit).toHaveBeenCalledTimes(1);
  });

  it("the school lookups run inside the import's transaction", async () => {
    mockZipContaining({ studentusers: [learner(1, { schoolid: A })] });
    await new ImportController().studentsimport(file, user);
    expect(findOne.mock.calls.every((c) => c[0].transaction === tnx)).toBe(true);
    expect((schools.findAll as unknown as jest.SpyInstance).mock.calls.every((c) => c[0].transaction === tnx)).toBe(true);
  });

  it("a name that matches two schools fails the import: nothing is written, 400, rolled back", async () => {
    schoolRows = [
      { schoolid: A, schoolname: "School A" },
      { schoolid: B, schoolname: "School A" },
    ];
    mockZipContaining({ studentusers: [learner(1)] });
    await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
    expect(students.bulkCreate).not.toHaveBeenCalled();
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /import/teachers", () => {
  const teacher = (extra: Record<string, unknown> = {}) => ({ schooluserid: "t1", schoolusername: "teacher1", schoolname: "School A", ...extra });

  it("an old payload stores the teacher's school id beside the name, as a teacher", async () => {
    mockZipContaining([teacher()]);
    await new ImportController().teachersimport(file, user);
    expect(loginRows()[0]).toMatchObject({ schoolname: "School A", schoolid: A, schooluserrole: expect.anything() });
  });

  it("a payload with a schoolid stores it; the update list names schoolid", async () => {
    mockZipContaining([teacher({ schoolid: B, schoolname: "School B" })]);
    await new ImportController().teachersimport(file, user);
    expect(loginRows()[0]).toMatchObject({ schoolid: B });
    expect(updateList(schoolusers)).toEqual(expect.arrayContaining(["schoolname", "schoolid"]));
  });

  it("a teacher who moves school takes the new id", async () => {
    mockZipContaining([teacher({ schoolname: "school b" })]);
    await new ImportController().teachersimport(file, user);
    expect(loginRows()[0]).toMatchObject({ schoolid: B });
  });
});
