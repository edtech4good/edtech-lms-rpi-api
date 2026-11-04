/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The database half of `scripts/recalc-lesson-quiz-points.js` (read that file's header first). `run` takes an open
 * mysql2 promise connection, so the specs can hand it a scratch database; the command line opens the connection.
 *
 * Output is counts only: no names, ids, emails or question text are ever printed.
 */
const { PROGRESS, emptyCounts, addCounts, planLearner, isEmptyPlan } = require("./lesson-quiz-recalc-plan");

const marks = (list) => list.map(() => "?").join(",");
const byKey = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r]));

/** Reads one learner's rows (locking the ones a write would change when `lock`) and returns the planner's input. */
async function readLearner(conn, studentid, countedPassNeedsVerified, lock) {
  const forUpdate = lock ? " FOR UPDATE" : "";
  const [attempts] = await conn.query(
    `SELECT studentprogressid, studentprogressreferenceid AS quizid, ispass, verified, points, starttime
       FROM studentprogress WHERE studentid = ? AND progresstype = ?${forUpdate}`,
    [studentid, PROGRESS.LESSONQUIZ],
  );
  const input = { countedPassNeedsVerified, attempts, quizzes: {}, lessons: {}, levels: {}, grades: {}, progress: { lesson: {}, level: {}, grade: {} }, practice: {}, learning: {} };
  if (attempts.length === 0) return input;
  const quizids = [...new Set(attempts.map((a) => a.quizid))];
  const [quizRows] = await conn.query(`SELECT lessonquizid, lessonid, lessonquizstatus FROM lessonquizzes WHERE lessonquizid IN (${marks(quizids)})`, quizids);
  for (const q of quizRows) input.quizzes[q.lessonquizid] = { lessonid: q.lessonid, retired: !Number(q.lessonquizstatus) };
  const lessonids = [...new Set(quizRows.map((q) => q.lessonid))];
  if (lessonids.length === 0) return input;
  const [lessonRows] = await conn.query(`SELECT lessonid, levelid, total_points, passing_points FROM lessons WHERE lessonid IN (${marks(lessonids)})`, lessonids);
  input.lessons = byKey(lessonRows, "lessonid");
  const levelids = [...new Set(lessonRows.map((l) => l.levelid))];
  if (levelids.length) {
    const [levelRows] = await conn.query(`SELECT levelid, gradeid, points FROM levels WHERE levelid IN (${marks(levelids)})`, levelids);
    input.levels = byKey(levelRows, "levelid");
    const gradeids = [...new Set(levelRows.map((l) => l.gradeid))];
    if (gradeids.length) {
      const [gradeRows] = await conn.query(`SELECT gradeid, points FROM grades WHERE gradeid IN (${marks(gradeids)})`, gradeids);
      input.grades = byKey(gradeRows, "gradeid");
    }
  }
  // Locked in the order the app writes them: lesson, then level, then grade.
  const [lp] = await conn.query(
    `SELECT studentlessonprogressid AS id, lessonid AS k, points, progress, completed, added_completed_scores FROM studentlessonsprogress WHERE studentid = ? AND lessonid IN (${marks(lessonids)}) ORDER BY studentlessonprogressid${forUpdate}`,
    [studentid, ...lessonids],
  );
  for (const r of lp) if (!(r.k in input.progress.lesson)) input.progress.lesson[r.k] = r;
  if (levelids.length) {
    const [vp] = await conn.query(
      `SELECT studentlevelprogressid AS id, levelid AS k, points, progress, completed FROM studentlevelsprogress WHERE studentid = ? AND levelid IN (${marks(levelids)}) ORDER BY studentlevelprogressid${forUpdate}`,
      [studentid, ...levelids],
    );
    for (const r of vp) if (!(r.k in input.progress.level)) input.progress.level[r.k] = r;
  }
  const gradeids = Object.keys(input.grades);
  if (gradeids.length) {
    const [gp] = await conn.query(
      `SELECT studentgradeprogressid AS id, gradeid AS k, points, progress, completed FROM studentgradesprogress WHERE studentid = ? AND gradeid IN (${marks(gradeids)}) ORDER BY studentgradeprogressid${forUpdate}`,
      [studentid, ...gradeids],
    );
    for (const r of gp) if (!(r.k in input.progress.grade)) input.progress.grade[r.k] = r;
  }
  // For the stored-points count only: what the lesson's practices and viewed learning items hold.
  const [practiceRows] = await conn.query(
    `SELECT p.lessonid, sp.studentprogressreferenceid AS ref, sp.points, sp.starttime
       FROM lessonpractices p JOIN studentprogress sp ON sp.studentprogressreferenceid = p.lessonpracticeid AND sp.studentid = ? AND sp.progresstype = ?
      WHERE p.lessonid IN (${marks(lessonids)}) ORDER BY sp.starttime DESC, sp.studentprogressid DESC`,
    [studentid, PROGRESS.LESSONPRACTICE, ...lessonids],
  );
  const seen = new Set();
  for (const r of practiceRows) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    input.practice[r.lessonid] = (input.practice[r.lessonid] || 0) + Number(r.points || 0);
  }
  const [learningRows] = await conn.query(
    `SELECT l.lessonid, SUM(s.points) AS points FROM studentlearningsprogress s JOIN lessonlearnings l ON l.lessonlearningid = s.lessonlearningid
      WHERE s.studentid = ? AND s.viewed > 0 AND l.lessonid IN (${marks(lessonids)}) GROUP BY l.lessonid`,
    [studentid, ...lessonids],
  );
  for (const r of learningRows) input.learning[r.lessonid] = Number(r.points || 0);
  return input;
}

