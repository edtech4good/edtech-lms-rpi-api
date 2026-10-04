import { schools } from "src/models/data-models/school";
import { schoolusers, studentprogress, students } from "src/models/data-models/init-models";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * Organisations package, step 5c: a roster that names the school it is for (a
 * top-level `schoolid`, format 3) may carry only that school's rows. One row of
 * another school, with no school, or whose name matches no school here, fails the
 * whole file with a 400 and nothing is written. A roster with no top-level
 * `schoolid` (every payload sent until now) is read exactly as before.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const A = "5c000000-0000-4000-8000-0000000000a1";
const B = "5c000000-0000-4000-8000-0000000000b2";
const user = { schooluserid: "server" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;
const mockZipContaining = (payload: unknown) =>
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from(JSON.stringify(payload)) }],
  }));

let schoolRows: Array<{ schoolid: string; schoolname: string }>;
const tnx = { commit: jest.fn(), rollback: jest.fn() };

beforeEach(() => {
  schoolRows = [
    { schoolid: A, schoolname: "សាលា A" },
    { schoolid: B, schoolname: "សាលា B" },
  ];
  tnx.commit.mockResolvedValue(undefined);
  tnx.rollback.mockResolvedValue(undefined);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
  jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where: { logic: string } }) =>
    schoolRows.filter((s) => s.schoolname.toLowerCase() === opts.where.logic.trim().toLowerCase()).map((s) => ({ isdeleted: false, ...s }))) as never);
  jest.spyOn(schools, "findOne").mockImplementation((async (opts: { where: { schoolid: string } }) =>
    schoolRows.find((s) => s.schoolid === opts.where.schoolid) ?? null) as never);
  jest.spyOn(schoolusers, "bulkCreate").mockImplementation((async (rows: Array<{ schoolusername: string }>) => rows) as never);
  jest.spyOn(students, "bulkCreate").mockResolvedValue([] as never);
  jest.spyOn(studentprogress, "bulkCreate").mockResolvedValue([] as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  (AdmZip as jest.Mock).mockReset();
});

const learner = (n: number, school: Record<string, unknown> = { schoolid: A }): Record<string, any> => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  schooluserid: `su${n}`,
  schoolusername: `learner${n}`,
  schooluserrole: "STUDENT",
  ...school,
  student: { studentid: `s${n}`, schooluserid: `su${n}`, ...school },
});
const nothingWritten = () => {
  expect(students.bulkCreate).not.toHaveBeenCalled();
  expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
  expect(tnx.commit).not.toHaveBeenCalled();
  expect(tnx.rollback).toHaveBeenCalledTimes(1);
};

