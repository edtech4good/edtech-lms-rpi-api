import { Op } from "sequelize";
import { lessons } from "src/models/data-models/lessons";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { lessonpracticequestions } from "src/models/data-models/lessonpracticequestions";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { students } from "src/models/data-models/students";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { studentprogress } from "src/models/data-models/studentprogress";
import { Progress } from "src/models/enums/progress.enum";
import { Token } from "src/models/token.model";
import { ActivityProgressBusiness } from "./activityprogress.business";

/**
 * Covers the #77-in-progress refactor: getlessonactivitiesprogress (per
 * lesson) and getlevelactivitiesprogress (per level, new here) now share
 * one batched query core (getactivitiesprogressforlessons) instead of each
 * lesson issuing its own findAll. Every model call is mocked — this is a
 * pure grouping/shaping test, not a DB integration test (that's the
 * real-DB cross-check run separately against a live server).
 */

jest.mock("src/models/data-models/lessons");
jest.mock("src/models/data-models/lessonlearnings");
jest.mock("src/models/data-models/lessonpractices");
jest.mock("src/models/data-models/lessonpracticequestions");
jest.mock("src/models/data-models/lessonquizquestions");
jest.mock("src/models/data-models/lessonquizzes");
jest.mock("src/models/data-models/students");
jest.mock("src/models/data-models/studentlearningprogress");
jest.mock("src/models/data-models/studentprogress");

const user = { schooluserid: "school-u1", studentfirstname: "Sophea" } as Token;
const STUDENTID = "student-1";

const mockedLessons = lessons as unknown as { findAll: jest.Mock };
const mockedLearnings = lessonlearnings as unknown as { findAll: jest.Mock };
const mockedPractices = lessonpractices as unknown as { findAll: jest.Mock };
const mockedPracticeQuestions = lessonpracticequestions as unknown as { findAll: jest.Mock };
const mockedQuizQuestions = lessonquizquestions as unknown as { findAll: jest.Mock };
const mockedQuizzes = lessonquizzes as unknown as { findAll: jest.Mock };
const mockedLearningProgress = studentlearningprogress as unknown as { findAll: jest.Mock };
const mockedStudentProgress = studentprogress as unknown as { findAll: jest.Mock };
const mockedStudents = students as unknown as { findOne: jest.Mock };

beforeEach(() => {
  // Backs LessonBusiness.getstudent, which every entry point below calls
  // first (students.findOne({ where: { schooluserid } })).
  mockedStudents.findOne.mockResolvedValue({ studentid: STUDENTID });
});

afterEach(() => {
  jest.clearAllMocks();
});

/**
 * Two lessons (A, B) each with one learning, one practice, one quiz.
 * Lesson A's quiz has one passing attempt; lesson B's quiz has none —
 * this is the fixture the "no cross-lesson leakage" test below depends on.
 */
const setupTwoLessonFixture = () => {
  mockedLessons.findAll.mockResolvedValue([
    { lessonid: "lesson-a", lessonorder: 1 },
    { lessonid: "lesson-b", lessonorder: 2 },
  ]);
  mockedLearnings.findAll.mockResolvedValue([
    { lessonlearningid: "learning-a", lessonid: "lesson-a" },
    { lessonlearningid: "learning-b", lessonid: "lesson-b" },
  ]);
  mockedPractices.findAll.mockResolvedValue([
    { lessonpracticeid: "practice-a", lessonid: "lesson-a" },
    { lessonpracticeid: "practice-b", lessonid: "lesson-b" },
  ]);
  mockedQuizzes.findAll.mockResolvedValue([
    { lessonquizid: "quiz-a", lessonid: "lesson-a" },
    { lessonquizid: "quiz-b", lessonid: "lesson-b" },
  ]);
  mockedLearningProgress.findAll.mockResolvedValue([
    { lessonlearningid: "learning-a", viewed: 1, progress_percentage: 100 },
  ]);
  mockedStudentProgress.findAll.mockImplementation(({ where }) => {
    if (where.progresstype === Progress.LESSONQUIZ) {
      // Only lesson A's quiz has an attempt, and it's a pass.
      return Promise.resolve([
        { studentprogressreferenceid: "quiz-a", resultpercentage: 90 },
      ]);
    }
    if (where.progresstype === Progress.LESSONPRACTICE) {
      return Promise.resolve([
        { studentprogressreferenceid: "practice-a", marks: 2 },
      ]);
    }
    return Promise.resolve([]);
  });
  mockedQuizQuestions.findAll.mockResolvedValue([
    { lessonquizid: "quiz-a" },
    { lessonquizid: "quiz-b" },
  ]);
  mockedPracticeQuestions.findAll.mockResolvedValue([
    { lessonpracticeid: "practice-a" },
    { lessonpracticeid: "practice-b" },
  ]);
};

