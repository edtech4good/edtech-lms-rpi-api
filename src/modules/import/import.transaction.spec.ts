import { BadRequestException } from "@nestjs/common";
import { StudentProgressBusiness } from "src/business/studentprogress.business";
import {
  schoolusers,
  studentgradesprogress,
  studentlearningprogress,
  studentlessonsprogress,
  studentlevelsprogress,
  studentprogress,
  students,
} from "src/models/data-models/init-models";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * The roster imports write inside a transaction and must not answer until
 * every write and the commit have finished. Before this was fixed,
 * `importStudentProgress` fired its `bulkCreate` without awaiting it, and the
 * handlers called `tnx.commit()` / `tnx.rollback()` without awaiting them. So:
 *
 * - a failing studentprogress write still answered 200 and committed the
 *   rest of the import, and its rejection went unhandled — which server.ts
 *   treats as fatal (`process.exit(1)`), taking the whole API down;
 * - a failing commit still answered 200.
 *
 * The transaction and the model writes are mocked: what is under test is the
 * control flow (does a rejected write reach the rollback and the 400), not
 * MySQL. The real-DB check is in the PR description.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");
// Master sync's many steps (cleanup + one bulkCreate per content table) are
// beside the point here; only what happens around the commit is. Every
// SyncBusiness method resolves.
jest.mock("src/business/sync.business", () => ({
  SyncBusiness: jest.fn().mockImplementation(
    () => new Proxy({}, { get: () => () => Promise.resolve([]) })
  ),
}));

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

const studentPayload = {
  studentusers: [
    { schooluserid: "su1", schoolusername: "student1", student: { studentid: "s1" } },
  ],
  studentprogresses: {
    studentprogress: [{ studentprogressid: "p1", studentid: "s1" }],
    studentlearningprogress: [],
    studentgradesprogress: [],
    studentlevelsprogress: [],
    studentlessonsprogress: [],
  },
};

/**
 * Rejects on the next macrotask rather than immediately. An immediately
 * rejected promise would make an un-awaited call fail "fast enough" in some
 * orderings; a delayed one guarantees the handler has already moved on (to
 * commit and return) if it isn't waiting.
 */
const rejectLater = (message: string) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 5));

describe("import transactions wait for their writes and commit", () => {
  let tnx: { commit: jest.Mock; rollback: jest.Mock };

  beforeEach(() => {
    tnx = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
    // importschoolusers returns schoolusers.bulkCreate's rows; the controller
    // matches them back to the payload by schoolusername.
    jest
      .spyOn(schoolusers, "bulkCreate")
      .mockResolvedValue([{ schoolusername: "student1" }] as never);
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

  it("importStudentProgress rejects when its bulkCreate rejects", async () => {
    jest.spyOn(studentprogress, "bulkCreate").mockReturnValue(rejectLater("ER_NO_REFERENCED_ROW_2") as never);

    await expect(
      new StudentProgressBusiness().importStudentProgress([], tnx as never)
    ).rejects.toThrow("ER_NO_REFERENCED_ROW_2");
  });

  it("students import commits after all writes succeed", async () => {
    mockZipContaining(studentPayload);

    await expect(new ImportController().studentsimport(file, user)).resolves.toEqual({
      error: false,
      data: true,
    });
    expect(studentprogress.bulkCreate).toHaveBeenCalledTimes(1);
    expect(tnx.commit).toHaveBeenCalledTimes(1);
    expect(tnx.rollback).not.toHaveBeenCalled();
  });

  it("students import rolls back and answers 400 when the studentprogress write fails", async () => {
    mockZipContaining(studentPayload);
    jest.spyOn(studentprogress, "bulkCreate").mockReturnValue(rejectLater("ER_NO_REFERENCED_ROW_2") as never);

    await expect(new ImportController().studentsimport(file, user)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(tnx.commit).not.toHaveBeenCalled();
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });

  it("students import answers 400 when the commit fails", async () => {
    mockZipContaining(studentPayload);
    tnx.commit.mockReturnValue(rejectLater("commit failed"));

    await expect(new ImportController().studentsimport(file, user)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("teachers import answers 400 (not the rollback's error) when the commit fails", async () => {
    mockZipContaining([{ schooluserid: "t1", schoolusername: "teacher9" }]);
    tnx.commit.mockReturnValue(rejectLater("commit failed"));
    // What Sequelize does after a failed commit: the transaction is finished.
    tnx.rollback.mockRejectedValue(
      new Error("Transaction cannot be rolled back because it has been finished with state: commit")
    );

    await expect(new ImportController().teachersimport(file, user)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });

  it("master sync answers 400 when the commit fails", async () => {
    mockZipContaining({ documents: [], questions: [], lessonlearnings: [] });
    jest.spyOn(dbinstance.getdbinstance(), "query").mockResolvedValue([] as never);
    tnx.commit.mockReturnValue(rejectLater("commit failed"));

    await expect(new ImportController().completesync(file, user)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });
});