describe("PUT /import/students for one school", () => {
  it("every row of the school named is imported (by the id it carries, or by a name that resolves to it)", async () => {
    mockZipContaining({ schoolid: A, studentusers: [learner(1), learner(2, { schoolname: "សាលា A" }), learner(3, { schoolid: A.toUpperCase() })] });
    await expect(new ImportController().studentsimport(file, user)).resolves.toEqual({ error: false, data: true });
    expect(students.bulkCreate).toHaveBeenCalled();
    expect(tnx.commit).toHaveBeenCalledTimes(1);
  });

  it("one row of another school refuses the whole file: 400, rolled back, nothing written", async () => {
    mockZipContaining({ schoolid: A, studentusers: [learner(1), learner(2, { schoolid: B })] });
    await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/1 row does not belong to the school/) });
    nothingWritten();
  });

  it("the row's own learner record is checked too, not only its login", async () => {
    const row = learner(1);
    row.student = { ...row.student, schoolid: B };
    mockZipContaining({ schoolid: A, studentusers: [row] });
    await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
    nothingWritten();
  });

  it("a row whose name resolves to another school, a row with no school at all, and a name that matches no school are refused", async () => {
    for (const school of [{ schoolname: "សាលា B" }, {}, { schoolname: "Not Here" }]) {
      jest.clearAllMocks();
      tnx.commit.mockResolvedValue(undefined);
      tnx.rollback.mockResolvedValue(undefined);
      mockZipContaining({ schoolid: A, studentusers: [learner(1), learner(2, school)] });
      await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
      nothingWritten();
    }
  });

  it("before its school has reached this server: rows that carry the school id pass, rows with only a name are refused (the name cannot resolve yet)", async () => {
    schoolRows = [];
    mockZipContaining({ schoolid: A, studentusers: [learner(1), learner(2, { schoolid: A, schoolname: "សាលា A" })] });
    await expect(new ImportController().studentsimport(file, user)).resolves.toEqual({ error: false, data: true });
    expect(students.bulkCreate).toHaveBeenCalled();
    jest.clearAllMocks();
    tnx.commit.mockResolvedValue(undefined);
    tnx.rollback.mockResolvedValue(undefined);
    mockZipContaining({ schoolid: A, studentusers: [learner(3, { schoolname: "សាលា A" })] });
    await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
    nothingWritten();
  });

  it("a schoolid that is not a school id is refused", async () => {
    for (const schoolid of ["", "  ", null, 7]) {
      jest.clearAllMocks();
      tnx.commit.mockResolvedValue(undefined);
      tnx.rollback.mockResolvedValue(undefined);
      mockZipContaining({ schoolid, studentusers: [learner(1)] });
      await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
      nothingWritten();
    }
  });

  it("a row whose id and name name different schools is still refused (id/name agreement holds)", async () => {
    mockZipContaining({ schoolid: A, studentusers: [learner(1, { schoolid: A, schoolname: "សាលា B" })] });
    await expect(new ImportController().studentsimport(file, user)).rejects.toMatchObject({ status: 400 });
    nothingWritten();
  });

  it("a payload with no top-level schoolid is read as before: rows of any school are imported", async () => {
    mockZipContaining({ studentusers: [learner(1), learner(2, { schoolid: B })] });
    await expect(new ImportController().studentsimport(file, user)).resolves.toEqual({ error: false, data: true });
    expect(tnx.commit).toHaveBeenCalledTimes(1);
  });
});

describe("PUT /import/teachers for one school", () => {
  const teacher = (n: number, school: Record<string, unknown> = { schoolid: A }) => ({ schooluserid: `t${n}`, schoolusername: `teacher${n}`, ...school });

  it("a list of teachers is still the old payload: no school is named, so none is checked", async () => {
    mockZipContaining([teacher(1), teacher(2, { schoolid: B })]);
    await expect(new ImportController().teachersimport(file, user)).resolves.toEqual({ error: false, data: true });
  });

  it("{ schoolid, teachers } imports the teachers of that school", async () => {
    mockZipContaining({ schoolid: A, teachers: [teacher(1), teacher(2, { schoolname: "សាលា A" })] });
    await expect(new ImportController().teachersimport(file, user)).resolves.toEqual({ error: false, data: true });
    expect((schoolusers.bulkCreate as jest.Mock).mock.calls[0][0]).toHaveLength(2);
  });

  it("{ schoolid, teachers } with a teacher of another school refuses the whole file, nothing written", async () => {
    mockZipContaining({ schoolid: A, teachers: [teacher(1), teacher(2, { schoolid: B })] });
    await expect(new ImportController().teachersimport(file, user)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/does not belong to the school/) });
    expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
    expect(tnx.commit).not.toHaveBeenCalled();
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });

  it("an object that is not { schoolid, teachers } is refused", async () => {
    mockZipContaining({ teachers: [teacher(1)] });
    await expect(new ImportController().teachersimport(file, user)).rejects.toMatchObject({ status: 400 });
    mockZipContaining({ schoolid: A });
    await expect(new ImportController().teachersimport(file, user)).rejects.toMatchObject({ status: 400 });
    expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
  });
});