/** Writes one learner's plan (inside the caller's transaction). */
async function writePlan(conn, plan, now) {
  if (plan.zeroRows.length) {
    await conn.query(`UPDATE studentprogress SET points = 0 WHERE ispass = 0 AND studentprogressid IN (${marks(plan.zeroRows)})`, plan.zeroRows);
  }
  const tables = [
    ["studentlessonsprogress", "studentlessonprogressid", plan.lessonUpdates],
    ["studentlevelsprogress", "studentlevelprogressid", plan.levelUpdates],
    ["studentgradesprogress", "studentgradeprogressid", plan.gradeUpdates],
  ];
  for (const [table, pk, updates] of tables) {
    for (const u of updates) {
      await conn.query(`UPDATE ${table} SET points = ?, progress = ?, completed = ?, lastupdated = ? WHERE ${pk} = ?`, [u.points, u.progress, u.completed ? 1 : 0, now, u.id]);
    }
  }
}

/** Whether an error means the connection itself is gone (so every later learner would fail the same way). */
const connectionLost = (err) =>
  Boolean(err) && (err.fatal === true || ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"].includes(err.code) || /closed state|connection lost/i.test(String(err.message)));

/**
 * options: { conn, organisationcode, apply, apiStopped, rules, countedPassNeedsVerified, ruleDeployed, dbname, out(line), now }
 * returns { exitCode, counts, changed }. Exit codes: 0 done (or nothing to do), 1 refused, 2 some learners failed.
 */
async function run(options) {
  const { conn, organisationcode, apply, apiStopped, rules, countedPassNeedsVerified, ruleDeployed, dbname } = options;
  const out = options.out || ((line) => console.log(line));
  const now = options.now || new Date();
  const refuse = (why) => {
    out(`Refusing to run: ${why}. Nothing was written.`);
    return { exitCode: 1, counts: emptyCounts(), changed: false };
  };
  out(`recalc-lesson-quiz-points: ${apply ? "APPLY" : "dry run (nothing is written)"}`);
  out(`database: ${dbname}`);
  if (!organisationcode) return refuse("--org <code> is required");
  if (apply && !apiStopped) {
    return refuse("--apply needs --api-stopped: the student API must be stopped while this writes, because a submission that arrives during the run can leave a total wrong that a rerun does not repair (the dry run is safe with the API running)");
  }
  if (!apply && apiStopped) return refuse("--api-stopped only applies with --apply");
  if (!ruleDeployed) return refuse("this build does not contain the lesson quiz pass rule, so new failed attempts would earn points again");

  // The database compares codes without case, trailing spaces or accents; the match here is exact.
  const [candidates] = await conn.query("SELECT organisationid, organisationcode, settingsconfig, isdeleted FROM organisations WHERE organisationcode = ?", [organisationcode]);
  const orgs = candidates.filter((o) => o.organisationcode === organisationcode);
  out(`organisation: ${organisationcode}`);
  if (orgs.length !== 1) return refuse(orgs.length === 0 ? "no organisation has exactly that code" : "more than one organisation has that code");
  if (Number(orgs[0].isdeleted)) return refuse("the organisation has been deleted");
  let settings = orgs[0].settingsconfig;
  if (typeof settings === "string") {
    try { settings = JSON.parse(settings); } catch { settings = null; }
  }
  const on = rules.requiresLessonQuizPass(settings);
  out(`requireLessonQuizPass: ${on ? "on" : "not on (only the boolean true counts)"}`);
  if (!on) return refuse("the organisation's requireLessonQuizPass setting is not strictly true");

  const [learners] = await conn.query(
    "SELECT s.studentid FROM students s JOIN schools sc ON sc.schoolid = s.schoolid WHERE sc.organisationid = ? ORDER BY s.studentid",
    [orgs[0].organisationid],
  );
  const total = emptyCounts();
  let lost = false;
  for (let index = 0; index < learners.length && !lost; index++) {
    const { studentid } = learners[index];
    const counts = emptyCounts();
    try {
      // A dry run's transaction is read-only, so it cannot write even if the code below were wrong.
      if (apply) await conn.beginTransaction(); else await conn.query("START TRANSACTION READ ONLY");
      const input = await readLearner(conn, studentid, countedPassNeedsVerified, apply);
      const plan = planLearner(input, rules);
      if (apply && !isEmptyPlan(plan)) await writePlan(conn, plan, now);
      if (apply) await conn.commit(); else await conn.rollback();
      addCounts(counts, plan.counts);
    } catch (err) {
      try { await conn.rollback(); } catch { /* the connection may be gone */ }
      counts.learnersFailed = 1;
      out(`a learner's transaction failed and was rolled back (${err && err.code ? err.code : "error"}); that learner is unchanged`);
      if (connectionLost(err)) {
        // Every later learner would fail the same way: stop, and say how many were not reached.
        lost = true;
        counts.learnersNotReached = learners.length - index - 1;
        out("the database connection was lost; stopping here");
      }
    }
    counts.learners = 1;
    addCounts(total, counts);
  }
  const changed = total.attemptRowsToZero + total.lessonsChanged + total.levelsChanged + total.gradesChanged > 0;
  out(`learners seen: ${total.learners}`);
  out(`lesson quizzes seen (one per learner and quiz): ${total.quizzes}`);
  out(`  with a counted pass (totals stay): ${total.quizzesWithCountedPass}`);
  out(`  with no pass (credit comes off): ${total.quizzesWithoutPass}`);
  out(`  left alone, only an uncounted pass row: ${total.quizzesLeftOnlyUncountedPass}`);
  out(`  left alone, no pass and the lesson, level or grade is missing: ${total.quizzesLeftContentMissing}`);
  out(`  left alone, no pass and a lesson, level or grade total gives no percentage: ${total.quizzesLeftUnusableTotal}`);
  out(`  retired or deleted quizzes (included above): ${total.quizzesRetiredOrDeleted}`);
  out(`attempt rows to set to 0 points: ${total.attemptRowsToZero}`);
  out(`lessons that change: ${total.lessonsChanged} (completed to not completed: ${total.lessonsCompletedToNot})`);
  out(`levels that change: ${total.levelsChanged} (completed to not completed: ${total.levelsCompletedToNot})`);
  out(`grades that change: ${total.gradesChanged} (completed to not completed: ${total.gradesCompletedToNot})`);
  out(`rows reduced to the floor of 0: lessons ${total.lessonsAtFloor}, levels ${total.levelsAtFloor}, grades ${total.gradesAtFloor}`);
  out(`progress rows missing (nothing to reduce): ${total.progressRowsMissing}`);
  out(`learners who keep a completion star for a lesson that is now not complete (stars are not changed): ${total.learnersKeepingStar}`);
  out(`passed quizzes whose newest attempt is not the pass (readers that take the newest attempt show 0 for them): ${total.passWhoseNewestAttemptIsNotPass}`);
  out(`lessons whose stored points differ from their attempts and learnings (counted, not fixed): ${total.lessonsStoredPointsDiffer}`);
  out(`learner transactions failed: ${total.learnersFailed}; learners not reached because the connection was lost: ${total.learnersNotReached}`);
  out("daily point history (studentpoints) is not changed by this script");
  if (total.learnersFailed > 0) {
    out(lost ? "The connection was lost; the learners handled before it are done and the rest were not touched. Check the database, then run again." : "Some learners failed; the others were handled. Run it again to retry the failed ones.");
    return { exitCode: 2, counts: total, changed };
  }
  if (!changed) out("Nothing to change.");
  else if (!apply) out("Dry run: nothing was written. Run again with --apply to write these changes.");
  else out("Applied. A second run with --apply changes nothing.");
  return { exitCode: 0, counts: total, changed };
}

module.exports = { run, readLearner, writePlan, connectionLost };