describe("ActivityProgressBusiness.getlevelactivitiesprogress", () => {
  it("groups every lesson's items under that lesson, in lessonorder", async () => {
    setupTwoLessonFixture();

    const result = await new ActivityProgressBusiness().getlevelactivitiesprogress(
      "level-1",
      user
    );

    expect(result.levelid).toBe("level-1");
    expect(result.pass_percentage).toBe(80);
    expect(result.lessons).toHaveLength(2);
    expect(result.lessons[0]).toMatchObject({ lessonid: "lesson-a", lessonorder: 1 });
    expect(result.lessons[1]).toMatchObject({ lessonid: "lesson-b", lessonorder: 2 });

    // Each lesson only ever sees its own item ids.
    expect(result.lessons[0].learnings.map((l) => l.lessonlearningid)).toEqual([
      "learning-a",
    ]);
    expect(result.lessons[1].learnings.map((l) => l.lessonlearningid)).toEqual([
      "learning-b",
    ]);
  });

  it("does not leak an attempt on lesson A's quiz into lesson B's quiz", async () => {
    setupTwoLessonFixture();

    const result = await new ActivityProgressBusiness().getlevelactivitiesprogress(
      "level-1",
      user
    );

    const [lessonA, lessonB] = result.lessons;
    expect(lessonA.quizzes).toEqual([
      {
        lessonquizid: "quiz-a",
        status: "done",
        attempts: 1,
        best_percentage: 90,
        question_count: 1,
      },
    ]);
    // Lesson B's quiz must stay untouched by lesson A's attempt: zero
    // attempts, "todo", not "done".
    expect(lessonB.quizzes).toEqual([
      {
        lessonquizid: "quiz-b",
        status: "todo",
        attempts: 0,
        best_percentage: null,
        question_count: 1,
      },
    ]);
  });

  it("issues one batched query per item type regardless of lesson count", async () => {
    setupTwoLessonFixture();

    await new ActivityProgressBusiness().getlevelactivitiesprogress("level-1", user);

    // Batched: exactly one findAll call per model, never one per lesson.
    expect(mockedLearnings.findAll).toHaveBeenCalledTimes(1);
    expect(mockedPractices.findAll).toHaveBeenCalledTimes(1);
    expect(mockedQuizzes.findAll).toHaveBeenCalledTimes(1);
  });

  it("returns lessons: [] for a level with no active lessons, without querying activity models", async () => {
    mockedLessons.findAll.mockResolvedValue([]);

    const result = await new ActivityProgressBusiness().getlevelactivitiesprogress(
      "empty-level",
      user
    );

    expect(result).toMatchObject({ levelid: "empty-level", pass_percentage: 80, lessons: [] });
    expect(mockedLearnings.findAll).not.toHaveBeenCalled();
    expect(mockedPractices.findAll).not.toHaveBeenCalled();
    expect(mockedQuizzes.findAll).not.toHaveBeenCalled();
  });

  it("queries lessons by levelid + lessonstatus true + isdeleted false, ordered by lessonorder ASC", async () => {
    setupTwoLessonFixture();

    await new ActivityProgressBusiness().getlevelactivitiesprogress("level-1", user);

    expect(mockedLessons.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { levelid: "level-1", lessonstatus: true, isdeleted: false },
        order: [["lessonorder", "ASC"]],
      })
    );
  });

  it("queries every item type with lessonid Op.in set to exactly the level's lesson ids", async () => {
    setupTwoLessonFixture();

    await new ActivityProgressBusiness().getlevelactivitiesprogress("level-1", user);

    const expectedWhere = (extra: Record<string, unknown>) =>
      expect.objectContaining({
        where: expect.objectContaining({
          lessonid: { [Op.in]: ["lesson-a", "lesson-b"] },
          ...extra,
        }),
      });

    expect(mockedLearnings.findAll).toHaveBeenCalledWith(
      expectedWhere({ lessonlearningstatus: true })
    );
    expect(mockedPractices.findAll).toHaveBeenCalledWith(
      expectedWhere({ lessonpracticestatus: true })
    );
    expect(mockedQuizzes.findAll).toHaveBeenCalledWith(
      expectedWhere({ lessonquizstatus: true })
    );
  });

  /**
   * Several items per type, interleaved across lessons in the order the DB
   * could plausibly return them (A1, B1, A2, ...) instead of the earlier
   * fixture's tidy one-per-lesson layout. Proves the by-lessonid grouping
   * in getactivitiesprogressforlessons doesn't depend on rows arriving
   * pre-sorted by lesson, and that each lesson keeps its own items in the
   * order buildXprogress produced them (which mirrors the *order* returned
   * by findAll, i.e. lessonlearningorder/lessonpracticeorder/lessonquizorder
   * ASC — not grouped by lesson at the DB level).
   */
  it("groups interleaved rows per-lesson and preserves each lesson's own item order", async () => {
    mockedLessons.findAll.mockResolvedValue([
      { lessonid: "lesson-a", lessonorder: 1 },
      { lessonid: "lesson-b", lessonorder: 2 },
    ]);
    // Interleaved: A1, B1, A2 for every activity type.
    mockedLearnings.findAll.mockResolvedValue([
      { lessonlearningid: "learning-a1", lessonid: "lesson-a" },
      { lessonlearningid: "learning-b1", lessonid: "lesson-b" },
      { lessonlearningid: "learning-a2", lessonid: "lesson-a" },
    ]);
    mockedPractices.findAll.mockResolvedValue([
      { lessonpracticeid: "practice-a1", lessonid: "lesson-a" },
      { lessonpracticeid: "practice-b1", lessonid: "lesson-b" },
      { lessonpracticeid: "practice-a2", lessonid: "lesson-a" },
    ]);
    mockedQuizzes.findAll.mockResolvedValue([
      { lessonquizid: "quiz-a1", lessonid: "lesson-a" },
      { lessonquizid: "quiz-b1", lessonid: "lesson-b" },
      { lessonquizid: "quiz-a2", lessonid: "lesson-a" },
    ]);
    mockedLearningProgress.findAll.mockResolvedValue([]);
    mockedStudentProgress.findAll.mockResolvedValue([]);
    mockedQuizQuestions.findAll.mockResolvedValue([]);
    mockedPracticeQuestions.findAll.mockResolvedValue([]);

    const result = await new ActivityProgressBusiness().getlevelactivitiesprogress(
      "level-1",
      user
    );

    const [lessonA, lessonB] = result.lessons;

    expect(lessonA.learnings.map((l) => l.lessonlearningid)).toEqual([
      "learning-a1",
      "learning-a2",
    ]);
    expect(lessonB.learnings.map((l) => l.lessonlearningid)).toEqual(["learning-b1"]);

    expect(lessonA.practices.map((p) => p.lessonpracticeid)).toEqual([
      "practice-a1",
      "practice-a2",
    ]);
    expect(lessonB.practices.map((p) => p.lessonpracticeid)).toEqual(["practice-b1"]);

    expect(lessonA.quizzes.map((q) => q.lessonquizid)).toEqual(["quiz-a1", "quiz-a2"]);
    expect(lessonB.quizzes.map((q) => q.lessonquizid)).toEqual(["quiz-b1"]);
  });
});

