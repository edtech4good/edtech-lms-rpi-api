import { grades, curriculums, lessons, levels, schoolusers, studentgradesprogress, studentlessonsprogress, studentlevelsprogress, studentprogress, students } from "src/models/data-models/init-models";
import { standards } from "src/models/data-models/standards";
import { schools } from "src/models/data-models/school";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { LISTED_ROWS } from "src/business/roster-refs";
import { ImportController } from "./import.controller";

/**
 * The foreign keys of `20261026120000-foreign-keys-and-not-nulls` (students.standard and the grade, level and lesson
 * progress tables) have a writer: `PUT /import/students`. A roster that names a class, a curriculum, a grade, a level,
 * a lesson or a learner this server does not hold is refused BEFORE a row is written, with a 400 that names the row
 * (its table and position in the file) and the word for what is missing, never an id or a name. Without these checks
 * the database's key would refuse it and the controller would answer "Invalid file".
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const SCHOOL = "5c000000-0000-4000-8000-0000000000a1";
const user = { schooluserid: "server" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;
const mockZipContaining = (payload: unknown) =>
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from(JSON.stringify(payload)) }],
  }));

/** What this server holds. */
let held: { standards: string[]; curriculums: string[]; grades: string[]; levels: string[]; lessons: string[]; students: string[] };
const tnx = { commit: jest.fn(), rollback: jest.fn() };

/** A findAll over a list of ids, as the database answers an `IN` (the column compares without regard to letter case). */
const holding = (key: string, getIds: () => string[]) =>
  (async (options: { where: Record<string, { [k: symbol]: string[] }> }) => {
    const asked = Object.getOwnPropertySymbols(options.where[key]).map((s) => options.where[key][s]).flat().map((id) => id.toLowerCase());
    return getIds().filter((id) => asked.includes(id.toLowerCase())).map((id) => ({ [key]: id }));
  }) as never;

