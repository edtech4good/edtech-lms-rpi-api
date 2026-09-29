import { levels } from "src/models/data-models/levels";
import { levelquizquestions } from "src/models/data-models/levelquizquestions";
import { lessons } from "src/models/data-models/lessons";
import { questions } from "src/models/data-models/questions";
import { studentprogress } from "src/models/data-models/studentprogress";
import { studentprogressquestions } from "src/models/data-models/studentprogressquestions";
import { QuestionBusiness } from "./question.business";

/**
 * workspace#79 step 2: `getlevelquestionsanswers` (the level-quiz "your
 * answers" learner-facing route) must keep echoing only `iscorrect` off the
 * student's own studentprogressquestions rows — never the raw `answer` or
 * the server's `servergrade`, which are grading-internal fields the client
 * has no business seeing. `studentprogressquestions.findAll` is mocked to
 * return rows that DO carry `answer`/`servergrade` (as a real, unscoped
 * fetch might), so this actually exercises the business code's own
 * mapping, not just the DB-level exclusion covered elsewhere.
 */
describe("QuestionBusiness.getlevelquestionsanswers never echoes answer/servergrade (workspace#79 step 2)", () => {
  let studentprogressquestionsFindAllSpy: jest.SpyInstance;

  beforeEach(() => {
    // Same association-registration issue as report.business.ts: these
    // model classes are never initModel-ed against a live Sequelize
    // instance in a unit test, so no-op the association calls the method
    // (re-)declares on every invocation.
    jest.spyOn(levels, "hasMany").mockImplementation(() => undefined as never);
    jest.spyOn(levelquizquestions, "belongsTo").mockImplementation(() => undefined as never);
    jest.spyOn(lessons, "belongsTo").mockImplementation(() => undefined as never);
    jest.spyOn(levelquizquestions, "hasOne").mockImplementation(() => undefined as never);
    jest.spyOn(questions, "belongsTo").mockImplementation(() => undefined as never);

    jest.spyOn(studentprogress, "findOne").mockResolvedValue({ studentprogressid: "sp1" } as never);

    // Simulates a real (unscoped) row that DOES carry answer/servergrade —
    // proving the exclusion here is the business code's own mapping, not
    // an artifact of the DB-level defaultScope tested elsewhere.
    studentprogressquestionsFindAllSpy = jest.spyOn(studentprogressquestions, "findAll").mockResolvedValue([
      {
        referencequestionid: "lqq1",
        iscorrect: true,
        answer: { v: 1, type: "choice", selected: ["a"] },
        clientiscorrect: true,
        servergrade: "correct",
      },
    ] as never);

    jest.spyOn(levels, "findOne").mockResolvedValue({
      get: () => ({
        levelquizquestions: [
          {
            levelquizquestionid: "lqq1",
            levelquizquestionorder: 1,
            lesson: { lessonid: "l1", lessonname: "Lesson 1" },
          },
        ],
      }),
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns iscorrect but never answer or servergrade", async () => {
    const result = await new QuestionBusiness().getlevelquestionsanswers("level1", { studentid: "s1" } as never);

    expect(studentprogressquestionsFindAllSpy).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    const [row] = result;
    expect(row.iscorrect).toBe(true);
    expect(row).not.toHaveProperty("answer");
    expect(row).not.toHaveProperty("servergrade");
  });
});
