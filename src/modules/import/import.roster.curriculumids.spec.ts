import { schoolusers, students } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { LISTED_ROWS } from "src/business/roster-refs";
import { learnerCurriculumList } from "src/business/content-access";
import { ImportController } from "./import.controller";

/**
 * The content guard answers a learner only from `students.curriculumids`, and a roster that carries a learner with
 * `curriculumid` set and that list NULL would lock the learner out of every route. `PUT /import/students` therefore
 * stores `curriculumids = [curriculumid]` for such a row and says how many it did; a row with a list is left as it is;
 * a row with neither names no curriculum and the roster is refused, by row, before a write.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const SCHOOL = "5c000000-0000-4000-8000-0000000000a1";
const CUR = "c1000000-0000-4000-8000-000000000001";
const OTHER = "c1000000-0000-4000-8000-000000000002";
const user = { schooluserid: "server" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;
const tnx = { commit: jest.fn(), rollback: jest.fn() };

beforeEach(() => {
  tnx.commit.mockResolvedValue(undefined);
  tnx.rollback.mockResolvedValue(undefined);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
  jest.spyOn(schools, "findOne").mockImplementation((async () => ({ schoolid: SCHOOL })) as never);
  jest.spyOn(standards, "findAll").mockResolvedValue([] as never);
  jest.spyOn(schoolusers, "bulkCreate").mockImplementation((async (rows: unknown[]) => rows) as never);
  jest.spyOn(students, "bulkCreate").mockResolvedValue([] as never);
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
const send = (studentusers: unknown[]) => {
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from(JSON.stringify({ studentusers })) }],
  }));
  return new ImportController().studentsimport(file, user);
};
/** The `curriculumids` each learner was written with, in roster order. */
const written = (): unknown[] => (students.bulkCreate as jest.Mock).mock.calls.map((call) => (call[0][0] as { curriculumids?: unknown }).curriculumids);
const nothingWritten = () => {
  expect(students.bulkCreate).not.toHaveBeenCalled();
  expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
  expect(tnx.commit).not.toHaveBeenCalled();
  expect(tnx.rollback).toHaveBeenCalledTimes(1);
};
const refused = (message: string) => ({ status: 400, message: expect.stringContaining(message) });

describe("PUT /import/students: a learner with curriculumid and no curriculumids", () => {
  it("is stored with [curriculumid] when the list is absent, null, empty, or holds nothing usable, and the report counts each", async () => {
    const roster = [
      learner(1, { curriculumid: CUR }),
      learner(2, { curriculumid: CUR, curriculumids: null }),
      learner(3, { curriculumid: CUR, curriculumids: [] }),
      learner(4, { curriculumid: CUR, curriculumids: [null, "", 7] }),
      learner(5, { curriculumid: CUR, curriculumids: "not a list" }),
    ];
    await expect(send(roster)).resolves.toEqual({ error: false, data: true, curriculumListsFromCurriculumid: 5 });
    expect(written()).toEqual([[CUR], [CUR], [CUR], [CUR], [CUR]]);
    expect(tnx.commit).toHaveBeenCalledTimes(1);
  });

  it("leaves a list that has an id in it exactly as it is, even when it differs from curriculumid; the report says nothing when none were filled", async () => {
    const roster = [learner(1, { curriculumid: CUR, curriculumids: [OTHER] }), learner(2, { curriculumid: CUR, curriculumids: [CUR, OTHER] })];
    await expect(send(roster)).resolves.toEqual({ error: false, data: true });
    expect(written()).toEqual([[OTHER], [CUR, OTHER]]);
  });

  it("counts only the learners it filled in a mixed roster", async () => {
    const roster = [learner(1, { curriculumid: CUR, curriculumids: [OTHER] }), learner(2, { curriculumid: CUR }), learner(3, { curriculumid: OTHER, curriculumids: null })];
    await expect(send(roster)).resolves.toEqual({ error: false, data: true, curriculumListsFromCurriculumid: 2 });
    expect(written()).toEqual([[OTHER], [CUR], [OTHER]]);
  });

  it("then reads as the learner's curriculum list: the content guard's own read of the stored row finds the curriculum", async () => {
    await send([learner(1, { curriculumid: CUR })]);
    const stored = (students.bulkCreate as jest.Mock).mock.calls[0][0][0];
    jest.spyOn(students, "findOne").mockImplementation((async () => ({ studentid: stored.studentid, curriculumids: stored.curriculumids })) as never);
    await expect(learnerCurriculumList("s1")).resolves.toEqual([CUR]);
  });
});

describe("PUT /import/students: a learner with neither curriculumid nor curriculumids", () => {
  it("refuses the whole file, names the row by position, and writes nothing", async () => {
    await expect(send([learner(1, { curriculumid: CUR }), learner(2), learner(3, { curriculumids: [] })])).rejects.toMatchObject(
      refused("That roster has learners with no curriculum (students row 2: curriculum; students row 3: curriculum). Nothing was written."),
    );
    nothingWritten();
  });

  it("an empty, space-only or non-text curriculumid names no curriculum", async () => {
    for (const curriculumid of ["", "   ", null, 7, {}]) {
      jest.clearAllMocks();
      tnx.commit.mockResolvedValue(undefined);
      tnx.rollback.mockResolvedValue(undefined);
      await expect(send([learner(1, { curriculumid })])).rejects.toMatchObject(refused("students row 1: curriculum"));
      nothingWritten();
    }
  });

  it("lists the first rows and counts the rest; never an id or a name", async () => {
    const many = Array.from({ length: LISTED_ROWS + 3 }, (_, i) => learner(i + 1));
    const error = await send(many).catch((e) => e);
    expect(error.status).toBe(400);
    expect(error.message).toContain(`students row ${LISTED_ROWS}: curriculum, and 3 more)`);
    expect(error.message).not.toContain(`students row ${LISTED_ROWS + 1}:`);
    expect(JSON.stringify(error.response ?? error.message)).not.toMatch(/learner1|su1|s1\b/);
    nothingWritten();
  });

  it("a learner with a list and no curriculumid is not this check's to refuse (the column's own rule applies)", async () => {
    await expect(send([learner(1, { curriculumids: [CUR] })])).resolves.toEqual({ error: false, data: true });
    expect(written()).toEqual([[CUR]]);
  });
});
