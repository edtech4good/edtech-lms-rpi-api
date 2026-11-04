import { randomUUID } from "node:crypto";
import { Config } from "src/config";
import { LessonBusiness } from "src/business/lesson.business";
import { initModels } from "src/models/data-models/init-models";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { curriculums } from "src/models/data-models/curriculums";
import { grades } from "src/models/data-models/grades";
import { levels } from "src/models/data-models/levels";
import { lessons } from "src/models/data-models/lessons";
import { lessonlearnings } from "src/models/data-models/lessonlearnings";
import { lessonquizzes } from "src/models/data-models/lessonquizzes";
import { lessonquizquestions } from "src/models/data-models/lessonquizquestions";
import { questions } from "src/models/data-models/questions";
import { studentprogress } from "src/models/data-models/studentprogress";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { dbinstance } from "src/services/dbservice";
import { ResultController } from "./result.controller";

/**
 * The per-organisation rule "a lesson quiz that does not pass earns no points"
 * (organisations.settingsconfig.requireLessonQuizPass), through the real
 * ResultController.savelessonquizresult, the real business classes and a real MySQL schema.
 *
 * This spec writes rows, so it runs ONLY when QUIZ_PASS_DB_SPEC=1 is set AND the configured database
 * name contains "_scratch_" (a throwaway database built by the migrations). Anywhere else (CI, a
 * developer's own database) the whole file is skipped. Every row it creates carries a generated id and is
 * removed again in afterAll.
 *
 * Content: one level of one grade, three lessons.
 *   A  learning 20 + quiz 40, pass mark 60 (total 60)
 *   B  quiz 40 only, pass mark 40 (total 40)
 *   C  learning 40 + quiz 20, pass mark 40 (total 60), for the documented limit
 * Each quiz has two active questions, so one correct answer is 50% (fail) and two are 100% (pass, the
 * pass line being 80%).
 */
const dbname = Config.fortyk.api.rpi.database.name;
const enabled = process.env.QUIZ_PASS_DB_SPEC === "1" && /_scratch_/.test(dbname);
const suite = enabled ? describe : describe.skip;

const ids = {
  curriculum: randomUUID(),
  grade: randomUUID(),
  level: randomUUID(),
  lessonA: randomUUID(),
  lessonB: randomUUID(),
  lessonC: randomUUID(),
  learningA: randomUUID(),
  learningC: randomUUID(),
  quizA: randomUUID(),
  quizB: randomUUID(),
  quizC: randomUUID(),
  q1: randomUUID(),
  q2: randomUUID(),
};
const orgIds: string[] = [];
const schoolIds: string[] = [];
const learnerIds: string[] = [];
const schoolUserIds: string[] = [];
const quizQuestionIds: Record<string, [string, string]> = {};

type Learner = { studentid: string; schooluserid: string; schoolid: string; organisationid: string; studentfirstname: string };

const sql = async (query: string, replacements: Record<string, unknown> = {}) =>
  dbinstance.getdbinstance().query(query, { replacements });

const makeOrg = async (settingsconfig: unknown): Promise<string> => {
  const organisationid = randomUUID();
  orgIds.push(organisationid);
  await organisations.create({
    organisationid,
    organisationname: `Org ${organisationid.slice(0, 8)}`,
    organisationcode: organisationid.slice(0, 12),
    organisationstatus: true,
    uitheme: "default",
    settingsconfig: settingsconfig as object | null,
    isdeleted: false,
  } as never);
  return organisationid;
};

const makeLearner = async (organisationid: string): Promise<Learner> => {
  const schoolid = randomUUID();
  const schooluserid = randomUUID();
  const studentid = randomUUID();
  schoolIds.push(schoolid);
  schoolUserIds.push(schooluserid);
  learnerIds.push(studentid);
  await schools.create({ schoolid, schoolname: `School ${schoolid.slice(0, 8)}`, curriculums: [ids.curriculum], organisationid } as never);
  await schoolusers.create({
    schooluserid,
    schoolusername: `u${schooluserid.slice(0, 12)}`,
    schooluserpasswordhash: "x",
    schooluserrole: SchoolRole.STUDENT,
    schoolname: "Fixture school",
    schoolid,
  } as never);
  await students.create({
    studentid,
    studentfirstname: "សុភា",
    genderid: 1,
    city: "c",
    country: "k",
    state: "s",
    curriculumid: ids.curriculum,
    schooluserid,
    schoolid,
  } as never);
  return { studentid, schooluserid, schoolid, organisationid, studentfirstname: "សុភា" };
};

let clock = Date.UTC(2026, 10, 1, 8, 0, 0);
const nextTime = () => new Date((clock += 60_000));

