import { studentprogress, studentprogressquestions } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { LessonBusiness } from "./lesson.business";
import { ResultBusiness } from "./result.business";

/**
 * The answer rows a result stores (organisations package 8, step 2): only the known columns are written, from the
 * submitted item. The row's own ids are the server's, the question id comes from the item's id key, and nothing
 * else the client sent reaches the insert (no ids of its own, no other column, no stray property). A column the
 * item does not carry is left out, so it keeps its default.
 */
jest.mock("./lesson.business");

describe("the answer rows of a stored result carry the known columns and nothing else the client sent", () => {
  let created: Array<Record<string, unknown>>;

  beforeEach(() => {
    created = [];
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() } as never);
    jest.spyOn(studentprogress, "create").mockResolvedValue({ studentprogressid: "server-progress-id" } as never);
    jest.spyOn(studentprogressquestions, "create").mockImplementation((async (values: Record<string, unknown>) => {
      created.push(values);
      return values;
    }) as never);
    (LessonBusiness.prototype as any).setstudentactive = jest.fn().mockResolvedValue(undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  afterEach(() => jest.restoreAllMocks());

  const store = (items: unknown[]) =>
    new ResultBusiness().createbaselinequestionprogress(
      { marks: 1, points: 0, fullpoints: 0, passpercentage: 100, studentid: "s1", studentprogressreferenceid: "c1", actualanswers: JSON.stringify(items) },
      {} as never,
      { studentid: "s1" } as never,
    );

  it("an item writes the columns tries, iscorrect, answer, clientiscorrect and servergrade, the question id under its key, and the server's own ids", async () => {
    await store([
      { baselinequestionid: "q1", iscorrect: true, tries: 2, answer: { v: 1 }, clientiscorrect: false, servergrade: "correct" },
    ]);
    expect(created).toHaveLength(1);
    expect(Object.keys(created[0]).sort()).toEqual(
      ["answer", "clientiscorrect", "iscorrect", "referencequestionid", "servergrade", "studentprogressid", "studentprogressquestionid", "tries"],
    );
    expect(created[0]).toMatchObject({
      referencequestionid: "q1",
      studentprogressid: "server-progress-id",
      iscorrect: true,
      tries: 2,
      servergrade: "correct",
      clientiscorrect: false,
    });
    expect(created[0].studentprogressquestionid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("nothing else the client sent reaches the insert: not its own ids, not another column, not a stray property", async () => {
    await store([
      {
        baselinequestionid: "q1",
        iscorrect: true,
        studentprogressid: "the client's progress id",
        studentprogressquestionid: "the client's row id",
        referencequestionid: "the client's reference",
        question: { stray: true },
        isadmin: true,
        curriculumbaselineid: "c1",
        questionid: "q9",
      },
    ]);
    const row = created[0];
    expect(row.studentprogressid).toBe("server-progress-id");
    expect(row.studentprogressquestionid).not.toBe("the client's row id");
    expect(row.referencequestionid).toBe("q1");
    for (const stray of ["question", "isadmin", "curriculumbaselineid", "questionid", "baselinequestionid"]) {
      expect(row).not.toHaveProperty(stray);
    }
  });

  it("a column the item does not carry is left out, so it keeps its default (a quiz item has no tries)", async () => {
    await store([{ baselinequestionid: "q1", iscorrect: false }]);
    expect(Object.keys(created[0]).sort()).toEqual(["iscorrect", "referencequestionid", "studentprogressid", "studentprogressquestionid"]);
  });
});
