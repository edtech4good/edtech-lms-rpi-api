import { CurriculumBaseLineBusiness } from "src/business/curriculumbaseline.business";
import { LessonBusiness } from "src/business/lesson.business";
import { ResultBusiness } from "src/business/result.business";
import { baselinequestion, lessonpracticequestions, lessonquizquestions, levelquizquestions } from "src/models/data-models/init-models";
import { Logger } from "src/config";
import { ResultController } from "./result.controller";

/**
 * A result holds only answers to its own container's questions (organisations package 8, step 2).
 *
 * For each of the four containers (practice, lesson quiz, level quiz, baseline): a submission with one item for
 * a question of another container and one for a question that is the container's own stores only the second; a
 * switched-off question that is the container's own is kept; the score, pass mark, marks, points and verified flag
 * are exactly those of the same submission without the foreign item (scoring only ever counted the container's
 * active questions, so the dropped item never took part in it); the response is unchanged; and the dropped items
 * are counted in one log line that carries no ids.
 *
 * Only the database is faked (the container's rows, and the active questions with their grading data, by
 * whether the read joins the question).
 */
jest.mock("src/business/result.business");
jest.mock("src/business/lesson.business");
jest.mock("src/business/curriculumbaseline.business");

const MockedResultBusiness = ResultBusiness as jest.MockedClass<typeof ResultBusiness>;
const MockedLessonBusiness = LessonBusiness as jest.MockedClass<typeof LessonBusiness>;
const MockedBaseline = CurriculumBaseLineBusiness as jest.MockedClass<typeof CurriculumBaseLineBusiness>;

const OPTIONS = [
  { questionoptionid: "opt-1", questionoptiontext: "correct", questionoptioniscorrect: true, questionoptionsequence: 1 },
  { questionoptionid: "opt-2", questionoptiontext: "wrong", questionoptioniscorrect: false, questionoptionsequence: 2 },
];
const RIGHT = { v: 1, type: "choice", selected: ["opt-1"] };
const WRONG = { v: 1, type: "choice", selected: ["opt-2"] };
const JOINED = { templatetypeid: 1, questionoptions: OPTIONS };

const ACTIVE = ["own-1", "own-2"]; // the container's active questions
const OFF = "own-off"; // the container's own, but switched off: never scored, still the container's
const FOREIGN = "foreign-1"; // a question of another container
const FOREIGN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

interface Kind {
  name: string;
  idKey: string;
  model: unknown;
  containerKey: string;
  call: (items: any[], mode?: string) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  created: () => jest.Mock;
  /** the property on a joined row that carries the question */
  joined: "question" | "scorerquestion";
}
const user = { studentid: "s1", studentfirstname: "T", schooluserid: "u1" } as never;
const body = (items: unknown[], idKey: string, container: string) => ({
  result: items.map((x: any) => ({ ...x, questionid: x[idKey], [container]: "c1" })), // eslint-disable-line @typescript-eslint/no-explicit-any
  starttime: new Date("2026-10-04T10:00:00Z"),
  endtime: new Date("2026-10-04T10:05:00Z"),
}) as never;

let createpractice: jest.Mock, createquiz: jest.Mock, createlevel: jest.Mock, createbaseline: jest.Mock;
const KINDS: Kind[] = [
  { name: "lesson practice", idKey: "lessonpracticequestionid", model: lessonpracticequestions, containerKey: "lessonpracticeid", joined: "question",
    call: (items) => new ResultController().savelessonpracticeresult("c1", body(items, "lessonpracticequestionid", "lessonpracticeid"), user), created: () => createpractice },
  { name: "lesson quiz", idKey: "lessonquizquestionid", model: lessonquizquestions, containerKey: "lessonquizid", joined: "question",
    call: (items) => new ResultController().savelessonquizresult("c1", body(items, "lessonquizquestionid", "lessonquizid"), user), created: () => createquiz },
  { name: "level quiz", idKey: "levelquizquestionid", model: levelquizquestions, containerKey: "levelid", joined: "question",
    call: (items) => new ResultController().savelevelquizresult("c1", body(items, "levelquizquestionid", "levelid"), user), created: () => createlevel },
  { name: "baseline", idKey: "baselinequestionid", model: baselinequestion, containerKey: "curriculumbaselineid", joined: "scorerquestion",
    call: (items) => new ResultController().savebaselineresult("c1", body(items, "baselinequestionid", "curriculumbaselineid"), user), created: () => createbaseline },
];