const submitQuiz = (learner: Learner, quizid: string, correct: 0 | 1 | 2, starttime: Date = nextTime()) => {
  const [a, b] = quizQuestionIds[quizid];
  return new ResultController().savelessonquizresult(
    quizid,
    {
      result: [a, b].map((lessonquizquestionid, i) => ({
        lessonquizid: quizid,
        lessonquizquestionid,
        questionid: i === 0 ? ids.q1 : ids.q2,
        iscorrect: i < correct,
        tries: 1,
      })),
      starttime,
      endtime: new Date(starttime.getTime() + 1000),
    } as never,
    learner as never,
  );
};

const watch = (learner: Learner, lessonlearningid: string) =>
  new LessonBusiness().updatelearningprogress(lessonlearningid, { content_length: 0, time: 0, ended: true, date: nextTime() }, learner as never);

const attempts = async (learner: Learner, quizid: string) => {
  const rows = await studentprogress.findAll({
    where: { studentid: learner.studentid, studentprogressreferenceid: quizid },
    order: [["starttime", "ASC"]],
    raw: true,
  });
  return rows.map((r) => ({ points: r.points, ispass: Boolean(r.ispass), pct: Number(r.resultpercentage) }));
};

const totals = async (learner: Learner, lessonid: string) => {
  const lesson = await studentlessonsprogress.findOne({ where: { studentid: learner.studentid, lessonid }, raw: true });
  const level = await studentlevelsprogress.findOne({ where: { studentid: learner.studentid, levelid: ids.level }, raw: true });
  const grade = await studentgradesprogress.findOne({ where: { studentid: learner.studentid, gradeid: ids.grade }, raw: true });
  return {
    lesson: lesson ? lesson.points : null,
    completed: lesson ? Boolean(lesson.completed) : null,
    level: level ? level.points : null,
    grade: grade ? grade.points : null,
  };
};

