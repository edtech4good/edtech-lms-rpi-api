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
import { ResultController } from "src/modules/result/result.controller";
import * as mysql from "mysql2/promise";
import * as rules from "src/business/progress-rules";

/**
 * The lesson quiz recalculation script (scripts/lib/lesson-quiz-recalc.js, run by scripts/recalc-lesson-quiz-points.js)
 * against a real MySQL schema. Learners are put in the state a failed attempt left before the rule existed by submitting
 * through the real ResultController and LessonBusiness with the setting off; the setting is then switched on and the script run.
 *
 * Writes rows, so it runs ONLY when QUIZ_PASS_DB_SPEC=1 is set AND the configured database name contains "_scratch_".
 * Every row it creates carries a generated id and is removed in afterAll.
 *
 * Content: one level (160) of one grade (160), three lessons: A learning 20 + quiz 40 (pass mark 60), B quiz 40 (pass mark 40),
 * C learning 40 + quiz 20 (pass mark 40, total 60). Each quiz has two questions: one right is 50 percent (fail), two are 100 (pass).
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

const TABLES: [string, string][] = [
  ["studentprogress", "studentprogressid"],
  ["studentlessonsprogress", "studentlessonprogressid"],
  ["studentlevelsprogress", "studentlevelprogressid"],
  ["studentgradesprogress", "studentgradeprogressid"],
  ["studentlearningsprogress", "studentlearningprogressid"],
  ["studentpoints", "studentpointid"],
  ["studentactives", "studentactiveid"],
];

/** Every row of these tables for the given learners, as one string, so two dumps can be compared byte for byte. */
const dump = async (learners: Learner[]): Promise<string> => {
  const parts: unknown[] = [];
  for (const [table, pk] of TABLES) {
    const [rows] = await sql(`SELECT * FROM ${table} WHERE studentid IN (:v) ORDER BY ${pk}`, { v: learners.map((l) => l.studentid) });
    parts.push([table, rows]);
  }
  return JSON.stringify(parts);
};

const setting = (organisationid: string, value: unknown) =>
  organisations.update({ settingsconfig: value } as never, { where: { organisationid } });

const codeOf = (organisationid: string) => organisationid.slice(0, 12);

let connection: mysql.Connection;
type Outcome = { exitCode: number; lines: string[]; counts: Record<string, number> };
/** Runs the real script entry function on the scratch database. */
const recalc = async (organisationid: string, apply: boolean, over: Record<string, unknown> = {}): Promise<Outcome> => {
  const { run } = require("../../scripts/lib/lesson-quiz-recalc");
  const lines: string[] = [];
  const res = await run({
    conn: connection,
    organisationcode: codeOf(organisationid),
    apply,
    rules,
    countedPassNeedsVerified: false,
    ruleDeployed: true,
    dbname,
    out: (l: string) => lines.push(l),
    ...over,
  });
  return { exitCode: res.exitCode, lines, counts: res.counts };
};
const body = (o: Outcome) => o.lines.filter((l) => !/^recalc-lesson-quiz-points|^Dry run|^Applied|^Nothing to change/.test(l));

const rowOf = async (table: string, learner: Learner, extra = "") => {
  const [rows] = await sql(`SELECT points, progress, completed FROM ${table} WHERE studentid = :s ${extra}`, { s: learner.studentid });
  return (rows as { points: number; progress: number; completed: number }[])[0];
};
const levelRow = (l: Learner) => rowOf("studentlevelsprogress", l);
const gradeRow = (l: Learner) => rowOf("studentgradesprogress", l);

