/* eslint-disable @typescript-eslint/no-var-requires */
import * as fs from "fs";
import * as path from "path";
import { Progress } from "src/models/enums/progress.enum";
import * as lessonBusiness from "src/business/lesson.business";
import * as quizPass from "src/business/lesson-quiz-pass";
import * as rules from "src/business/progress-rules";

const { PROGRESS, planLearner, isEmptyPlan } = require("../../scripts/lib/lesson-quiz-recalc-plan");
const { parseArgs, dbSettings } = require("../../scripts/recalc-lesson-quiz-points");

/**
 * The planning half of the lesson quiz recalculation script: rows in, changes out, no database.
 * Content: lesson L1 (total 60, pass mark 60) in level V1 (160 points) of grade G1 (160 points); quiz Q1 holds 40.
 */
const lessons = { L1: { levelid: "V1", total_points: 60, passing_points: 60 }, L2: { levelid: "V1", total_points: 40, passing_points: 40 } };
const levels = { V1: { gradeid: "G1", points: 160 } };
const grades = { G1: { points: 160 } };
const quizzes = { Q1: { lessonid: "L1", retired: false }, Q2: { lessonid: "L2", retired: false } };
let t = Date.UTC(2026, 10, 1);
const attempt = (id: string, quizid: string, ispass: number, points: number | null, verified = 0, starttime = new Date((t += 60000))) => ({ studentprogressid: id, quizid, ispass, verified, points, starttime });
const prog = (id: string, points: number, progress: number, completed: boolean) => ({ id, points, progress, completed });
const base = (attempts: any[], progress: any, extra: any = {}) => ({ countedPassNeedsVerified: false, attempts, quizzes, lessons, levels, grades, progress, ...extra });
const plan = (input: any) => planLearner(input, rules);