suite("savelessonquizresult with requireLessonQuizPass (real controller, scratch database)", () => {
  let on: string;

  beforeAll(async () => {
    (dbinstance.getdbinstance() as unknown as { options: { logging: unknown } }).options.logging = false;
    initModels(dbinstance.getdbinstance());
    await curriculums.create({ curriculumid: ids.curriculum, curriculumname: "Rule curriculum", organisationid: await makeOrg(null) } as never);
    await grades.create({ gradeid: ids.grade, curriculumid: ids.curriculum, gradename: "G", gradeorder: 1, points: 160, passing_points: 100, gradestatus: true, isdeleted: false } as never);
    await levels.create({ levelid: ids.level, gradeid: ids.grade, levelname: "L", points: 160, passing_points: 100, levelstatus: true, isdeleted: false } as never);
    const lesson = (lessonid: string, name: string, learning: number, quiz: number, pass: number) =>
      lessons.create({
        lessonid,
        levelid: ids.level,
        lessonname: name,
        learning_points: learning,
        practices_points: 0,
        quizzes_points: quiz,
        total_points: learning + quiz,
        passing_points: pass,
        lessonstatus: true,
        isdeleted: false,
      } as never);
    await lesson(ids.lessonA, "A", 20, 40, 60);
    await lesson(ids.lessonB, "B", 0, 40, 40);
    await lesson(ids.lessonC, "C", 40, 20, 40);
    const learning = (lessonlearningid: string, lessonid: string, points: number) =>
      lessonlearnings.create({ lessonlearningid, lessonlearningname: "item", lessonlearningdescription: "d", lessonid, lessonlearningorder: 1, lessonlearningstatus: true, points } as never);
    await learning(ids.learningA, ids.lessonA, 20);
    await learning(ids.learningC, ids.lessonC, 40);
    for (const [quizid, lessonid, points] of [[ids.quizA, ids.lessonA, 40], [ids.quizB, ids.lessonB, 40], [ids.quizC, ids.lessonC, 20]] as const) {
      await lessonquizzes.create({ lessonquizid: quizid, lessonid, lessonquizorder: 1, lessonquizname: "q", lessonquizdescription: "d", lessonquizstatus: true, points } as never);
    }
    for (const questionid of [ids.q1, ids.q2]) {
      await questions.create({ questionid, templatetypeid: 1, questioncorrectvalue: 1, questionidentifier: `qi-${questionid.slice(0, 8)}`, questionstatus: true, isdeleted: false, organisationid: orgIds[0] } as never);
    }
    for (const quizid of [ids.quizA, ids.quizB, ids.quizC]) {
      const pair: [string, string] = [randomUUID(), randomUUID()];
      quizQuestionIds[quizid] = pair;
      await lessonquizquestions.create({ lessonquizquestionid: pair[0], lessonquizid: quizid, questionid: ids.q1, lessonquizquestionstatus: true, lessonquizquestionorder: 1 } as never);
      await lessonquizquestions.create({ lessonquizquestionid: pair[1], lessonquizid: quizid, questionid: ids.q2, lessonquizquestionstatus: true, lessonquizquestionorder: 2 } as never);
    }
    on = await makeOrg({ requireLessonQuizPass: true });
  });

  afterAll(async () => {
    const q = (table: string, column: string, values: string[]) => (values.length ? sql(`DELETE FROM ${table} WHERE ${column} IN (:v)`, { v: values }) : Promise.resolve());
    const progressIds = (await sql("SELECT studentprogressid FROM studentprogress WHERE studentid IN (:v)", { v: learnerIds.length ? learnerIds : [""] }))[0] as { studentprogressid: string }[];
    await q("studentprogressquestions", "studentprogressid", progressIds.map((r) => r.studentprogressid));
    for (const table of ["studentprogress", "studentactives", "studentpoints", "studentlearningsprogress", "studentlessonsprogress", "studentlevelsprogress", "studentgradesprogress", "students"]) {
      await q(table, "studentid", learnerIds);
    }
    await q("schoolusers", "schooluserid", schoolUserIds);
    await q("schools", "schoolid", schoolIds);
    await q("lessonquizquestions", "lessonquizid", [ids.quizA, ids.quizB, ids.quizC]);
    await q("questions", "questionid", [ids.q1, ids.q2]);
    await q("lessonquizzes", "lessonquizid", [ids.quizA, ids.quizB, ids.quizC]);
    await q("lessonlearnings", "lessonlearningid", [ids.learningA, ids.learningC]);
    await q("lessons", "lessonid", [ids.lessonA, ids.lessonB, ids.lessonC]);
    await q("levels", "levelid", [ids.level]);
    await q("grades", "gradeid", [ids.grade]);
    await q("curriculums", "curriculumid", [ids.curriculum]);
    await q("organisations", "organisationid", orgIds);
    // check that the cleanup worked: nothing of ours is left
    const left = (await sql("SELECT (SELECT COUNT(*) FROM studentprogress WHERE studentid IN (:l)) a, (SELECT COUNT(*) FROM organisations WHERE organisationid IN (:o)) b, (SELECT COUNT(*) FROM lessons WHERE lessonid IN (:x)) c", {
      l: learnerIds.length ? learnerIds : [""],
      o: orgIds,
      x: [ids.lessonA, ids.lessonB, ids.lessonC],
    }))[0] as { a: number; b: number; c: number }[];
    expect(left[0]).toEqual({ a: 0, b: 0, c: 0 });
    await dbinstance.getdbinstance().close();
  });

  describe("with the setting on", () => {
    it("a failed attempt is saved with its real percentage and 0 points, the lesson is not completed and level and grade do not rise", async () => {
      const learner = await makeLearner(on);
      await submitQuiz(learner, ids.quizB, 1);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 0, ispass: false, pct: 50 }]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
    });

    it("an all-wrong attempt is saved at 0 percent with 0 points", async () => {
      const learner = await makeLearner(on);
      await submitQuiz(learner, ids.quizB, 0);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 0, ispass: false, pct: 0 }]);
    });

    it("two failed attempts in a row still earn 0 and the lesson is not completed", async () => {
      const learner = await makeLearner(on);
      await submitQuiz(learner, ids.quizB, 1);
      await submitQuiz(learner, ids.quizB, 0);
      expect(await attempts(learner, ids.quizB)).toEqual([
        { points: 0, ispass: false, pct: 50 },
        { points: 0, ispass: false, pct: 0 },
      ]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
    });

    it("a failed attempt then a pass earns the quiz's points once and completes the lesson at the pass mark", async () => {
      const learner = await makeLearner(on);
      await watch(learner, ids.learningA);
      expect(await totals(learner, ids.lessonA)).toEqual({ lesson: 20, completed: false, level: 20, grade: 20 });
      await submitQuiz(learner, ids.quizA, 1);
      expect(await totals(learner, ids.lessonA)).toEqual({ lesson: 20, completed: false, level: 20, grade: 20 });
      await submitQuiz(learner, ids.quizA, 2);
      expect(await attempts(learner, ids.quizA)).toEqual([
        { points: 0, ispass: false, pct: 50 },
        { points: 40, ispass: true, pct: 100 },
      ]);
      expect(await totals(learner, ids.lessonA)).toEqual({ lesson: 60, completed: true, level: 60, grade: 60 });
    });

    it("several failed attempts then a pass still add the quiz's points exactly once", async () => {
      const learner = await makeLearner(on);
      await submitQuiz(learner, ids.quizB, 0);
      await submitQuiz(learner, ids.quizB, 1);
      await submitQuiz(learner, ids.quizB, 0);
      await submitQuiz(learner, ids.quizB, 2);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });

    it("a pass on the first attempt behaves as before", async () => {
      const learner = await makeLearner(on);
      await submitQuiz(learner, ids.quizB, 2);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: true, pct: 100 }]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });

    it("a submission after a pass changes nothing: no new row and no extra points", async () => {
      const learner = await makeLearner(on);
      await submitQuiz(learner, ids.quizB, 2);
      await submitQuiz(learner, ids.quizB, 0);
      await submitQuiz(learner, ids.quizB, 2);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: true, pct: 100 }]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });

    it("a replay of the same failed submission (same start time) adds no row and changes nothing", async () => {
      const learner = await makeLearner(on);
      const starttime = nextTime();
      await submitQuiz(learner, ids.quizB, 1, starttime);
      const before = { attempts: await attempts(learner, ids.quizB), totals: await totals(learner, ids.lessonB) };
      await submitQuiz(learner, ids.quizB, 1, starttime);
      expect({ attempts: await attempts(learner, ids.quizB), totals: await totals(learner, ids.lessonB) }).toEqual(before);
      expect(before.attempts).toHaveLength(1);
    });

    it("a replay of a failed submission, with a pass after it, still adds the quiz's points once", async () => {
      const learner = await makeLearner(on);
      const starttime = nextTime();
      await submitQuiz(learner, ids.quizB, 1, starttime);
      await submitQuiz(learner, ids.quizB, 1, starttime);
      await submitQuiz(learner, ids.quizB, 2);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });

    it("a lesson with no practice (learning 20, quiz 40, pass mark 60): a failed quiz after the learning leaves 20 points and not completed", async () => {
      const learner = await makeLearner(on);
      await watch(learner, ids.learningA);
      await submitQuiz(learner, ids.quizA, 0);
      expect(await totals(learner, ids.lessonA)).toEqual({ lesson: 20, completed: false, level: 20, grade: 20 });
    });

    it("documented limit: a lesson whose other activities already reach the pass mark completes without a passing quiz", async () => {
      const learner = await makeLearner(on);
      await watch(learner, ids.learningC);
      await submitQuiz(learner, ids.quizC, 0);
      expect(await attempts(learner, ids.quizC)).toEqual([{ points: 0, ispass: false, pct: 0 }]);
      expect(await totals(learner, ids.lessonC)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });

    it("a failed attempt left from before the setting was on (holding 40 points): the next failed attempt takes those points back, never below 0 and never twice", async () => {
      const before = await makeOrg(null);
      const learner = await makeLearner(before);
      await submitQuiz(learner, ids.quizB, 1); // setting off: a fail earns the full 40 points
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: false, pct: 50 }]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });

      await organisations.update({ settingsconfig: { requireLessonQuizPass: true } } as never, { where: { organisationid: before } });
      await submitQuiz(learner, ids.quizB, 1); // setting on: the new fail earns 0
      expect(await attempts(learner, ids.quizB)).toEqual([
        { points: 40, ispass: false, pct: 50 },
        { points: 0, ispass: false, pct: 50 },
      ]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });

      await submitQuiz(learner, ids.quizB, 2); // and a later pass brings the quiz's points back exactly once
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });
  });

  describe("with the setting off or not strictly true, a failed attempt earns the full points as before", () => {
    const off: [string, unknown][] = [
      ["absent from a settings object", {}],
      ["no settings at all (null)", null],
      ["the string \"true\"", { requireLessonQuizPass: "true" }],
      ["the number 1", { requireLessonQuizPass: 1 }],
      ["false", { requireLessonQuizPass: false }],
      ["null", { requireLessonQuizPass: null }],
      ["a settings value that is not an object", "not an object"],
      ["a settings value that is a list", [true]],
    ];
    it.each(off)("setting %s", async (_name, settingsconfig) => {
      const learner = await makeLearner(await makeOrg(settingsconfig));
      await submitQuiz(learner, ids.quizB, 1);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: false, pct: 50 }]);
      expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    });

    it("a learner whose token carries no organisation is scored as before", async () => {
      const learner = await makeLearner(await makeOrg({ requireLessonQuizPass: true }));
      await submitQuiz({ ...learner, organisationid: undefined as never }, ids.quizB, 1);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: false, pct: 50 }]);
    });

    it("a token naming an organisation that has no row is scored as before", async () => {
      const learner = await makeLearner(await makeOrg(null));
      await submitQuiz({ ...learner, organisationid: randomUUID() }, ids.quizB, 1);
      expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: false, pct: 50 }]);
    });
  });
});