suite("lesson quiz recalculation (real script entry, scratch database)", () => {
  const pass = (l: Learner, quizid: string) => submitQuiz(l, quizid, 2);

  /** A learner of a fresh organisation with the setting OFF, to be switched on by the test. */
  const legacyLearner = async () => {
    const organisationid = await makeOrg(null);
    return { organisationid, learner: await makeLearner(organisationid) };
  };

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



  beforeAll(async () => {
    const d = Config.fortyk.api.rpi.database;
    connection = await mysql.createConnection({ host: d.host, port: d.port, user: d.user, password: d.password, database: d.name, charset: "utf8mb4" });
  });
  afterAll(async () => {
    await connection.end();
  });

  it("a failed attempt then a pass: the failed attempt goes to 0 points, the pass and every total stay, and a second apply changes nothing", async () => {
    const { organisationid, learner } = await legacyLearner();
    await submitQuiz(learner, ids.quizB, 1);
    await pass(learner, ids.quizB);
    expect(await attempts(learner, ids.quizB)).toEqual([{ points: 40, ispass: false, pct: 50 }, { points: 40, ispass: true, pct: 100 }]);
    await setting(organisationid, { requireLessonQuizPass: true });
    const before = await totals(learner, ids.lessonB);
    const out = await recalc(organisationid, true);
    expect(out.exitCode).toBe(0);
    expect(await attempts(learner, ids.quizB)).toEqual([{ points: 0, ispass: false, pct: 50 }, { points: 40, ispass: true, pct: 100 }]);
    expect(await totals(learner, ids.lessonB)).toEqual(before);
    expect(before).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    expect(out.counts).toMatchObject({ learners: 1, quizzes: 1, quizzesWithCountedPass: 1, attemptRowsToZero: 1, lessonsChanged: 0 });
    const afterFirst = await dump([learner]);
    const again = await recalc(organisationid, true);
    expect(again.lines).toContain("Nothing to change.");
    expect(await dump([learner])).toBe(afterFirst);
  });

  it("a failed attempt and no pass (a lesson with no practice): its points come off lesson, level and grade, the lesson is no longer completed, and the next pass earns once", async () => {
    const { organisationid, learner } = await legacyLearner();
    await submitQuiz(learner, ids.quizB, 1);
    await submitQuiz(learner, ids.quizB, 0);
    expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    await setting(organisationid, { requireLessonQuizPass: true });
    const out = await recalc(organisationid, true);
    expect(out.counts).toMatchObject({ quizzesWithoutPass: 1, attemptRowsToZero: 2, lessonsChanged: 1, levelsChanged: 1, gradesChanged: 1, lessonsCompletedToNot: 1 });
    expect(await attempts(learner, ids.quizB)).toEqual([{ points: 0, ispass: false, pct: 50 }, { points: 0, ispass: false, pct: 0 }]);
    expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
    expect(await levelRow(learner)).toMatchObject({ points: 0, progress: 0, completed: 0 });
    expect(await gradeRow(learner)).toMatchObject({ points: 0, progress: 0, completed: 0 });
    // after the run: a fail stays 0, a pass earns the quiz's points once, and a counted pass stays credited
    await submitQuiz(learner, ids.quizB, 1);
    expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
    await pass(learner, ids.quizB);
    expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    await pass(learner, ids.quizB);
    expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    expect(await rowOf("studentlessonsprogress", learner)).toMatchObject({ points: 40, completed: 1 });
    // and running the script again over that state changes nothing
    const state = await dump([learner]);
    expect((await recalc(organisationid, true)).lines).toContain("Nothing to change.");
    expect(await dump([learner])).toBe(state);
  });

  it("a lesson with a learning item: only the quiz's points come off, and progress and completed are recomputed", async () => {
    const { organisationid, learner } = await legacyLearner();
    await watch(learner, ids.learningA);
    await submitQuiz(learner, ids.quizA, 1);
    expect(await totals(learner, ids.lessonA)).toEqual({ lesson: 60, completed: true, level: 60, grade: 60 });
    await setting(organisationid, { requireLessonQuizPass: true });
    await recalc(organisationid, true);
    expect(await totals(learner, ids.lessonA)).toEqual({ lesson: 20, completed: false, level: 20, grade: 20 });
    const lesson = await rowOf("studentlessonsprogress", learner);
    expect(Number(lesson.progress)).toBe(33.33);
    expect(Number((await levelRow(learner)).progress)).toBe(12.5);
  });

  it("level and grade totals and their completed flags are exact", async () => {
    const { organisationid, learner } = await legacyLearner();
    await watch(learner, ids.learningA);
    await pass(learner, ids.quizA);
    await watch(learner, ids.learningC);
    await pass(learner, ids.quizC);
    await submitQuiz(learner, ids.quizB, 1);
    expect(await levelRow(learner)).toMatchObject({ points: 160, progress: 100, completed: 1 });
    expect(await gradeRow(learner)).toMatchObject({ points: 160, progress: 100, completed: 1 });
    await setting(organisationid, { requireLessonQuizPass: true });
    const out = await recalc(organisationid, true);
    expect(out.counts).toMatchObject({ levelsCompletedToNot: 1, gradesCompletedToNot: 1, lessonsCompletedToNot: 1 });
    expect(await levelRow(learner)).toMatchObject({ points: 120, progress: 75, completed: 0 });
    expect(await gradeRow(learner)).toMatchObject({ points: 120, progress: 75, completed: 0 });
    expect(await totals(learner, ids.lessonA)).toMatchObject({ lesson: 60, completed: true });
  });

  it("a lesson at its total cap: the failed quiz's points come off and the lesson stays completed when the rest reaches the pass mark", async () => {
    const { organisationid, learner } = await legacyLearner();
    await watch(learner, ids.learningC);
    await submitQuiz(learner, ids.quizC, 1);
    expect(await totals(learner, ids.lessonC)).toEqual({ lesson: 60, completed: true, level: 60, grade: 60 });
    await setting(organisationid, { requireLessonQuizPass: true });
    await recalc(organisationid, true);
    expect(await totals(learner, ids.lessonC)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
  });

  it("a total smaller than the credit is floored at 0, never negative, and counted", async () => {
    const { organisationid, learner } = await legacyLearner();
    await submitQuiz(learner, ids.quizB, 1);
    await sql("UPDATE studentlessonsprogress SET points = 10 WHERE studentid = :s", { s: learner.studentid });
    await sql("UPDATE studentgradesprogress SET points = 70 WHERE studentid = :s", { s: learner.studentid });
    await setting(organisationid, { requireLessonQuizPass: true });
    const out = await recalc(organisationid, true);
    expect(out.counts).toMatchObject({ lessonsAtFloor: 1, levelsAtFloor: 0, gradesAtFloor: 0 });
    expect(await totals(learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 30 });
  });

  it("practice and level quiz attempts are not touched, and neither is anything of an attempt but its points", async () => {
    const { organisationid, learner } = await legacyLearner();
    await submitQuiz(learner, ids.quizB, 1);
    const extra = (type: number) => sql(
      "INSERT INTO studentprogress (studentprogressid, studentid, ispass, studentprogressreferenceid, starttime, progresstype, resultpercentage, marks, points, fullpoints, scores, verified) VALUES (:id, :s, 0, :ref, '2026-11-01 07:00:00', :t, 33.5, 1, 25, 25, 2, 0)",
      { id: randomUUID(), s: learner.studentid, ref: randomUUID(), t: type },
    );
    await extra(1);
    await extra(3);
    await extra(4);
    const keep = async () => ((await sql("SELECT * FROM studentprogress WHERE studentid = :s AND progresstype <> 2 ORDER BY studentprogressid", { s: learner.studentid }))[0]);
    const kept = JSON.stringify(await keep());
    const [beforeRows] = await sql("SELECT resultpercentage, marks, scores, verified, ispass, starttime, fullpoints FROM studentprogress WHERE studentid = :s AND progresstype = 2", { s: learner.studentid });
    await setting(organisationid, { requireLessonQuizPass: true });
    await recalc(organisationid, true);
    expect(JSON.stringify(await keep())).toBe(kept);
    const [afterRows] = await sql("SELECT resultpercentage, marks, scores, verified, ispass, starttime, fullpoints FROM studentprogress WHERE studentid = :s AND progresstype = 2", { s: learner.studentid });
    expect(JSON.stringify(afterRows)).toBe(JSON.stringify(beforeRows));
  });

  it("another organisation's rows are byte-identical, whatever its setting", async () => {
    const mine = await legacyLearner();
    const other = await legacyLearner();
    for (const x of [mine, other]) await submitQuiz(x.learner, ids.quizB, 1);
    await setting(mine.organisationid, { requireLessonQuizPass: true });
    await setting(other.organisationid, { requireLessonQuizPass: true });
    const before = await dump([other.learner]);
    const out = await recalc(mine.organisationid, true);
    expect(out.counts.learners).toBe(1);
    expect(await dump([other.learner])).toBe(before);
    expect(await totals(other.learner, ids.lessonB)).toEqual({ lesson: 40, completed: true, level: 40, grade: 40 });
    expect(await totals(mine.learner, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
  });

  it("with the setting not strictly true it refuses and writes nothing", async () => {
    for (const value of [null, {}, { requireLessonQuizPass: false }, { requireLessonQuizPass: "true" }, { requireLessonQuizPass: 1 }]) {
      const { organisationid, learner } = await legacyLearner();
      await submitQuiz(learner, ids.quizB, 1);
      await setting(organisationid, value);
      const before = await dump([learner]);
      const out = await recalc(organisationid, true);
      expect(out.exitCode).toBe(1);
      expect(out.lines.join("\n")).toContain("Refusing to run");
      expect(await dump([learner])).toBe(before);
    }
  });

  it("refuses an unknown organisation, no --org and a build without the rule, and writes nothing", async () => {
    const { organisationid, learner } = await legacyLearner();
    await submitQuiz(learner, ids.quizB, 1);
    await setting(organisationid, { requireLessonQuizPass: true });
    const before = await dump([learner]);
    expect((await recalc(randomUUID(), true)).exitCode).toBe(1);
    expect((await recalc(organisationid, true, { organisationcode: "" })).exitCode).toBe(1);
    expect((await recalc(organisationid, true, { ruleDeployed: false })).exitCode).toBe(1);
    expect(await dump([learner])).toBe(before);
  });

  it("a dry run writes nothing and prints the same counts the apply does", async () => {
    const { organisationid, learner } = await legacyLearner();
    await watch(learner, ids.learningA);
    await submitQuiz(learner, ids.quizA, 1);
    await submitQuiz(learner, ids.quizB, 1);
    await setting(organisationid, { requireLessonQuizPass: true });
    const before = await dump([learner]);
    const dry = await recalc(organisationid, false);
    expect(dry.exitCode).toBe(0);
    expect(await dump([learner])).toBe(before);
    expect(dry.lines.join("\n")).toContain("Dry run: nothing was written");
    const applied = await recalc(organisationid, true);
    expect(body(applied)).toEqual(body(dry));
    expect(applied.counts.attemptRowsToZero).toBeGreaterThan(0);
    expect(await dump([learner])).not.toBe(before);
  });

  it("the report carries counts only: no id, name or code of a learner, school or quiz", async () => {
    const { organisationid, learner } = await legacyLearner();
    await submitQuiz(learner, ids.quizB, 1);
    await setting(organisationid, { requireLessonQuizPass: true });
    const text = (await recalc(organisationid, true)).lines.join("\n");
    for (const secret of [learner.studentid, learner.schooluserid, learner.schoolid, learner.studentfirstname, ids.quizB, ids.lessonB, organisationid]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain(`database: ${dbname}`);
  });

  it("one learner's failure rolls that learner back, the others are handled, and the exit code is non-zero", async () => {
    const organisationid = await makeOrg(null);
    const good = await makeLearner(organisationid);
    const bad = await makeLearner(organisationid);
    for (const l of [good, bad]) await submitQuiz(l, ids.quizB, 1);
    await setting(organisationid, { requireLessonQuizPass: true });
    const badBefore = await dump([bad]);
    const [[badLevel]] = (await sql("SELECT studentlevelprogressid AS id FROM studentlevelsprogress WHERE studentid = :s", { s: bad.studentid })) as unknown as [{ id: string }[]];
    // The grade write of the bad learner fails after its attempts and lesson row were already written in the transaction.
    const failing = {
      query: (q: string, v?: unknown[]) =>
        q.startsWith("UPDATE studentlevelsprogress") && Array.isArray(v) && v.includes(badLevel.id)
          ? Promise.reject(Object.assign(new Error("injected"), { code: "ER_INJECTED" }))
          : connection.query(q, v as never),
      beginTransaction: () => connection.beginTransaction(),
      commit: () => connection.commit(),
      rollback: () => connection.rollback(),
    };
    const out = await recalc(organisationid, true, { conn: failing });
    expect(out.exitCode).toBe(2);
    expect(out.counts.learnersFailed).toBe(1);
    expect(await dump([bad])).toBe(badBefore);
    expect(await totals(good, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
    // a rerun with a working connection finishes the failed learner
    const rerun = await recalc(organisationid, true);
    expect(rerun.exitCode).toBe(0);
    expect(await totals(bad, ids.lessonB)).toEqual({ lesson: 0, completed: false, level: 0, grade: 0 });
  });
});