describe("POST /result/...: a result keeps only the items that answer one of its container's questions", () => {
  let info: jest.SpyInstance;
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
    info = jest.spyOn(Logger, "info").mockImplementation((() => undefined) as never);
    createpractice = jest.fn().mockResolvedValue(undefined);
    createquiz = jest.fn().mockResolvedValue(undefined);
    createlevel = jest.fn().mockResolvedValue(undefined);
    createbaseline = jest.fn().mockResolvedValue(undefined);
    const rb = MockedResultBusiness.prototype as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rb.ispass = jest.fn().mockResolvedValue(false);
    rb.createlessonpracticeprogress = createpractice;
    rb.createlessonquizprogress = createquiz;
    rb.createlevelquizprogress = createlevel;
    rb.createbaselinequestionprogress = createbaseline;
    const lb = MockedLessonBusiness.prototype as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    lb.calculatePracticeScore = jest.fn().mockResolvedValue({ marks: 999, userpoints: 10, fullpoints: 10, lesson: { lessonid: "l1" } });
    lb.calculateQuizScore = jest.fn().mockResolvedValue({ marks: 999, userpoints: 10, fullpoints: 10, lesson: { lessonid: "l1" } });
    lb.calculateLevelQuizScore = jest.fn().mockResolvedValue({ marks: 999, userpoints: 10, fullpoints: 10, level: { levelid: "lv1" } });
    (MockedBaseline.prototype as any).calculateBaselineQuestionScore = jest.fn().mockResolvedValue({ userpoints: 0, fullpoints: 0, baseline: {} }); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const k of KINDS) {
      spies.push(
        jest.spyOn(k.model as typeof lessonquizquestions, "findAll").mockImplementation(((options: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          if (options?.include) {
            // the scorer's and the grader's read: the active, renderable questions, with the question joined
            return Promise.resolve(ACTIVE.map((id) => ({ [k.idKey]: id, [k.joined]: JOINED })));
          }
          // the container's own rows, whatever their status (no join, no status condition)
          expect(Object.keys(options.where)).toEqual([k.containerKey]);
          return Promise.resolve([...ACTIVE, OFF].map((id) => ({ [k.idKey]: id })));
        }) as never),
      );
    }
  });
  afterEach(() => {
    spies.length = 0;
    jest.restoreAllMocks();
    delete process.env.GRADING_MODE;
    delete process.env.REQUIRE_GRADED_ANSWERS;
  });

  const own = (k: Kind) => [
    { iscorrect: true, [k.idKey]: "own-1", answer: RIGHT },
    { iscorrect: false, [k.idKey]: "own-2", answer: WRONG },
    { iscorrect: true, [k.idKey]: OFF, answer: RIGHT },
  ];
  const foreign = (k: Kind) => ({ iscorrect: true, [k.idKey]: FOREIGN, answer: RIGHT });
  const stored = (k: Kind) => JSON.parse(k.created().mock.calls[0][0].actualanswers) as Array<Record<string, unknown>>;
  const withoutAnswers = (progress: Record<string, unknown>) => {
    const { actualanswers, ...rest } = progress;
    return rest;
  };

  describe.each(KINDS)("$name", (k) => {
    for (const mode of ["shadow", "enforce"]) {
      it(`${mode}: a foreign item is not stored, the container's own items (switched off ones too) are, in order`, async () => {
        process.env.GRADING_MODE = mode;
        await k.call([own(k)[0], foreign(k), own(k)[1], own(k)[2]]);
        expect(stored(k).map((x) => x[k.idKey])).toEqual(["own-1", "own-2", OFF]);
        expect(JSON.stringify(stored(k))).not.toContain(FOREIGN);
      });

      it(`${mode}: the score, pass, marks, points and verified flag are those of the same result without the foreign item`, async () => {
        process.env.GRADING_MODE = mode;
        await k.call(own(k));
        await k.call([...own(k), foreign(k), { ...foreign(k), [k.idKey]: "foreign-2", iscorrect: true }]);
        const [without, withForeign] = k.created().mock.calls.map((c) => c[0]);
        expect(withoutAnswers(withForeign)).toEqual(withoutAnswers(without));
        // and it is a real score: one of the two active questions answered correctly
        expect(without.passpercentage).toBe(50);
        expect(without.ispass).toBe(false);
      });

      it(`${mode}: the stored answers are those of the same result without the foreign items`, async () => {
        process.env.GRADING_MODE = mode;
        await k.call(own(k));
        await k.call([...own(k), foreign(k), { ...foreign(k), [k.idKey]: "foreign-2", iscorrect: true }]);
        const [without, withForeign] = k.created().mock.calls.map((c) => c[0]);
        expect(JSON.parse(withForeign.actualanswers)).toEqual(JSON.parse(without.actualanswers));
      });
    }

    it("an item with no question id, or one that is not a string, is dropped too", async () => {
      await k.call([own(k)[0], { iscorrect: true, answer: RIGHT }, { iscorrect: true, [k.idKey]: 7 }]);
      expect(stored(k).map((x) => x[k.idKey])).toEqual(["own-1"]);
    });

    it("an id that differs from the container's only by case is not the container's", async () => {
      await k.call([own(k)[0], { iscorrect: true, [k.idKey]: "OWN-2", answer: RIGHT }]);
      expect(stored(k).map((x) => x[k.idKey])).toEqual(["own-1"]);
    });

    it("the response is the same with or without foreign items", async () => {
      const a = await k.call(own(k));
      const b = await k.call([...own(k), foreign(k)]);
      expect(b).toEqual(a);
      expect(b).toEqual({ data: true, error: false });
    });

    it("the dropped items are counted in one log line, with the route and the count and no ids", async () => {
      await k.call([...own(k), foreign(k), { ...foreign(k), [k.idKey]: FOREIGN_ID }]);
      const lines = info.mock.calls.filter((c) => String(c[0]).startsWith("result items outside the container were dropped"));
      expect(lines).toHaveLength(1);
      expect(lines[0][1]).toMatchObject({ submitted: 5, dropped: 2 });
      expect(JSON.stringify(lines[0])).not.toContain(FOREIGN);
      expect(JSON.stringify(lines[0])).not.toContain(FOREIGN_ID);
    });

    it("a result with no foreign item logs no drop line", async () => {
      await k.call(own(k));
      expect(info.mock.calls.filter((c) => String(c[0]).startsWith("result items outside"))).toHaveLength(0);
    });

    it("a result of only foreign items stores no answer rows (and still scores 0 of the container's questions)", async () => {
      await k.call([foreign(k)]);
      expect(stored(k)).toEqual([]);
      expect(k.created().mock.calls[0][0].passpercentage).toBe(0);
    });
  });
});