describe("planLearner", () => {
  it("a quiz with a counted pass: failed attempts go to 0 points and the totals stay", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q1", 1, 40)], { lesson: { L1: prog("pl", 60, 100, true) }, level: { V1: prog("pv", 60, 37.5, false) }, grade: { G1: prog("pg", 60, 37.5, false) } }));
    expect(p.zeroRows).toEqual(["a"]);
    expect(p.lessonUpdates).toEqual([]);
    expect(p.levelUpdates).toEqual([]);
    expect(p.gradeUpdates).toEqual([]);
    expect(p.counts.quizzesWithCountedPass).toBe(1);
    expect(p.counts.attemptRowsToZero).toBe(1);
  });

  it("a pass row is never listed, whatever its points", () => {
    const p = plan(base([attempt("a", "Q1", 1, 40), attempt("b", "Q1", 1, 40), attempt("c", "Q1", 0, 10)], { lesson: {}, level: {}, grade: {} }));
    expect(p.zeroRows).toEqual(["c"]);
  });

  it("a quiz with no pass: the newest attempt's points come off lesson, level and grade, every attempt goes to 0, and completed and progress are recomputed", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q1", 0, 40)], { lesson: { L1: prog("pl", 60, 100, true) }, level: { V1: prog("pv", 100, 62.5, false) }, grade: { G1: prog("pg", 100, 62.5, false) } }));
    expect(p.zeroRows.sort()).toEqual(["a", "b"]);
    expect(p.lessonUpdates).toEqual([{ id: "pl", points: 20, progress: 33.33, completed: false }]);
    expect(p.levelUpdates).toEqual([{ id: "pv", points: 60, progress: 37.5, completed: false }]);
    expect(p.gradeUpdates).toEqual([{ id: "pg", points: 60, progress: 37.5, completed: false }]);
    expect(p.counts.lessonsCompletedToNot).toBe(1);
    expect(p.counts.levelsCompletedToNot).toBe(0);
  });

  it("level and grade complete flags follow the 80 percent rule", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40)], { lesson: { L1: prog("pl", 60, 100, true) }, level: { V1: prog("pv", 160, 100, true) }, grade: { G1: prog("pg", 160, 100, true) } }));
    expect(p.levelUpdates).toEqual([{ id: "pv", points: 120, progress: 75, completed: false }]);
    expect(p.gradeUpdates).toEqual([{ id: "pg", points: 120, progress: 75, completed: false }]);
    expect(p.counts.levelsCompletedToNot).toBe(1);
    expect(p.counts.gradesCompletedToNot).toBe(1);
  });

  it("what comes off is the NEWEST attempt's points, not the largest or the first", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q1", 0, 25)], { lesson: { L1: prog("pl", 60, 100, true) }, level: { V1: prog("pv", 60, 37.5, false) }, grade: { G1: prog("pg", 60, 37.5, false) } }));
    expect(p.lessonUpdates[0].points).toBe(35);
  });

  it("a lesson with a second quiz keeps that quiz's credit", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q2", 1, 40)], { lesson: { L1: prog("pl", 40, 66.67, false), L2: prog("pm", 40, 100, true) }, level: { V1: prog("pv", 80, 50, false) }, grade: { G1: prog("pg", 80, 50, false) } }));
    expect(p.lessonUpdates.map((u: any) => [u.id, u.points])).toEqual([["pl", 0]]);
    expect(p.levelUpdates[0].points).toBe(40);
  });

  it("two failed quizzes in one lesson come off the same row once, together", () => {
    const two = { ...lessons, L1: { levelid: "V1", total_points: 80, passing_points: 80 } };
    const qs = { Q1: { lessonid: "L1", retired: false }, Q3: { lessonid: "L1", retired: false } };
    const p = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q3", 0, 40)], { lesson: { L1: prog("pl", 80, 100, true) }, level: { V1: prog("pv", 80, 50, false) }, grade: { G1: prog("pg", 80, 50, false) } }, { lessons: two, quizzes: qs }));
    expect(p.lessonUpdates).toEqual([{ id: "pl", points: 0, progress: 0, completed: false }]);
    expect(p.levelUpdates[0].points).toBe(0);
  });

  it("never below 0, and says how many rows hit the floor", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40)], { lesson: { L1: prog("pl", 10, 16.67, false) }, level: { V1: prog("pv", 10, 6.25, false) }, grade: { G1: prog("pg", 50, 31.25, false) } }));
    expect(p.lessonUpdates[0].points).toBe(0);
    expect(p.levelUpdates[0].points).toBe(0);
    expect(p.gradeUpdates[0].points).toBe(10);
    expect(p.counts).toMatchObject({ lessonsAtFloor: 1, levelsAtFloor: 1, gradesAtFloor: 0 });
  });

  it("a row already at 0 with nothing to take is not rewritten", () => {
    const p = plan(base([attempt("a", "Q1", 0, 0)], { lesson: { L1: prog("pl", 0, 0, false) }, level: { V1: prog("pv", 0, 0, false) }, grade: { G1: prog("pg", 0, 0, false) } }));
    expect(isEmptyPlan(p)).toBe(true);
  });

  it("is idempotent: planning again over the result changes nothing", () => {
    const first = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q1", 1, 40), attempt("c", "Q2", 0, 40)], { lesson: { L1: prog("pl", 60, 100, true), L2: prog("pm", 40, 100, true) }, level: { V1: prog("pv", 100, 62.5, false) }, grade: { G1: prog("pg", 100, 62.5, false) } }));
    const second = plan(base([attempt("a", "Q1", 0, 0), attempt("b", "Q1", 1, 40), attempt("c", "Q2", 0, 0)], { lesson: { L1: prog("pl", 60, 100, true), L2: prog("pm", 0, 0, false) }, level: { V1: prog("pv", 60, 37.5, false) }, grade: { G1: prog("pg", 60, 37.5, false) } }));
    expect(first.zeroRows).toEqual(["a", "c"]);
    expect(isEmptyPlan(second)).toBe(true);
  });

  it("an unverified pass is not counted while the app counts only verified passes, and the quiz is left alone", () => {
    const rows = [attempt("a", "Q1", 0, 40), attempt("b", "Q1", 1, 40, 0)];
    const progress = { lesson: { L1: prog("pl", 60, 100, true) }, level: {}, grade: {} };
    const off = plan(base(rows, progress));
    expect(off.counts.quizzesWithCountedPass).toBe(1);
    const strict = plan(base(rows, progress, { countedPassNeedsVerified: true }));
    expect(strict.counts).toMatchObject({ quizzesWithCountedPass: 0, quizzesLeftOnlyUncountedPass: 1 });
    expect(isEmptyPlan(strict)).toBe(true);
    const verified = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "Q1", 1, 40, 1)], progress, { countedPassNeedsVerified: true }));
    expect(verified.zeroRows).toEqual(["a"]);
  });

  it("an attempt with null points is left null and is not counted", () => {
    const p = plan(base([attempt("a", "Q1", 0, null)], { lesson: { L1: prog("pl", 0, 0, false) }, level: {}, grade: {} }));
    expect(p.zeroRows).toEqual([]);
    expect(p.counts.attemptRowsToZero).toBe(0);
  });

  it("a retired or deleted quiz is included and counted", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40), attempt("b", "QX", 1, 40), attempt("c", "QX", 0, 40)], { lesson: { L1: prog("pl", 40, 66.67, false) }, level: { V1: prog("pv", 40, 25, false) }, grade: { G1: prog("pg", 40, 25, false) } }, { quizzes: { Q1: { lessonid: "L1", retired: true } } }));
    expect(p.counts.quizzesRetiredOrDeleted).toBe(2);
    expect(p.zeroRows.sort()).toEqual(["a", "c"]);
    expect(p.lessonUpdates[0].points).toBe(0);
  });

  it("a quiz with no pass whose lesson, level or grade is missing is left alone", () => {
    const p = plan(base([attempt("a", "QX", 0, 40)], { lesson: {}, level: {}, grade: {} }, { quizzes: {} }));
    expect(p.counts.quizzesLeftContentMissing).toBe(1);
    expect(isEmptyPlan(p)).toBe(true);
  });

  it("a missing progress row is counted, and the attempts still go to 0", () => {
    const p = plan(base([attempt("a", "Q1", 0, 40)], { lesson: {}, level: {}, grade: {} }));
    expect(p.zeroRows).toEqual(["a"]);
    expect(p.counts.progressRowsMissing).toBe(3);
  });

  it("counts passes whose newest attempt is not the pass, and lessons whose stored points differ from their parts", () => {
    const p = plan(base([attempt("a", "Q1", 1, 40, 0, new Date(1000)), attempt("b", "Q1", 0, 40, 0, new Date(2000))], { lesson: { L1: prog("pl", 55, 91.67, false) }, level: {}, grade: {} }, { learning: { L1: 20 } }));
    expect(p.counts.passWhoseNewestAttemptIsNotPass).toBe(1);
    expect(p.counts.lessonsStoredPointsDiffer).toBe(1); // 20 learning + 40 quiz = 60, stored 55
    const ok = plan(base([attempt("a", "Q1", 1, 40)], { lesson: { L1: prog("pl", 60, 100, true) }, level: {}, grade: {} }, { learning: { L1: 20 } }));
    expect(ok.counts.lessonsStoredPointsDiffer).toBe(0);
  });
});

