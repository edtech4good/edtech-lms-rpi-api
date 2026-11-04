/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The planning half of `scripts/recalc-lesson-quiz-points.js`: rows in, changes out. Nothing here reads or writes
 * a database, so it runs in the unit specs without one.
 *
 * What it plans, for ONE learner, once an organisation has `requireLessonQuizPass` on (see
 * src/business/lesson-quiz-pass.ts): lesson quiz attempts saved before the rule hold the quiz's full points even
 * when they failed, and those points were added to the learner's lesson, level and grade rows. For each lesson quiz
 * the learner attempted:
 *   - a quiz with a COUNTED pass (ispass, and verified when the app only counts verified passes; `countedPassNeedsVerified`):
 *     the pass was credited once, so the lesson, level and grade rows stay as they are, and the non-passing attempts are
 *     set to 0 points;
 *   - a quiz with NO pass row of any kind: what the app currently treats as credited is the NEWEST attempt's points
 *     (result.business.ts `getoldpoints`, newest by starttime), so that comes off, and every attempt is set to 0 points.
 *     The app added a credit to a lesson only as far as it fitted under the lesson's total_points, and to the level and grade
 *     only what landed on the lesson, so the lesson goes down to min(its points, what its other parts add up to) and the level
 *     and grade lose exactly what the lesson lost, all floored at 0;
 *   - a quiz whose only pass rows are uncounted (ispass set but not verified while the app requires verification), or
 *     whose lesson, level or grade is missing from the content or has a total that cannot give a percentage, and which has
 *     no counted pass, is left entirely alone (no attempt changed either) and counted.
 * A row with ispass set is never changed. After a change the progress and completed columns of the changed lesson,
 * level and grade rows are recomputed with the app's own rules (src/business/progress-rules.js: `lessonPassMark`,
 * `progressPercent`, `percentCompleted`), passed in as `rules`.
 */

/** progresstype of a lesson practice and of a lesson quiz attempt (src/models/enums/progress.enum.ts; a spec pins these). */
const PROGRESS = { LESSONPRACTICE: 1, LESSONQUIZ: 2 };

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const time = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

/** Newest attempt first: by starttime, ties broken by id so the choice never depends on row order. */
const newestFirst = (a, b) => time(b.starttime) - time(a.starttime) || (a.studentprogressid < b.studentprogressid ? 1 : a.studentprogressid > b.studentprogressid ? -1 : 0);

/** Earliest first: the order `getpassoldpoints` reads the pass row in. */
const oldestFirst = (a, b) => -newestFirst(a, b);

const isPass = (row) => Boolean(Number(row.ispass));
const isCounted = (row, countedPassNeedsVerified) => isPass(row) && (!countedPassNeedsVerified || Boolean(Number(row.verified)));

/** All the counters the report prints, at zero. */
function emptyCounts() {
  return {
    learners: 0,
    quizzes: 0,
    quizzesWithCountedPass: 0,
    quizzesWithoutPass: 0,
    quizzesLeftOnlyUncountedPass: 0,
    quizzesLeftContentMissing: 0,
    quizzesLeftUnusableTotal: 0,
    quizzesRetiredOrDeleted: 0,
    attemptRowsToZero: 0,
    lessonsChanged: 0,
    levelsChanged: 0,
    gradesChanged: 0,
    lessonsCompletedToNot: 0,
    levelsCompletedToNot: 0,
    gradesCompletedToNot: 0,
    lessonsAtFloor: 0,
    lessonsCreditNotFullyTakenOff: 0,
    levelsAtFloor: 0,
    gradesAtFloor: 0,
    progressRowsMissing: 0,
    learnersKeepingStar: 0,
    learnersNotReached: 0,
    passWhoseNewestAttemptIsNotPass: 0,
    lessonsStoredPointsDiffer: 0,
    learnersFailed: 0,
  };
}

/** Adds `b` into `a` (both from emptyCounts). */
function addCounts(a, b) {
  for (const key of Object.keys(a)) a[key] += b[key] || 0;
  return a;
}