beforeEach(() => {
  held = { standards: ["class-a", "Class-B"], curriculums: ["cur-1"], grades: ["gr-1"], levels: ["lv-1"], lessons: ["ls-1"], students: ["old-student"] };
  tnx.commit.mockResolvedValue(undefined);
  tnx.rollback.mockResolvedValue(undefined);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
  jest.spyOn(schools, "findOne").mockImplementation((async () => ({ schoolid: SCHOOL })) as never);
  jest.spyOn(standards, "findAll").mockImplementation(holding("standardid", () => held.standards));
  jest.spyOn(curriculums, "findAll").mockImplementation(holding("curriculumid", () => held.curriculums));
  jest.spyOn(grades, "findAll").mockImplementation(holding("gradeid", () => held.grades));
  jest.spyOn(levels, "findAll").mockImplementation(holding("levelid", () => held.levels));
  jest.spyOn(lessons, "findAll").mockImplementation(holding("lessonid", () => held.lessons));
  jest.spyOn(students, "findAll").mockImplementation(holding("studentid", () => held.students));
  jest.spyOn(schoolusers, "bulkCreate").mockImplementation((async (rows: unknown[]) => rows) as never);
  jest.spyOn(students, "bulkCreate").mockResolvedValue([] as never);
  jest.spyOn(studentprogress, "bulkCreate").mockResolvedValue([] as never);
  jest.spyOn(studentgradesprogress, "bulkCreate").mockResolvedValue([] as never);
  jest.spyOn(studentlevelsprogress, "bulkCreate").mockResolvedValue([] as never);
  jest.spyOn(studentlessonsprogress, "bulkCreate").mockResolvedValue([] as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  (AdmZip as jest.Mock).mockReset();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const learner = (n: number, student: Record<string, unknown> = {}): Record<string, any> => ({
  schooluserid: `su${n}`,
  schoolusername: `learner${n}`,
  schooluserrole: "STUDENT",
  schoolid: SCHOOL,
  student: { studentid: `s${n}`, schooluserid: `su${n}`, schoolid: SCHOOL, ...student },
});
const nothingWritten = () => {
  expect(students.bulkCreate).not.toHaveBeenCalled();
  expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
  expect(studentgradesprogress.bulkCreate).not.toHaveBeenCalled();
  expect(studentlevelsprogress.bulkCreate).not.toHaveBeenCalled();
  expect(studentlessonsprogress.bulkCreate).not.toHaveBeenCalled();
  expect(tnx.commit).not.toHaveBeenCalled();
  expect(tnx.rollback).toHaveBeenCalledTimes(1);
};
const send = (payload: unknown) => {
  mockZipContaining(payload);
  return new ImportController().studentsimport(file, user);
};
const refused = (message: string) => ({ status: 400, message: expect.stringContaining(message) });

describe("PUT /import/students: the class of a learner", () => {
  it("a class this server holds is imported (a class compares without regard to letter case, as the key does); no class at all is fine", async () => {
    await expect(send({ studentusers: [learner(1, { standard: "class-a" }), learner(2, { standard: "CLASS-b" }), learner(3), learner(4, { standard: null })] })).resolves.toEqual({ error: false, data: true });
    expect(tnx.commit).toHaveBeenCalledTimes(1);
    expect(students.bulkCreate).toHaveBeenCalledTimes(4);
  });

  it("a class this server does not hold refuses the whole file, names the row, and writes nothing", async () => {
    await expect(send({ studentusers: [learner(1, { standard: "class-a" }), learner(2, { standard: "class-not-here" }), learner(3)] })).rejects.toMatchObject(
      refused("That roster has learners in a class this server doesn't have (students row 2: class). Nothing was written."),
    );
    nothingWritten();
  });

  it("an empty class and a class that is not text name no class", async () => {
    for (const standard of ["", 7, {}, true]) {
      jest.clearAllMocks();
      tnx.commit.mockResolvedValue(undefined);
      tnx.rollback.mockResolvedValue(undefined);
      await expect(send({ studentusers: [learner(1, { standard })] })).rejects.toMatchObject(refused("students row 1: class"));
      nothingWritten();
    }
  });

  it("lists the first rows and counts the rest; never an id or a name", async () => {
    const many = Array.from({ length: LISTED_ROWS + 4 }, (_, i) => learner(i + 1, { standard: `secret-class-${i}` }));
    const error = await send({ studentusers: many }).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.message).toContain(`students row ${LISTED_ROWS}: class, and 4 more)`);
    expect(error.message).not.toContain(`students row ${LISTED_ROWS + 1}:`);
    expect(JSON.stringify(error.response ?? error.message)).not.toMatch(/secret-class|learner1|su1|s1\b/);
    nothingWritten();
  });

  it("is refused the same way when the roster names its school (format 3)", async () => {
    await expect(send({ schoolid: SCHOOL, studentusers: [learner(1, { standard: "nope" })] })).rejects.toMatchObject(refused("students row 1: class"));
    nothingWritten();
  });

  it("asks the database nothing when no learner names a class", async () => {
    await send({ studentusers: [learner(1), learner(2)] });
    expect(standards.findAll).not.toHaveBeenCalled();
  });
});

const lessonRow = (n: number, row: Record<string, unknown> = {}) => ({ studentlessonprogressid: `p${n}`, studentid: "s1", curid: "cur-1", gradeid: "gr-1", levelid: "lv-1", lessonid: "ls-1", ...row });
const levelRow = (n: number, row: Record<string, unknown> = {}) => ({ studentlevelprogressid: `p${n}`, studentid: "s1", curid: "cur-1", gradeid: "gr-1", levelid: "lv-1", ...row });
const gradeRow = (n: number, row: Record<string, unknown> = {}) => ({ studentgradeprogressid: `p${n}`, studentid: "s1", curriculumid: "cur-1", gradeid: "gr-1", ...row });
const progress = (rows: { grades?: unknown[]; levels?: unknown[]; lessons?: unknown[] }) => ({
  studentprogress: [],
  studentlearningprogress: [],
  studentgradesprogress: rows.grades ?? [],
  studentlevelsprogress: rows.levels ?? [],
  studentlessonsprogress: rows.lessons ?? [],
});

describe("PUT /import/students: the content and the learner of a progress row", () => {
  it("progress for content this server holds and for a learner of the roster (or one already here) is imported", async () => {
    const payload = { studentusers: [learner(1)], studentprogresses: progress({ grades: [gradeRow(1)], levels: [levelRow(1, { studentid: "old-student" })], lessons: [lessonRow(1, { levelid: "LV-1" })] }) };
    await expect(send(payload)).resolves.toEqual({ error: false, data: true });
    expect(studentlessonsprogress.bulkCreate).toHaveBeenCalledTimes(1);
    expect(tnx.commit).toHaveBeenCalledTimes(1);
  });

  it("a lesson this server does not hold refuses the whole file, names the table, the row and the lesson, and writes nothing", async () => {
    await expect(send({ studentusers: [learner(1)], studentprogresses: progress({ lessons: [lessonRow(1), lessonRow(2, { lessonid: "ls-not-here" })] }) })).rejects.toMatchObject(
      refused("That roster has progress for content or learners this server doesn't have (studentlessonsprogress row 2: lesson). Nothing was written."),
    );
    nothingWritten();
  });

  it("names every kind of thing that is missing on a row, once, and every table", async () => {
    const error = await send({
      studentusers: [learner(1)],
      studentprogresses: progress({
        grades: [gradeRow(1, { curriculumid: "no-cur", gradeid: "no-grade", studentid: "no-student" })],
        levels: [levelRow(1, { levelid: "no-level" })],
        lessons: [lessonRow(1, { curid: "no-cur", lessonid: "no-lesson", levelid: "no-level", gradeid: "no-grade" })],
      }),
    }).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.message).toContain("studentgradesprogress row 1: curriculum, grade, learner");
    expect(error.message).toContain("studentlevelsprogress row 1: level");
    expect(error.message).toContain("studentlessonsprogress row 1: curriculum, grade, level, lesson");
    expect(error.message).not.toMatch(/no-cur|no-grade|no-student|no-level|no-lesson/);
    nothingWritten();
  });

  it("a learner that is neither in the roster nor already here is refused", async () => {
    await expect(send({ studentusers: [learner(1)], studentprogresses: progress({ levels: [levelRow(1, { studentid: "stranger" })] }) })).rejects.toMatchObject(refused("studentlevelsprogress row 1: learner"));
    nothingWritten();
  });

  it("a missing or non-text value names nothing", async () => {
    for (const row of [{ lessonid: undefined }, { lessonid: null }, { lessonid: "" }, { lessonid: 5 }]) {
      jest.clearAllMocks();
      tnx.commit.mockResolvedValue(undefined);
      tnx.rollback.mockResolvedValue(undefined);
      await expect(send({ studentusers: [learner(1)], studentprogresses: progress({ lessons: [lessonRow(1, row)] }) })).rejects.toMatchObject(refused("studentlessonsprogress row 1: lesson"));
      nothingWritten();
    }
  });

  it("asks the database nothing for progress tables the roster carries no rows of", async () => {
    await send({ studentusers: [learner(1)], studentprogresses: progress({}) });
    for (const model of [curriculums, grades, levels, lessons]) expect(model.findAll).not.toHaveBeenCalled();
    await send({ studentusers: [learner(1)] });
    expect(lessons.findAll).not.toHaveBeenCalled();
  });

  it("checks the class before any login or learner is written, so a bad class leaves no half-written roster", async () => {
    await expect(send({ studentusers: [learner(1, { standard: "nope" })], studentprogresses: progress({ lessons: [lessonRow(1)] }) })).rejects.toMatchObject(refused("students row 1: class"));
    expect(lessons.findAll).not.toHaveBeenCalled();
    nothingWritten();
  });
});