describe("what the script shares with the app", () => {
  it("uses the app's progress types", () => {
    expect(PROGRESS).toEqual({ LESSONPRACTICE: Progress.LESSONPRACTICE, LESSONQUIZ: Progress.LESSONQUIZ });
  });
  it("the app's lesson, level and grade rules and the setting check are the functions the script is given", () => {
    expect(lessonBusiness.lessonPassMark).toBe(rules.lessonPassMark);
    expect(quizPass.requiresLessonQuizPass).toBe(rules.requiresLessonQuizPass);
    expect(rules.lessonPassMark({ passing_points: 50, total_points: 100 })).toBe(50);
    expect(rules.lessonPassMark({ passing_points: 0, total_points: 100 })).toBe(80);
    expect(rules.lessonPassMark({ total_points: 0 })).toBe(Number.POSITIVE_INFINITY);
    expect(rules.progressPercent(1, 3)).toBe(33.33);
    expect(rules.percentCompleted(80)).toBe(true);
    expect(rules.percentCompleted(79.99)).toBe(false);
  });
});

describe("the command line", () => {
  it("takes --org and --apply and refuses anything else", () => {
    expect(parseArgs(["--org", "x", "--apply"])).toEqual({ org: "x", apply: true });
    expect(parseArgs(["--org", "x"])).toEqual({ org: "x", apply: false });
    expect(() => parseArgs(["--force"])).toThrow("unknown argument --force");
    expect(() => parseArgs(["--org", "--apply"])).toThrow("--org needs a code");
  });
  it("reads the connection from the environment and from FORTYKAPIRPICONFIG the way the app does", () => {
    expect(dbSettings({ RPI_DB_USER: "u", RPI_DB_PASSWORD: "p", RPI_DB_NAME: "n" })).toMatchObject({ user: "u", password: "p", database: "n", host: "localhost", port: 3306 });
    const cfg = JSON.stringify({ fortyk: { api: { rpi: { database: { name: "m", user: "v", password: "q", host: "h", port: 3307 } } } } });
    expect(dbSettings({ FORTYKAPIRPICONFIG: cfg })).toEqual({ host: "h", port: 3307, user: "v", password: "q", database: "m" });
  });
  it("the script header carries the warning about importing a student export from central", () => {
    const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "recalc-lesson-quiz-points.js"), "utf8");
    expect(text).toContain("Do not import a student export taken from the central server (PUT /import/students) from before that upload");
  });
});