/**
 * The plan for one learner.
 *
 * input:
 *   countedPassNeedsVerified  true when GRADING_MODE is enforce and REQUIRE_GRADED_ANSWERS is on (countedpassclause)
 *   attempts   lesson quiz attempts: { studentprogressid, quizid, ispass, verified, points, starttime }
 *   quizzes    { [quizid]: { lessonid, retired } } for the quizzes that exist in the content
 *   lessons    { [lessonid]: { levelid, total_points, passing_points } }
 *   levels     { [levelid]: { gradeid, points } }
 *   grades     { [gradeid]: { points } }
 *   progress   { lesson: { [lessonid]: row }, level: { [levelid]: row }, grade: { [gradeid]: row } } where a row is
 *              { id, points, progress, completed }; absent when the learner has none
 *   practice   { [lessonid]: points } the credit the lesson's practices hold (newest attempt of each), and
 *   learning   { [lessonid]: points } what the learner's viewed learning items hold, both for the stored-points check
 * rules: { lessonPassMark, progressPercent, percentCompleted } as the app defines them.
 *
 * returns { zeroRows: [studentprogressid], lessonUpdates, levelUpdates, gradeUpdates (each: { id, points, progress, completed }), counts }
 */
function planLearner(input, rules) {
  const { countedPassNeedsVerified, attempts, quizzes, lessons, levels, grades, progress } = input;
  const practice = input.practice || {};
  const learning = input.learning || {};
  const counts = emptyCounts();
  const zeroRows = [];
  const subtract = { lesson: {}, level: {}, grade: {} };
  const credit = {}; // lessonid -> the quiz credit the lesson holds after the plan, for the stored-points check
  const touchedLessons = new Set();

  const byQuiz = {};
  for (const a of attempts) (byQuiz[a.quizid] = byQuiz[a.quizid] || []).push(a);

  for (const quizid of Object.keys(byQuiz).sort()) {
    const rows = byQuiz[quizid];
    const quiz = quizzes[quizid];
    counts.quizzes += 1;
    const lesson = quiz ? lessons[quiz.lessonid] : undefined;
    if (!quiz || quiz.retired || !lesson) counts.quizzesRetiredOrDeleted += 1;

    const counted = rows.filter((r) => isCounted(r, countedPassNeedsVerified)).sort(oldestFirst);
    const anyPass = rows.some(isPass);
    const failedRows = rows.filter((r) => !isPass(r));
    const toZero = failedRows.filter((r) => r.points !== null && r.points !== undefined && num(r.points) !== 0);
    const lessonid = quiz ? quiz.lessonid : undefined;

    if (counted.length > 0) {
      // Credited once already: totals stay, the other attempts stop holding the same points.
      counts.quizzesWithCountedPass += 1;
      for (const r of toZero) zeroRows.push(r.studentprogressid);
      if (toZero.length) counts.attemptRowsToZero += toZero.length;
      if (!isPass([...rows].sort(newestFirst)[0])) counts.passWhoseNewestAttemptIsNotPass += 1;
      if (lessonid) {
        touchedLessons.add(lessonid);
        credit[lessonid] = (credit[lessonid] || 0) + num(counted[0].points);
      }
      continue;
    }
    if (anyPass) {
      counts.quizzesLeftOnlyUncountedPass += 1;
      if (lessonid) {
        touchedLessons.add(lessonid);
        credit[lessonid] = (credit[lessonid] || 0) + num([...rows].sort(newestFirst)[0].points);
      }
      continue;
    }
    // No pass of any kind: the newest attempt's points are what is credited.
    const level = lesson ? levels[lesson.levelid] : undefined;
    const grade = level ? grades[level.gradeid] : undefined;
    if (!lesson || !level || !grade) {
      counts.quizzesLeftContentMissing += 1;
      if (lessonid) touchedLessons.add(lessonid);
      continue;
    }
    if (![lesson.total_points, level.points, grade.points].every((total) => Number.isFinite(rules.progressPercent(0, total)))) {
      // A total that gives no percentage cannot be recomputed, so nothing of this quiz is changed (a half change would not be repaired by a rerun).
      counts.quizzesLeftUnusableTotal += 1;
      touchedLessons.add(lessonid);
      continue;
    }
    counts.quizzesWithoutPass += 1;
    touchedLessons.add(lessonid);
    const held = num([...rows].sort(newestFirst)[0].points);
    for (const r of toZero) zeroRows.push(r.studentprogressid);
    counts.attemptRowsToZero += toZero.length;
    if (held > 0) {
      subtract.lesson[lessonid] = (subtract.lesson[lessonid] || 0) + held;
      subtract.level[lesson.levelid] = (subtract.level[lesson.levelid] || 0) + held;
      subtract.grade[level.gradeid] = (subtract.grade[level.gradeid] || 0) + held;
    }
  }

  const lessonUpdates = [];
  const levelUpdates = [];
  const gradeUpdates = [];
  const storedLesson = {};
  const taken = { level: {}, grade: {} };
  let keepsStar = false;

  // The lesson first: it goes down to what its other parts add up to, never by more than the credit taken off.
  for (const lessonid of Object.keys(subtract.lesson).sort()) {
    const lesson = lessons[lessonid];
    const row = progress.lesson[lessonid];
    const amount = subtract.lesson[lessonid];
    let reduction = amount;
    if (!row) {
      counts.progressRowsMissing += 1;
    } else {
      const old = num(row.points);
      const rest = num(practice[lessonid]) + num(learning[lessonid]) + num(credit[lessonid]);
      reduction = Math.min(amount, old - Math.min(old, rest));
      const next = old - reduction;
      if (reduction < amount) counts.lessonsCreditNotFullyTakenOff += 1;
      if (old < amount && next === 0) counts.lessonsAtFloor += 1;
      const percent = rules.progressPercent(next, lesson.total_points);
      const completed = next >= rules.lessonPassMark(lesson);
      storedLesson[lessonid] = next;
      if (!(next === old && percent === num(row.progress) && completed === Boolean(row.completed))) {
        lessonUpdates.push({ id: row.id, points: next, progress: percent, completed });
        counts.lessonsChanged += 1;
        if (Boolean(row.completed) && !completed) {
          counts.lessonsCompletedToNot += 1;
          if (row.added_completed_scores) keepsStar = true;
        }
      }
    }
    const levelid = lesson.levelid;
    const gradeid = levels[levelid].gradeid;
    taken.level[levelid] = (taken.level[levelid] || 0) + reduction;
    taken.grade[gradeid] = (taken.grade[gradeid] || 0) + reduction;
  }

  const reduce = (kind, key, total, updates, flags) => {
    const amount = taken[kind][key];
    if (!amount) return;
    const row = progress[kind][key];
    if (!row) {
      counts.progressRowsMissing += 1;
      return;
    }
    const old = num(row.points);
    const wanted = old - amount;
    const next = Math.max(0, wanted);
    if (wanted < 0) counts[flags.floor] += 1;
    const percent = rules.progressPercent(next, total);
    const completed = rules.percentCompleted(percent);
    if (next === old && percent === num(row.progress) && completed === Boolean(row.completed)) return;
    updates.push({ id: row.id, points: next, progress: percent, completed });
    counts[flags.changed] += 1;
    if (Boolean(row.completed) && !completed) counts[flags.toNot] += 1;
  };
  for (const levelid of Object.keys(taken.level).sort()) {
    reduce("level", levelid, levels[levelid].points, levelUpdates, { floor: "levelsAtFloor", changed: "levelsChanged", toNot: "levelsCompletedToNot" });
  }
  for (const gradeid of Object.keys(taken.grade).sort()) {
    reduce("grade", gradeid, grades[gradeid].points, gradeUpdates, { floor: "gradesAtFloor", changed: "gradesChanged", toNot: "gradesCompletedToNot" });
  }
  if (keepsStar) counts.learnersKeepingStar += 1;

  // Stored lesson points against what the lesson's own attempts and learnings add up to (a count only; nothing is fixed here).
  for (const lessonid of [...touchedLessons].sort()) {
    const lesson = lessons[lessonid];
    const row = progress.lesson[lessonid];
    if (!lesson || !row) continue;
    const stored = lessonid in storedLesson ? storedLesson[lessonid] : num(row.points);
    const expected = Math.min(num(lesson.total_points), num(practice[lessonid]) + num(learning[lessonid]) + num(credit[lessonid]));
    if (stored !== expected) counts.lessonsStoredPointsDiffer += 1;
  }
  return { zeroRows, lessonUpdates, levelUpdates, gradeUpdates, counts };
}

/** Whether a plan changes anything. */
const isEmptyPlan = (plan) => plan.zeroRows.length === 0 && plan.lessonUpdates.length === 0 && plan.levelUpdates.length === 0 && plan.gradeUpdates.length === 0;

module.exports = { PROGRESS, emptyCounts, addCounts, planLearner, isEmptyPlan };