/**
 * True refactor-parity proof (old per-lesson implementation vs. this
 * batched one) is run live against two servers — see the mutation/parity
 * report handed back with this change. It is not re-derived here: a unit
 * test that runs the NEW code against itself under two different entry
 * points cannot detect a behavior change the refactor itself introduced,
 * only an inconsistency between the two entry points. The grouping,
 * ordering, filter and no-cross-lesson-leakage tests above are what a unit
 * suite can actually prove; the live A/B run against origin/feat/activity-progress
 * (port 3003) and this branch (port 3007) is what proves parity with the
 * pre-refactor behavior.
 */
describe("ActivityProgressBusiness.getlessonactivitiesprogress (single-lesson entry point)", () => {
  it("is the shared batched core scoped to one lesson, in the same shape as the level entry point", async () => {
    setupTwoLessonFixture();

    const lessonResult = await new ActivityProgressBusiness().getlessonactivitiesprogress(
      "lesson-a",
      user
    );

    expect(lessonResult).toEqual({
      lessonid: "lesson-a",
      pass_percentage: 80,
      learnings: [
        { lessonlearningid: "learning-a", status: "done", progress_percentage: 100 },
      ],
      practices: [
        {
          lessonpracticeid: "practice-a",
          status: "done",
          attempts: 1,
          best_percentage: 100,
          question_count: 1,
        },
      ],
      quizzes: [
        {
          lessonquizid: "quiz-a",
          status: "done",
          attempts: 1,
          best_percentage: 90,
          question_count: 1,
        },
      ],
    });
  });
});
