import { parseISO } from "date-fns";
import {
  schoolusers,
  studentgradesprogress,
  studentlearningprogress,
  studentlessonsprogress,
  studentlevelsprogress,
  studentprogress,
  students,
} from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * `PUT /import/students` receives what central's `POST sync/cloud/:school/students`
 * zips: `schoolusers` rows with the `students` row nested under `student`
 * (`getschooluserbyschoolname` includes it), dates as ISO strings from
 * `JSON.stringify`. Nothing about dates sits on the top level.
 *
 * The date handling used to read the top-level fields (so both were always
 * null for a real payload), swap birth and join, and put the result on the
 * schooluser row, where `schoolusers.bulkCreate` dropped it. The row written to
 * `students` was the untouched nested one, so the parse never reached it.
 *
 * What is under test is what reaches `students.bulkCreate`. The model writes
 * and the transaction are mocked; the real-DB check is in the PR description.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const user = { schooluserid: "u1", schoolusername: "teacher1" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;

const mockZipContaining = (payload: unknown) => {
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [
      {
        header: { size: 10 },
        getData: () => Buffer.from(JSON.stringify(payload)),
      },
    ],
  }));
};

// Two distinct dates, so a swap cannot pass by accident.
const BIRTH = "2015-03-14T00:00:00.000Z";
const JOIN = "2024-09-02T00:00:00.000Z";

// The school the roster names: it is "here" (S4: a roster is refused until its school is).
const SCHOOL = "5c000000-0000-4000-8000-0000000000a1";

const studentuser = (student: Record<string, unknown>) => ({
  schooluserid: "su1",
  schoolusername: "sokha01",
  schooluserrole: "STUDENT",
  schoolid: SCHOOL,
  student: {
    studentid: "s1",
    schooluserid: "su1",
    schoolid: SCHOOL,
    studentfirstname: "សុខា",
    studentlastname: "ចាន់",
    city: "ភ្នំពេញ",
    ...student,
  },
});

describe("students import writes the nested student's dates to the right columns", () => {
  beforeEach(() => {
    jest.spyOn(schools, "findOne").mockResolvedValue({ schoolid: SCHOOL, schoolname: "School" } as never);
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue({
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    } as never);
    jest
      .spyOn(schoolusers, "bulkCreate")
      .mockResolvedValue([{ schoolusername: "sokha01" }] as never);
    for (const model of [
      students,
      studentprogress,
      studentlearningprogress,
      studentgradesprogress,
      studentlevelsprogress,
      studentlessonsprogress,
    ]) {
      jest.spyOn(model, "bulkCreate").mockResolvedValue([] as never);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (AdmZip as jest.Mock).mockReset();
  });

  const writtenStudent = () => (students.bulkCreate as jest.Mock).mock.calls[0][0][0];

  it("dateofbirth comes from student.dateofbirth and dateofjoin from student.dateofjoin", async () => {
    mockZipContaining({
      studentusers: [studentuser({ dateofbirth: BIRTH, dateofjoin: JOIN })],
    });

    await new ImportController().studentsimport(file, user);

    const written = writtenStudent();
    expect(written.dateofbirth).toEqual(parseISO(BIRTH));
    expect(written.dateofjoin).toEqual(parseISO(JOIN));
    expect(written.studentfirstname).toBe("សុខា");
    expect(written.schooluserid).toBe("su1");
  });

  it("a missing date is null and does not borrow the other one", async () => {
    mockZipContaining({
      studentusers: [studentuser({ dateofbirth: null, dateofjoin: JOIN })],
    });

    await new ImportController().studentsimport(file, user);

    const written = writtenStudent();
    expect(written.dateofbirth).toBeNull();
    expect(written.dateofjoin).toEqual(parseISO(JOIN));
  });
});
