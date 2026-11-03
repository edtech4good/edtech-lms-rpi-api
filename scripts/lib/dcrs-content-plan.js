/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The pure half of `seed:dcrs -- --content <dir>`: turns a `content.json` into a plan
 * of row writes, and refuses a content file that cannot be written as it stands. Nothing
 * here touches a database or a file.
 *
 * This file is a verbatim twin: edtech-lms-api/scripts/lib/dcrs-content-plan.js and
 * edtech-lms-rpi-api/scripts/lib/dcrs-content-plan.js must stay byte-identical (a spec in each
 * repo pins the hash; change both, then both hashes).
 *
 * The shape of what is written (product decision of 29 Oct 2026). The CURRICULUM is the programme: what a learner
 * enrols in, what is published and certified. The GRADE is the programme's one track (it keeps the programme's name for
 * now). Each MODULE is a LEVEL under that grade, in module order. So a file is one module of the programme:
 *
 * content.json
 * ```
 * { "programme": { "en": "...", "km": "..." },                       // required: the curriculum's and the grade's name, one line each
 *   "module":    { "number": 1, "name": { "en": "...", "km": "..." } },  // the level's name; the number is the level's order
 *   "lessons": [ {
 *     "id": "<one of the four fixed DCRS lesson ids>",               // Module 1's fixed lessons only; every other lesson has no id
 *     "order": 1,                                                    // 1 to 12, each once; it names a lesson's place (and, with no id, its slot)
 *     "name":  { "en": "...", "km": "..." },
 *     "video": { "ref": "...", "filename": "dcrs-m1-l1.mp4", "source": "..." },   // source optional
 *     //  or, to leave the lesson's existing video document alone:  { "ref": "...", "keep": true }   (no filename, no source)
 *     "practice": [ QUESTION, ... ], "quiz": [ QUESTION, ... ] } ] }
 * QUESTION = { "ident": "DCRS-M1-P1", "text": { "en", "km" }, "title": { "en", "km" } /* optional, not stored *\/,
 *              "options": [ { "text": { "en", "km" }, "correct": true | false }, ... ],
 *              "feedback": { "correctmessage": { "en", "km" }, "incorrectmessage": { "en", "km" } } /* optional, each message optional *\/ }
 * ```
 * The first shape of this file had `curriculum` and `level` (both the module title) and an optional `programme`; it is refused,
 * with a message that names the shape above.
 *
 * What the plan does, in order (parents before the rows that hang from them):
 *  - upserts the curriculum's name and the grade's name (both the programme's), the module's level (its name, its order = the
 *    module number, its status), and for every lesson NAMED in the file: the lesson, its video document, learning item,
 *    practice and quiz, then the questions and the join rows that put them in the practice and the quiz;
 *  - a lesson with no practice question (or no quiz question) still gets its practice (quiz) row, written switched off (status 0): the
 *    learner app lists every switched-on practice as a step and opens it, and a set with no question never finishes. The status is
 *    in the update list, so naming a question later switches the set on.
 *  - a lesson whose video is `keep: true` has NO documents step at all: its document row (the file it names, its meta) is not written,
 *    and no file is to be copied. The row must already be there: `plan.requires` lists it and the applier's preflight refuses a
 *    database without it. The lesson's learning item still points at that document.
 *  - hides what the file does not name, reversibly, within THIS module's level only: the module's other lessons are marked
 *    `isdeleted` with their documents, and their learning items, practices, quizzes and join rows get status 0; the module's
 *    own question ids the file no longer uses are marked `isdeleted`. Naming a lesson again in a later file un-hides it.
 *    Nothing outside the module's level is touched: another module's lessons are never hidden by this one's file.
 *  - THE LEVEL SWITCH IS EXPLICIT. `levelSwitch` is "draft" (the seed's `--draft`: the level is written with `levelstatus` 0, built
 *    but not shown to learners), "live" (`--live`: `levelstatus` 1) or null (neither flag). With null an EXISTING level keeps the
 *    `levelstatus` it has (the run does not write the column), and a NEW level (the first run of a module) is refused: say which. `draft`
 *    is refused for Module 1, which is the delivered module.
 *  - POINTS follow central's own rule (`updateLevelPoints`, src/business/level.business.ts): a level's `points` is the sum of the
 *    `total_points` of its lessons that are not hidden, plus its `quiz_points` ONLY WHEN the level has at least one active level-quiz
 *    row (`levelquizquestions`, `levelquizquestionstatus`; a learner can earn the quiz points only through that quiz, and this
 *    import writes none, so a new level is worth its lessons alone; `quiz_points` itself is left as it is); the grade's `points` is the sum of the `points` of its
 *    levels that are switched on and not deleted. The plan computes both for what it writes; the levels it does not write (the other
 *    modules, and any a person added) come in as `existing`, which the seed reads from the database before it plans. So the
 *    learner's progress (`points * 100 / grade.points`) is out of the live modules only: a draft module does not move it.
 *  - A NEW LESSON'S PASS MARK is `lessonPassingPoints`: 80, or the points a learner can reach when that is less (a lesson with no practice
 *    or no quiz has fewer to earn: 60, and with neither 20). It is written once, with the lesson; a lesson already there keeps its columns.
 *  - AN EXISTING QUESTION KEEPS ITS MEANING. A question id that is in the database is refused, before any write, when the file would move
 *    it between practice and quiz, change its number of options or move its correct option (`existing.questions`); its text may change.
 *  - A MODULE 2+ LESSON SLOT CANNOT CHANGE MEANING. A later module's lesson is identified by its `order`; a run is refused when an
 *    existing lesson in a slot, hidden or not, has another English name than the file's lesson for that slot, unless `renameLessons`
 *    (`--rename-lessons`) says the rename is meant. A hidden slot is not free: reviving it would hand a different lesson the old
 *    row's id, its question ids and its learners' progress. Give the new lesson a new order.
 *
 * Where the ids come from.
 *  - MODULE 1 keeps every id it ever had: the seed's fixed ids (the level, the four lessons, their documents, learning
 *    items, practices and quizzes, the seven question ids, the join rows, then the c0000000-0000-4000-8000-0000000000xx
 *    namespace from 0x32 up). Questions take the seven fixed question ids in order (the practice questions of the first named
 *    lesson, then its quiz questions, then the next lesson's), so the lessons that name a fixed lesson id may carry at most seven
 *    questions in all; a lesson has room for four practice and four quiz questions. Re-running Module 1 against a database it already
 *    wrote changes nothing.
 *  - MODULE 1'S LESSONS 2 TO 12 (a Module 1 lesson with no `id`) are derived like a later module's, from role paths of module 1
 *    (`dcrs/m1/lesson/2`, `dcrs/m1/q/quiz/2/1`, ...; `slots.extraLessons`), each with its own four practice and four quiz question
 *    ids, so a Module 1 of six lessons keeps lesson 1 on its fixed ids and gives the rest ids of their own. The seed's fixed lessons
 *    2 to 4 stay as the hidden placeholders they are (the seed made them, a learner may hold progress on them, so no new lesson is
 *    handed their rows): naming one of them by its `id` still works as before, and a file that names none of them hides them. A
 *    derived lesson is identified by its `order` (2 to 12; order 1 is the fixed lesson 1), exactly like a later module's.
 *  - MODULE 2 AND LATER derive every id from MODULE_ID_NAMESPACE and a role path as an RFC 4122 version-5 UUID (`uuidV5`,
 *    `moduleId`): `dcrs/m2/level`, `dcrs/m2/lesson/1`, `dcrs/m2/doc/1`, `dcrs/m2/learning/1`, `dcrs/m2/practice/1`,
 *    `dcrs/m2/quiz/1`, `dcrs/m2/join/practice/1/3`, `dcrs/m2/q/quiz/1/2`, and for a translation row
 *    `dcrs/m2/tr/<table>/<row id>/<field>/<subkey>`. Central and the student API seeded from the same file hold the same ids; no
 *    id of one module can equal one of another, or one of Module 1's fixed ids (planContent asserts it). A module has room for
 *    12 lessons (a lesson's `order`, 1 to 12, is its slot: dropping the lesson of order 3 from a later file hides lesson 3),
 *    each with up to four practice and four quiz questions. The curriculum's and the grade's translation rows are the
 *    programme's, not the module's: they keep the id Module 1 gives them whichever module writes them.
 *  - The curriculum and the grade are never created by a module beyond Module 1's fixed ids: a Module 2+ file attaches to the
 *    existing ones (`plan.requires`, checked by the applier's preflight), writes only their names, and is refused when they are
 *    absent. A run whose programme differs from the curriculum's current name renames it; that is how the name is corrected.
 *    A later module writes the names and the points of the curriculum and the grade, and nothing else of them.
 *
 * Two languages, one meaning each (bilingual content design, section 6.4, decision 2). The ENGLISH text
 * goes into the base columns of the rows above, because the readiness programme's organisation has the base
 * language `en` (`organisations.contentlanguage`). The KHMER text goes into `contenttranslations`, one row per
 * text, language `km`: the lesson, curriculum, grade and level names (and the learning item, practice and quiz that
 * carry the lesson's name), the question text, its heading text, every option text keyed by the option's id
 * (`<question id>-opt-N`), and the feedback messages when the file has them. Each row records `sourcehash`, the
 * sha-256 of the exact English UTF-8 text it translates, so a later edit of the English makes it stale (and the
 * student API stops serving it). A text that an answer is graded by never gets a row (decision 8; the readiness
 * questions are template 1, so none of theirs is). The translation rows have deterministic ids, so central and
 * the student API seeded from the same file hold the same rows. `lastupdated` is the time of the run that wrote
 * the row, and only moves when the Khmer text or the English hash changes, so a second run changes nothing.
 * The organisation's `contentlanguage` is set to `en` when it has none; one that has another language is refused.
 *
 * Placeholders. The seed's own pass leaves descriptions like "DCRS lesson" and a grade called "Cohort II" that a learner
 * would see. Content mode blanks every description the file does not provide (curriculum, grade, level, lesson, learning item,
 * practice, quiz: the empty string) in the rows it writes in full, and names the curriculum and the grade, whose names the
 * navigation shows, after the programme. A later module writes only the names of the curriculum and the grade (and the grade's
 * points), and never touches their status or their other columns: a draft module must not publish the programme.
 */

const { createHash } = require("crypto");

const BASE_LANGUAGE = "en";
const TRANSLATION_LANGUAGE = "km";
const TRANSLATION_TEXT_MAX_BYTES = 65535;
const FEEDBACK_KEYS = ["correctmessage", "incorrectmessage"];
// The template every readiness question is written as (single-answer text choice).
const QUESTION_TEMPLATE = 1;
// A copy of ANSWER_BEARING_FIELDS in src/constants/content-translations.ts (a spec in each repo pins them equal).
const ANSWER_BEARING_FIELDS = { 8: ["questiontext"], 21: ["questiontext", "questionoptiontext"], 23: ["questiontext"] };
const FILENAME = /^[A-Za-z0-9_-]+\.mp4$/;
const IDENT = /^DCRS-[A-Za-z0-9-]+$/;
const MAX_QUESTIONS_PER_SET = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
// A module after the first has room for this many lessons (Module 1 has its four fixed ones).
const MAX_LESSONS_LATER_MODULE = 12;
// The namespace of the version-5 ids of Module 2 and later. Fixed for good: changing it renames every id of every later module.
const MODULE_ID_NAMESPACE = "5d7c3c0e-2b6a-4f0e-9a41-6e0c1f8d2a73";
// What a lesson and a level's quiz are worth when the plan writes them new (the lesson rows below carry total_points 100).
const LESSON_TOTAL_POINTS = 100;
const DEFAULT_QUIZ_POINTS = 20;
// What a lesson's three steps are worth when it is written new, and the pass mark of a lesson that has all three.
const LESSON_LEARNING_POINTS = 20;
const LESSON_QUIZ_POINTS = 40;
const LESSON_PRACTICE_POINTS = 40;
const LESSON_PASS_POINTS = 80;
// The app's own fallback (lessonPassMark in the student API's src/business/lesson.business.ts): a lesson with no usable passing_points
// is complete at this percentage of its total_points.
const APP_PASS_PERCENTAGE = 80;
const LEVEL_SWITCHES = ["draft", "live"];

const OLD_SHAPE =
  'content.json is in the old shape (it has "curriculum" or "level"); a file now has "programme": { "en", "km" } (required) and ' +
  '"module": { "number": N, "name": { "en", "km" } } instead, and a module is one level of the programme';

/** Thrown when a content file cannot be written as it stands; `problems` lists every reason. */
class ContentRefused extends Error {
  constructor(problems) {
    super(`content refused: ${problems.join("; ")}`);
    this.name = "ContentRefused";
    this.problems = problems;
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v.trim().length > 0;

/** The lower-case hex sha-256 of the UTF-8 bytes of a base text, with no normalisation (the rule of src/constants/content-translations.ts). */
const sourceHash = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** Is this field of a question of this template one an answer is graded by (never translated)? */
const isAnswerBearing = (templatetypeid, field) => (ANSWER_BEARING_FIELDS[templatetypeid] ?? []).includes(field);

/**
 * The id of a translation row: a UUID-shaped digest of its key, so that the same file written to central and to the
 * student API gives the same ids, and a second run finds the rows it wrote.
 */
function translationId(tablename, rowid, field, subkey, language) {
  const h = createHash("sha256").update([tablename, rowid, field, subkey, language].join("\u0000"), "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** An RFC 4122 version-5 (name-based, SHA-1) UUID of `name` in `namespace` (a UUID string). */
function uuidV5(namespace, name) {
  const digest = createHash("sha1").update(Buffer.from(namespace.replace(/-/g, ""), "hex")).update(name, "utf8").digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The id of the row with this role path in module `n` (n >= 2): `moduleId(2, "lesson", 1)` is the id of `dcrs/m2/lesson/1`. */
const moduleId = (n, ...path) => uuidV5(MODULE_ID_NAMESPACE, ["dcrs", `m${n}`, ...path].join("/"));

/** A moment as the `YYYY-MM-DD HH:MM:SS.mmm` text of a UTC DATETIME(3). */
function utcDatetime(moment) {
  const d = moment instanceof Date ? moment : new Date(moment);
  if (Number.isNaN(d.getTime())) throw new ContentRefused(["now must be a valid moment to plan"]);
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * The texts of one question that get a Khmer translation row, as `{ field, subkey, en, km }`: the question text, the
 * heading text, every option text by option id, and the feedback messages the question has. The fields an answer is
 * graded by (for the question's template) are left out.
 */
function questionTexts(templatetypeid, questionid, q) {
  const all = [
    { field: "questiontext", subkey: "", en: q.text.en, km: q.text.km },
    { field: "headingtext", subkey: "", en: q.text.en, km: q.text.km },
    ...q.options.map((o, j) => ({ field: "questionoptiontext", subkey: `${questionid}-opt-${j + 1}`, en: o.text.en, km: o.text.km })),
    ...FEEDBACK_KEYS.filter((k) => q.feedback && q.feedback[k]).map((k) => ({ field: "feedback", subkey: k, en: q.feedback[k].en, km: q.feedback[k].km })),
  ];
  return all.filter((t) => !isAnswerBearing(templatetypeid, t.field));
}

/**
 * The pass mark a NEW lesson is written with: the lesson's passing_points is 80 (LESSON_PASS_POINTS), or less when the lesson cannot
 * give 80. A lesson with no practice has no practice points to earn, a lesson with no quiz no quiz points, so the points a learner can
 * reach are the learning step's 20 plus 40 for each set that has a question: both 100, one 60, neither 20. The pass mark is the lesser
 * of 80 and that, or a lesson with no practice could never be completed. total_points stays 100 (the level and grade rules count it).
 * The value is written once: the update list of the lesson step does not carry the points columns, so a lesson already in the database
 * keeps the pass mark it has, even when a later file gives it a practice.
 */
function lessonPassingPoints(lesson) {
  const reachable = LESSON_LEARNING_POINTS + (lesson.quiz.length > 0 ? LESSON_QUIZ_POINTS : 0) + (lesson.practice.length > 0 ? LESSON_PRACTICE_POINTS : 0);
  return Math.min(LESSON_PASS_POINTS, reachable);
}

/**
 * The pass mark the student app applies to a lesson row, as `lessonPassMark` there reads it: its passing_points when that is above 0,
 * else APP_PASS_PERCENTAGE of its total_points rounded up, else no mark at all (Infinity: the lesson is never complete, whatever the
 * file says). A stored 0 or NULL therefore means the fallback applies, not "no pass mark".
 */
function storedPassMark(row) {
  const passing = Number(row.passing_points);
  if (Number.isFinite(passing) && passing > 0) return passing;
  const total = Number(row.total_points);
  if (Number.isFinite(total) && total > 0) return Math.ceil((total * APP_PASS_PERCENTAGE) / 100);
  return Number.POSITIVE_INFINITY;
}

/**
 * The points a learner can reach in an EXISTING lesson once the file's sets are in: the lesson's own learning points, plus its quiz
 * points when the file gives it a quiz question, plus its practice points when the file gives it a practice question. A points column
 * the row does not hold (NULL or 0) is read as what a new lesson is written with.
 */
function reachablePoints(row, lesson) {
  const pts = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
  return (
    pts(row.learning_points, LESSON_LEARNING_POINTS) +
    (lesson.quiz.length > 0 ? pts(row.quizzes_points, LESSON_QUIZ_POINTS) : 0) +
    (lesson.practice.length > 0 ? pts(row.practices_points, LESSON_PRACTICE_POINTS) : 0)
  );
}

/** A stored `questionoptioniscorrect` the way the student API reads it (asCorrectFlag in src/business/grading/option.ts): true, 1, "true" or "1". */
function asCorrectFlag(v) {
  return v === true || v === 1 || v === "true" || v === "1";
}

/**
 * Whether a stored question is still exactly what the seed's own placeholder pass wrote for that id: the seed's question identifier and
 * the seed's options, by count, by text and by which one is correct. `seeded` is `{ ident, options: [{ text, correct }] }`, `stored`
 * `{ ident, options }` as `readExisting` reads them. Nothing weaker counts: a question an import has written carries the file's
 * identifier and text, so a real question that differs in shape from the file is never taken for a placeholder, and a placeholder that
 * was changed in any of these ways is not one any more.
 */
function isSeedPlaceholder(stored, seeded) {
  if (!seeded || !stored || stored.ident !== seeded.ident || !Array.isArray(stored.options) || stored.options.length !== seeded.options.length) return false;
  return stored.options.every((o, j) => o && o.questionoptiontext === seeded.options[j].text && asCorrectFlag(o.questionoptioniscorrect) === Boolean(seeded.options[j].correct));
}

/** The four lesson ids of the seed, in lesson order (the seed's id map must agree: a spec checks). */
const LESSON_IDS = [
  "c0000000-0000-4000-8000-000000000008",
  "c0000000-0000-4000-8000-000000000009",
  "c0000000-0000-4000-8000-00000000000a",
  "c0000000-0000-4000-8000-00000000000b",
];

const hex12 = (n) => n.toString(16).padStart(12, "0");

/**
 * The slots of module `moduleNumber`: its level, per lesson the rows that hang from it and the join-row ids it may use, and
 * the question ids. Module 1 (the default) takes its four fixed lessons from the seed's id map and shares one pool of question ids
 * among them; its further lessons (`extraLessons`, lesson 2 on) and every lesson of a later module derive every id from a role path,
 * and each such slot carries its own question ids (`derived: true`).
 */
function slotsOf(ID, moduleNumber = 1) {
  if (moduleNumber !== 1) {
    const id = (...path) => moduleId(moduleNumber, ...path);
    const lessons = derivedLessons(moduleNumber, 1);
    return { moduleNumber, pooled: false, level: id("level"), lessons, extraLessons: [], questions: lessons.flatMap((l) => [...l.practiceQuestions, ...l.quizQuestions]) };
  }
  let extra = 0x32;
  const nextExtra = () => `c0000000-0000-4000-8000-${hex12(extra++)}`;
  const existingQuizJoins = [
    [ID.qqLesson1],
    [ID.qqLesson2Q2, ID.qqLesson2Q3],
    [ID.qqLesson3Q4, ID.qqLesson3Q5, ID.qqLesson3Q6],
    [ID.qqLesson4],
  ];
  const lessons = [1, 2, 3, 4].map((n) => {
    const practiceJoins = [ID[`pqLesson${n}`]];
    while (practiceJoins.length < MAX_QUESTIONS_PER_SET) practiceJoins.push(nextExtra());
    const quizJoins = [...existingQuizJoins[n - 1]];
    while (quizJoins.length < MAX_QUESTIONS_PER_SET) quizJoins.push(nextExtra());
    return {
      n,
      id: ID[`lesson${n}`],
      doc: ID[`doc${n}`],
      learning: ID[`learning${n}`],
      practice: ID[`practice${n}`],
      quiz: ID[`quiz${n}`],
      practiceJoins,
      quizJoins,
    };
  });
  const questions = [ID.q1, ID.q2, ID.q3, ID.q4, ID.q5, ID.q6, ID.q7];
  // Module 1's lessons after the fixed ones: derived from role paths of module 1, each slot with its own question ids (lesson 1 is the fixed one).
  const extraLessons = derivedLessons(1, 2);
  return { moduleNumber: 1, pooled: true, level: ID.level, lessons, extraLessons, questions };
}

/** The derived lesson slots of module `moduleNumber` from lesson `from` to MAX_LESSONS_LATER_MODULE: every id from a role path, every slot with its own question ids. */
function derivedLessons(moduleNumber, from) {
  const id = (...path) => moduleId(moduleNumber, ...path);
  const upTo = (n) => Array.from({ length: n }, (_, i) => i + 1);
  return upTo(MAX_LESSONS_LATER_MODULE)
    .filter((n) => n >= from)
    .map((n) => ({
      n,
      derived: true,
      id: id("lesson", n),
      doc: id("doc", n),
      learning: id("learning", n),
      practice: id("practice", n),
      quiz: id("quiz", n),
      practiceJoins: upTo(MAX_QUESTIONS_PER_SET).map((j) => id("join", "practice", n, j)),
      quizJoins: upTo(MAX_QUESTIONS_PER_SET).map((j) => id("join", "quiz", n, j)),
      practiceQuestions: upTo(MAX_QUESTIONS_PER_SET).map((j) => id("q", "practice", n, j)),
      quizQuestions: upTo(MAX_QUESTIONS_PER_SET).map((j) => id("q", "quiz", n, j)),
    }));
}

/** Every lesson slot of a slot set: the module's own, and Module 1's derived ones after the fixed four. */
const lessonSlotsOf = (slots) => [...slots.lessons, ...(slots.extraLessons ?? [])];

/** Every question id of a slot set (Module 1's seven fixed ones, and the derived lessons' own). */
const questionIdsOf = (slots) => [...slots.questions, ...(slots.extraLessons ?? []).flatMap((l) => [...l.practiceQuestions, ...l.quizQuestions])];

/** Every id a slot set holds (the level, and each lesson's rows, joins and questions). */
function idsOfSlots(slots) {
  const all = [slots.level, ...questionIdsOf(slots)];
  for (const l of lessonSlotsOf(slots)) all.push(l.id, l.doc, l.learning, l.practice, l.quiz, ...l.practiceJoins, ...l.quizJoins);
  return all;
}

/**
 * Checks a parsed content.json; returns it unchanged when it is acceptable, throws
 * ContentRefused (every problem listed) when not.
 */
function validateContent(content, ID) {
  const problems = [];
  const bilingual = (v, where) => {
    if (!isObject(v) || !isText(v.en) || !isText(v.km)) problems.push(`${where} needs a non-empty "en" and "km"`);
    else if (Buffer.byteLength(v.km, "utf8") > TRANSLATION_TEXT_MAX_BYTES) problems.push(`${where}.km is too long to store as a translation`);
  };
  if (!isObject(content)) throw new ContentRefused(["content.json is not an object"]);
  if (content.curriculum !== undefined || content.level !== undefined) throw new ContentRefused([OLD_SHAPE]);
  if (content.programme === undefined) {
    problems.push('programme is missing; it is required, as "programme": { "en": "...", "km": "..." } (the curriculum and the grade are named after it)');
  } else {
    bilingual(content.programme, "programme");
    // a programme's name is one line: the header that shows it has no room for a break
    for (const lang of ["en", "km"]) {
      if (isObject(content.programme) && typeof content.programme[lang] === "string" && /[\r\n\u2028\u2029]/.test(content.programme[lang])) {
        problems.push(`programme.${lang} must be one line (it has a line break)`);
      }
    }
  }
  let moduleNumber = null;
  if (!isObject(content.module)) problems.push('module is missing; it is required, as "module": { "number": N, "name": { "en": "...", "km": "..." } }');
  else {
    if (!Number.isSafeInteger(content.module.number) || content.module.number < 1) problems.push("module.number must be a whole number from 1");
    else moduleNumber = content.module.number;
    bilingual(content.module.name, "module.name");
  }
  if (!Array.isArray(content.lessons) || content.lessons.length === 0) {
    problems.push("lessons must be a non-empty list");
    throw new ContentRefused(problems);
  }

  // Module 1 is four fixed lessons (and is what a file whose number is unusable is checked as) and derived slots from lesson 2; a later module's lessons are its 12 slots by order.
  const later = moduleNumber !== null && moduleNumber !== 1;
  const slots = slotsOf(ID, moduleNumber ?? 1);
  const fixedLessonIds = new Set(slots.lessons.map((l) => l.id));
  const seenLessons = new Set();
  const seenOrders = new Set();
  let pooledQuestions = 0; // the questions of the lessons that draw from Module 1's seven fixed question ids
  const seenIdents = new Set();
  const seenFiles = new Set();
  content.lessons.forEach((lesson, i) => {
    const at = `lessons[${i}]`;
    if (!isObject(lesson)) {
      problems.push(`${at} is not an object`);
      return;
    }
    if (later) {
      if (lesson.id !== undefined) problems.push(`${at}.id must not be given for module ${moduleNumber}: its lessons are identified by their order`);
      if (!Number.isInteger(lesson.order) || lesson.order < 1 || lesson.order > MAX_LESSONS_LATER_MODULE) {
        problems.push(`${at}.order must be a whole number from 1 to ${MAX_LESSONS_LATER_MODULE} (it is also the lesson's slot in the module)`);
      } else if (seenOrders.has(lesson.order)) problems.push(`${at}.order ${lesson.order} is used by another lesson`);
      else seenOrders.add(lesson.order);
    } else if (lesson.id === undefined) {
      // Module 1's lesson with no id: a derived slot, identified by its order. Lesson 1 is the fixed one and must name its id.
      if (!Number.isInteger(lesson.order) || lesson.order < 2 || lesson.order > MAX_LESSONS_LATER_MODULE) {
        problems.push(
          `${at}.order must be a whole number from 2 to ${MAX_LESSONS_LATER_MODULE} for a Module 1 lesson with no id (it is also the lesson's slot; lesson 1 names the fixed id ${LESSON_IDS[0]})`,
        );
      } else if (seenOrders.has(lesson.order)) problems.push(`${at}.order ${lesson.order} is used by another lesson`);
      else seenOrders.add(lesson.order);
    } else {
      let namedTwice = false;
      if (typeof lesson.id !== "string" || !fixedLessonIds.has(lesson.id)) problems.push(`${at}.id is not a DCRS fixed lesson id`);
      else if (seenLessons.has(lesson.id)) {
        namedTwice = true;
        problems.push(`${at}.id is named twice`);
      } else seenLessons.add(lesson.id);
      if (!Number.isInteger(lesson.order) || lesson.order < 1) problems.push(`${at}.order must be a whole number from 1`);
      else if (!namedTwice && seenOrders.has(lesson.order)) problems.push(`${at}.order ${lesson.order} is used by another lesson`);
      else seenOrders.add(lesson.order);
    }
    bilingual(lesson.name, `${at}.name`);
    if (!isObject(lesson.video) || !isText(lesson.video.ref)) problems.push(`${at}.video.ref is missing`);
    else if (lesson.video.keep !== undefined && lesson.video.keep !== true) problems.push(`${at}.video.keep must be true when given`);
    else if (lesson.video.keep === true) {
      // The lesson's existing video document is left exactly as it is: there is no file name to write and no file to copy.
      if (lesson.video.filename !== undefined || lesson.video.source !== undefined) {
        problems.push(`${at}.video keeps the lesson's existing video, so it has no filename and no source`);
      }
    } else if (typeof lesson.video.filename !== "string" || !FILENAME.test(lesson.video.filename)) {
      problems.push(`${at}.video.filename must be a bare key like dcrs-m1-l1.mp4`);
    } else if (seenFiles.has(lesson.video.filename)) problems.push(`${at}.video.filename is used by another lesson`);
    else seenFiles.add(lesson.video.filename);
    if (isObject(lesson.video) && lesson.video.keep !== true && lesson.video.source !== undefined && !isText(lesson.video.source)) {
      problems.push(`${at}.video.source must be text when given`);
    }

    for (const kind of ["practice", "quiz"]) {
      const list = lesson[kind];
      if (!Array.isArray(list)) {
        problems.push(`${at}.${kind} must be a list`);
        continue;
      }
      if (list.length > MAX_QUESTIONS_PER_SET) {
        problems.push(`${at}.${kind} names ${list.length} questions; a lesson has room for ${MAX_QUESTIONS_PER_SET}`);
      }
      if (!later && lesson.id !== undefined) pooledQuestions += list.length;
      list.forEach((q, j) => {
        const qat = `${at}.${kind}[${j}]`;
        if (!isObject(q)) {
          problems.push(`${qat} is not an object`);
          return;
        }
        if (typeof q.ident !== "string" || !IDENT.test(q.ident)) problems.push(`${qat}.ident must look like DCRS-M1-P1`);
        else if (seenIdents.has(q.ident)) problems.push(`${qat}.ident ${q.ident} is used twice`);
        else seenIdents.add(q.ident);
        bilingual(q.text, `${qat}.text`);
        if (!Array.isArray(q.options)) {
          problems.push(`${qat}.options must be a list`);
          return;
        }
        if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
          problems.push(`${qat} has ${q.options.length} options; it needs ${MIN_OPTIONS} to ${MAX_OPTIONS}`);
        }
        if (q.feedback !== undefined) {
          if (!isObject(q.feedback)) problems.push(`${qat}.feedback must be an object when given`);
          else {
            for (const key of Object.keys(q.feedback)) {
              if (!FEEDBACK_KEYS.includes(key)) problems.push(`${qat}.feedback.${key} is not a message (${FEEDBACK_KEYS.join(", ")})`);
              else bilingual(q.feedback[key], `${qat}.feedback.${key}`);
            }
          }
        }
        let correct = 0;
        q.options.forEach((o, k) => {
          if (!isObject(o) || typeof o.correct !== "boolean") problems.push(`${qat}.options[${k}] needs a true/false "correct"`);
          else if (o.correct) correct += 1;
          bilingual(isObject(o) ? o.text : undefined, `${qat}.options[${k}].text`);
        });
        if (correct !== 1) problems.push(`${qat} has ${correct} correct options; it needs exactly 1`);
      });
    }
  });
  // Module 1's fixed lessons draw their questions from the seed's seven fixed ids; every other lesson has a place for each of its own.
  if (!later && pooledQuestions > slots.questions.length) {
    problems.push(`the lessons that name a fixed lesson id have ${pooledQuestions} questions between them; the seed has ${slots.questions.length} fixed question ids`);
  }
  if (problems.length > 0) throw new ContentRefused(problems);
  return content;
}

const optionRow = (i, text, correct) => ({
  questionoptionid: null,
  questionoptiontext: text,
  questionoptionvalue: text,
  questionoptioniscorrect: correct,
  questionoptionsequence: i,
  questionoptionistext: true,
  questionoptionisfraction: false,
  questionoptionisstaticfile: false,
  questionoptionfile: null,
  questionassociate: null,
  questionoptionnumeratorisstatic: false,
  questionoptionnumeratorvalue: "",
  questionoptiondenominatorisstatic: false,
  questionoptiondenominatorvalue: "",
});

/**
 * The plan for a validated content file.
 *
 * `ID` is the seed's id map; `organisationid` owns the rows a fresh insert would create and the
 * translation rows; `now` (a Date) is the time the translation rows are stamped with; `levelSwitch` is "draft" (the module's level
 * written switched off, `levelstatus` 0: built, not shown to learners), "live" (switched on) or null (neither: an existing level keeps
 * its switch, a new level is refused); `renameLessons` allows a later module's lesson slot to take another name.
 * `existing` is what the database holds that the plan needs to know, or null when it is not known (a dry run):
 * `{ levels: [{ levelid, levelstatus, isdeleted, points, quiz_points, levelquizrows }] }` for every level of the grade (`levelquizrows`: how
 * many active level-quiz questions it has), and
 * `lessons: [{ lessonid, lessonname, isdeleted, total_points }]` for the module's lesson slots that exist, and
 * `questions: [{ questionid, roles, options }]` for the module's question slots that exist (`roles`: "practice" and/or "quiz", the sets with an
 * active join row for it; `options`: its stored option rows, or null when they cannot be read) (`readExisting` in dcrs-content-apply.js).
 * Returns `{ baseLanguage, translationLanguage, organisationid, module, curriculumName, requires, steps, media, owned, notices }` (`notices`: what the
 * file does to existing rows that the run says in words and does not refuse; empty on a dry run). A step is one of
 *   `{ kind: "upsert", table, pk, id, values, update }`  (INSERT ... ON DUPLICATE KEY UPDATE `update` columns)
 *   `{ kind: "translate", table: "contenttranslations", pk, id, values, update, touch }`  (the same, and `touch`
 *      (`lastupdated`) is only moved when a column of `update` changes)
 *   `{ kind: "hide", table, pk, ids, set }`              (UPDATE ... SET `set` WHERE pk IN ids)
 * Insert values outside `update` only matter for a row that is not there yet (the seed's
 * own placeholder pass normally creates them first), and never overwrite one that is.
 * `owned` lists the seed rows that must belong to `organisationid` (or to nobody yet) for the translations to be its own.
 * `requires` lists the rows that must already be in the database (the curriculum and the grade, for a module after the first).
 * `module` is `{ number, levelid, levelorder, levelstatus, levelpoints, gradepoints, levelIsNew }`; `levelstatus` is null when it is not
 * known (a dry run with neither flag), `levelIsNew` null when `existing` is null.
 */
function planContent(content, ID, { organisationid, now, levelSwitch = null, renameLessons = false, existing = null } = {}) {
  validateContent(content, ID);
  if (!isText(organisationid)) throw new ContentRefused(["organisationid is required to plan"]);
  if (levelSwitch !== null && !LEVEL_SWITCHES.includes(levelSwitch)) throw new ContentRefused(['levelSwitch must be "draft", "live" or null']);
  if (typeof renameLessons !== "boolean") throw new ContentRefused(["renameLessons must be true or false"]);
  const stamp = utcDatetime(now);
  const moduleNumber = content.module.number;
  const later = moduleNumber !== 1;
  const slots = slotsOf(ID, moduleNumber);
  // The reasons a run is refused for what the database holds or what the flags say; every one is listed.
  const problems = [];
  if (levelSwitch === "draft" && !later) {
    problems.push("--draft is refused for module 1: it is the delivered module, and a learner already reads it; switch a later module off, not this one");
  }
  const ownLevel = existing === null ? null : existing.levels.find((l) => l.levelid === slots.level) ?? null;
  if (existing !== null && ownLevel === null && levelSwitch === null) {
    problems.push(
      `module ${moduleNumber}'s level is not in the database yet; say whether learners see it: --draft (switched off, built but not shown) or --live (switched on)`,
    );
  }
  if (later) {
    // No id of a later module may equal one of Module 1's ids (the seed's whole id map, and Module 1's slots, derived ones too).
    const taken = new Set([...Object.values(ID), ...idsOfSlots(slotsOf(ID, 1))]);
    const clash = idsOfSlots(slots).filter((id) => taken.has(id));
    if (clash.length > 0 || new Set(idsOfSlots(slots)).size !== idsOfSlots(slots).length) {
      throw new Error(`module ${moduleNumber}: its derived ids are not distinct from Module 1's fixed ids`);
    }
  } else {
    // Module 1's derived lessons must not take an id the seed's id map already holds, and no id may be twice in the slots.
    const fixed = new Set(Object.values(ID));
    const derivedIds = lessonSlotsOf(slots).filter((l) => l.derived).flatMap((l) => idsOfSlots({ level: l.id, questions: [...l.practiceQuestions, ...l.quizQuestions], lessons: [l] }));
    if (derivedIds.some((id) => fixed.has(id)) || new Set(idsOfSlots(slots)).size !== idsOfSlots(slots).length) {
      throw new Error("module 1: its derived ids are not distinct from the seed's fixed ids");
    }
  }
  const t = (text) => text.en;
  const translations = [];
  const translate = (tablename, rowid, field, subkey, text, programmeRow = false) =>
    translations.push({ tablename, rowid, field, subkey, en: text.en, km: text.km, programmeRow });
  const steps = [];
  const upsert = (table, pk, values, update) => steps.push({ kind: "upsert", table, pk, id: values[pk], values, update });
  const hide = (table, pk, ids, set) => {
    if (ids.length > 0) steps.push({ kind: "hide", table, pk, ids: [...new Set(ids)], set });
  };

  // The slot of a named lesson: a Module 1 fixed lesson by its fixed id; every other lesson (a later module's, Module 1's from lesson 2) by its order.
  const allSlots = lessonSlotsOf(slots);
  const slotOfLesson = (lesson) =>
    later || lesson.id === undefined ? slots.lessons.concat(slots.extraLessons).find((s) => s.derived && s.n === lesson.order) : slots.lessons.find((s) => s.id === lesson.id);
  const named = new Map(content.lessons.map((l) => [slotOfLesson(l).id, l]));
  const live = allSlots.filter((s) => named.has(s.id)).sort((a, b) => named.get(a.id).order - named.get(b.id).order);
  const hidden = allSlots.filter((s) => !named.has(s.id));

  // A derived lesson slot must not change meaning under a re-run: an existing lesson of the slot, hidden or not, keeps its name unless the rename is asked for.
  // (Module 1's fixed lesson 1 is not a derived slot: its text is meant to be edited by the file.)
  if (existing !== null && !renameLessons) {
    for (const lesson of content.lessons) {
      const slot = slotOfLesson(lesson);
      if (!slot.derived) continue;
      const row = existing.lessons.find((l) => l.lessonid === slot.id);
      if (row && row.lessonname !== lesson.name.en) {
        problems.push(
          `module ${moduleNumber}, lesson slot ${lesson.order}: the lesson there now (hidden or not) has another English name than the file's; give the new lesson a new order (--rename-lessons renames it in place)`,
        );
      }
    }
  }
  if (problems.length > 0) throw new ContentRefused(problems);

  // The switch, and the points by central's rule. An existing level keeps its switch when neither flag is given (and then the run does not write the column).
  const levelstatus = levelSwitch === "draft" ? 0 : levelSwitch === "live" ? 1 : ownLevel !== null ? Number(ownLevel.levelstatus) : null;
  // A lesson that is already there keeps the total_points it has (the run does not write that column); a new one is written with LESSON_TOTAL_POINTS.
  const lessonPoints = (slot) => {
    const row = existing === null ? undefined : existing.lessons.find((l) => l.lessonid === slot.id);
    return row ? Number(row.total_points ?? 0) : LESSON_TOTAL_POINTS;
  };
  // The level's quiz points count only when the level has an active level-quiz row (a new level has none; the import writes none).
  const quizPoints = ownLevel !== null && Number(ownLevel.levelquizrows ?? 0) > 0 ? Number(ownLevel.quiz_points ?? 0) : 0;
  const levelpoints = live.reduce((sum, slot) => sum + lessonPoints(slot), 0) + quizPoints;
  const siblings = existing === null ? [] : existing.levels.filter((l) => l.levelid !== slots.level);
  const gradepoints =
    siblings.filter((l) => Number(l.levelstatus) === 1 && !Number(l.isdeleted)).reduce((sum, l) => sum + Number(l.points ?? 0), 0) + (levelstatus === 0 ? 0 : levelpoints);

  // The curriculum is the programme. A later module only renames it (and never changes its status, its description or its owner).
  upsert(
    "curriculums",
    "curriculumid",
    {
      curriculumid: ID.curriculum,
      curriculumname: t(content.programme),
      curriculumstatus: 1,
      curriculumdescription: "",
      isdeleted: 0,
      subjectid: ID.subject,
      organisationid,
    },
    later ? ["curriculumname"] : ["curriculumname", "curriculumdescription", "curriculumstatus", "isdeleted"],
  );
  translate("curriculums", ID.curriculum, "curriculumname", "", content.programme, true);
  // The grade is the programme's one track and keeps its name; the navigation shows it and it cannot be empty.
  upsert(
    "grades",
    "gradeid",
    {
      gradeid: ID.grade,
      curriculumid: ID.curriculum,
      gradestatus: 1,
      gradename: t(content.programme),
      gradedescription: "",
      gradeorder: 1,
      isdeleted: 0,
      passing_points: 80,
      points: gradepoints,
    },
    later ? ["gradename", "points"] : ["gradename", "gradedescription", "gradestatus", "isdeleted", "points"],
  );
  translate("grades", ID.grade, "gradename", "", content.programme, true);
  // Each module is a level under that grade, in module order.
  upsert(
    "levels",
    "levelid",
    {
      levelid: slots.level,
      gradeid: ID.grade,
      levelname: t(content.module.name),
      leveldescription: "",
      isdeleted: 0,
      levelstatus: levelstatus ?? 1,
      levelorder: moduleNumber,
      passing_points: 80,
      quiz_points: DEFAULT_QUIZ_POINTS,
      points: levelpoints,
    },
    [
      "levelname",
      "leveldescription",
      ...(levelSwitch !== null ? ["levelstatus"] : []),
      ...(later ? ["levelorder"] : []),
      "points",
      "isdeleted",
    ],
  );
  translate("levels", slots.level, "levelname", "", content.module.name);

  // Which question id each question takes. Module 1: in order through the live lessons, practice before quiz, from the seed's seven.
  // A later module: the id of its own role (this lesson's slot, this kind, this place).
  let nextQuestion = 0;
  const assigned = [];
  const placed = live.map((slot) => {
    const lesson = named.get(slot.id);
    const take = (list, kind) =>
      list.map((q, j) => {
        const id = slot.derived ? (kind === "practice" ? slot.practiceQuestions : slot.quizQuestions)[j] : slots.questions[nextQuestion++];
        assigned.push(id);
        return { q, id, kind, join: (kind === "practice" ? slot.practiceJoins : slot.quizJoins)[j] };
      });
    return { slot, lesson, practice: take(lesson.practice, "practice"), quiz: take(lesson.quiz, "quiz") };
  });

  // A question that is already in the database keeps its meaning: the id is what a learner's answers hang from. So a file is refused, before
  // anything is written, when it would put an existing question in the other set (practice or quiz), give it another number of options, or
  // move its correct option. Text-only changes pass. This reads every question the file names, whatever the id is derived from.
  const notices = [];
  if (existing !== null) {
    const rows = new Map((existing.questions ?? []).map((r) => [r.questionid, r]));
    const changes = [];
    for (const { lesson, practice, quiz } of placed) {
      for (const [kind, list] of [["practice", practice], ["quiz", quiz]]) {
        list.forEach(({ q, id }, j) => {
          const row = rows.get(id);
          // A question the seed's placeholder pass wrote and nothing has replaced yet has no meaning to keep: the file gives it its first.
          if (!row || row.placeholder === true) return;
          const at = `lesson ${lesson.order} (row ${lesson.order + 1} of the sheet), ${kind} question ${j + 1}`;
          if (Array.isArray(row.roles) && row.roles.length > 0 && !row.roles.includes(kind)) {
            changes.push(`${at}: the question with this id is a ${row.roles.join(" and ")} question in the database, and the file puts it in the ${kind}; a question cannot move between sets`);
          }
          if (Array.isArray(row.options)) {
            if (row.options.length !== q.options.length) {
              changes.push(`${at}: it has ${row.options.length} options in the database and ${q.options.length} in the file; the number of options of an existing question cannot change`);
            } else if (row.options.findIndex((o) => asCorrectFlag(o.questionoptioniscorrect)) !== q.options.findIndex((o) => o.correct)) {
              changes.push(`${at}: the file marks another option correct than the database does; the correct option of an existing question cannot move`);
            }
          }
        });
      }
    }
    // An existing lesson keeps the pass mark it has (the lesson step does not rewrite it), so a file that takes a set away from it must
    // not leave the mark above what a learner can then reach: the lesson could never be completed.
    for (const { slot, lesson } of placed) {
      const row = existing.lessons.find((l) => l.lessonid === slot.id);
      if (!row) continue;
      const at = `lesson ${lesson.order} (row ${lesson.order + 1} of the sheet)`;
      const mark = storedPassMark(row);
      const reachable = reachablePoints(row, lesson);
      // Infinity: the row already has no pass mark the app can use, and this file does not change that.
      if (Number.isFinite(mark) && mark > reachable) {
        const how = Number(row.passing_points) > 0 ? `a stored pass mark of ${mark}` : `no stored pass mark, so the app's ${APP_PASS_PERCENTAGE}% of its ${Number(row.total_points)} points, ${mark}`;
        changes.push(
          `${at}: the lesson in the database has ${how}, and with the sets this file gives it a learner can reach ${reachable}; it could never be completed ` +
            "(keep the set, or lower the lesson's pass mark in the database first)",
        );
      }
      // A set the lesson did not have: the lesson's counts and pass mark are not rewritten, so say so.
      const gained = [
        ...(lesson.practice.length > 0 && row.practicecount !== undefined && !Number(row.practicecount) ? ["a practice"] : []),
        ...(lesson.quiz.length > 0 && row.quizcount !== undefined && !Number(row.quizcount) ? ["a quiz"] : []),
      ];
      if (gained.length > 0) {
        notices.push(`${at} gains ${gained.join(" and ")}: its pass mark (${Number.isFinite(mark) ? mark : "none"}) and its practice and quiz counts stay as the database has them; this import does not rewrite them`);
      }
    }
    if (changes.length > 0) throw new ContentRefused(changes);
  }

  for (const { slot, lesson } of placed) {
    upsert(
      "lessons",
      "lessonid",
      {
        lessonid: slot.id,
        levelid: slots.level,
        lessonname: t(lesson.name),
        lessondescription: "",
        practicecount: lesson.practice.length > 0 ? 1 : 0,
        quizcount: lesson.quiz.length > 0 ? 1 : 0,
        lessonpasspercentage: 80,
        lessonorder: lesson.order,
        lessonstatus: 1,
        isdeleted: 0,
        total_points: LESSON_TOTAL_POINTS,
        passing_points: lessonPassingPoints(lesson),
        learning_points: LESSON_LEARNING_POINTS,
        quizzes_points: LESSON_QUIZ_POINTS,
        practices_points: LESSON_PRACTICE_POINTS,
      },
      ["lessonname", "lessondescription", "lessonorder", "lessonstatus", "isdeleted"],
    );
    translate("lessons", slot.id, "lessonname", "", lesson.name);
    // A lesson whose video is kept has no documents step: the row it has (the file it names, its meta, its switch) is left exactly as it is.
    if (lesson.video.keep !== true) {
      upsert(
        "documents",
        "documentid",
        {
          documentid: slot.doc,
          documenttypeid: 2,
          documentname: lesson.video.filename,
          documents3meta: JSON.stringify({ seeded: true, media: "folder" }),
          isdeleted: 0,
          documenttags: JSON.stringify(["dcrs"]),
          organisationid,
        },
        ["documentname", "documents3meta", "isdeleted"],
      );
    }
    upsert(
      "lessonlearnings",
      "lessonlearningid",
      {
        lessonlearningid: slot.learning,
        lessonlearningname: t(lesson.name),
        lessonlearningdescription: "",
        lessonlearningstatus: 1,
        lessonid: slot.id,
        documentid: slot.doc,
        lessonlearningorder: 1,
        points: 20,
      },
      ["lessonlearningname", "lessonlearningdescription", "lessonlearningstatus"],
    );
    translate("lessonlearnings", slot.learning, "lessonlearningname", "", lesson.name);
    upsert(
      "lessonpractices",
      "lessonpracticeid",
      {
        lessonpracticeid: slot.practice,
        lessonid: slot.id,
        lessonpracticeorder: 1,
        lessonpracticestatus: lesson.practice.length > 0 ? 1 : 0, // a set with no question is not shown: the app would list a step it cannot finish
        lessonpracticename: t(lesson.name),
        lessonpracticedescription: "",
        points: 40,
      },
      ["lessonpracticename", "lessonpracticedescription", "lessonpracticestatus"],
    );
    translate("lessonpractices", slot.practice, "lessonpracticename", "", lesson.name);
    upsert(
      "lessonquizzes",
      "lessonquizid",
      {
        lessonquizid: slot.quiz,
        lessonid: slot.id,
        lessonquizorder: 1,
        lessonquizname: t(lesson.name),
        lessonquizstatus: lesson.quiz.length > 0 ? 1 : 0, // likewise
        lessonquizdescription: "",
        points: 40,
      },
      ["lessonquizname", "lessonquizdescription", "lessonquizstatus"],
    );
    translate("lessonquizzes", slot.quiz, "lessonquizname", "", lesson.name);
  }

  const questionUpdate = [
    "questionheading",
    "questionoptions",
    "questiontext",
    "questiondistractors",
    "questionfile",
    "templatetypeid",
    "isdeleted",
    "questionstatus",
    "questionidentifier",
    "questiontags",
    "questioncorrectvalue",
    "questionfeedback",
  ];
  for (const { practice, quiz } of placed) {
    for (const { q, id } of [...practice, ...quiz]) {
      const text = t(q.text);
      const options = q.options.map((o, j) => ({ ...optionRow(j + 1, t(o.text), o.correct), questionoptionid: `${id}-opt-${j + 1}` }));
      upsert(
        "questions",
        "questionid",
        {
          questionid: id,
          questionheading: JSON.stringify({ headingtext: text, headingfile: null }),
          questionoptions: JSON.stringify(options),
          questiontext: text,
          questiondistractors: JSON.stringify([]),
          questionfile: null,
          templatetypeid: 1,
          isdeleted: 0,
          questionstatus: 1,
          questionidentifier: q.ident,
          questiontags: JSON.stringify(["demo", "dcrs"]),
          questioncorrectvalue: null,
          questionfeedback: q.feedback ? JSON.stringify(Object.fromEntries(FEEDBACK_KEYS.filter((k) => q.feedback[k]).map((k) => [k, t(q.feedback[k])]))) : null,
          organisationid,
        },
        questionUpdate,
      );
      for (const x of questionTexts(QUESTION_TEMPLATE, id, q)) translate("questions", id, x.field, x.subkey, x);
    }
  }
  for (const { slot, practice, quiz } of placed) {
    practice.forEach(({ id, join }, j) =>
      upsert(
        "lessonpracticequestions",
        "lessonpracticequestionid",
        { lessonpracticequestionid: join, lessonpracticeid: slot.practice, lessonpracticequestionstatus: 1, questionid: id, lessonpracticequestionorder: j + 1 },
        ["lessonpracticeid", "lessonpracticequestionstatus", "questionid", "lessonpracticequestionorder"],
      ),
    );
    quiz.forEach(({ id, join }, j) =>
      upsert(
        "lessonquizquestions",
        "lessonquizquestionid",
        { lessonquizquestionid: join, lessonquizid: slot.quiz, questionid: id, lessonquizquestionstatus: 1, lessonquizquestionorder: j + 1 },
        ["lessonquizid", "questionid", "lessonquizquestionstatus", "lessonquizquestionorder"],
      ),
    );
  }

  // The Khmer text, one row per text, after every row it hangs from. The programme's rows (curriculum, grade) keep the id Module 1 gives
  // them whichever module writes them; every other row of a later module takes a version-5 id from its role path.
  for (const x of translations) {
    const values = {
      translationid:
        later && !x.programmeRow
          ? moduleId(moduleNumber, "tr", x.tablename, x.rowid, x.field, x.subkey)
          : translationId(x.tablename, x.rowid, x.field, x.subkey, TRANSLATION_LANGUAGE),
      organisationid,
      tablename: x.tablename,
      rowid: x.rowid,
      field: x.field,
      subkey: x.subkey,
      language: TRANSLATION_LANGUAGE,
      text: x.km,
      sourcehash: sourceHash(x.en),
      lastupdated: stamp,
    };
    steps.push({ kind: "translate", table: "contenttranslations", pk: "translationid", id: values.translationid, values, update: ["text", "sourcehash"], touch: "lastupdated" });
  }

  // Hidden, reversibly: what the file does not name, in this module's own slots only.
  hide("lessons", "lessonid", hidden.map((s) => s.id), { isdeleted: 1 });
  hide("documents", "documentid", hidden.map((s) => s.doc), { isdeleted: 1 });
  hide("lessonlearnings", "lessonlearningid", hidden.map((s) => s.learning), { lessonlearningstatus: 0 });
  hide("lessonpractices", "lessonpracticeid", hidden.map((s) => s.practice), { lessonpracticestatus: 0 });
  hide("lessonquizzes", "lessonquizid", hidden.map((s) => s.quiz), { lessonquizstatus: 0 });
  const usedPracticeJoins = new Set(placed.flatMap((p) => p.practice.map((x) => x.join)));
  const usedQuizJoins = new Set(placed.flatMap((p) => p.quiz.map((x) => x.join)));
  hide(
    "lessonpracticequestions",
    "lessonpracticequestionid",
    allSlots.flatMap((s) => s.practiceJoins).filter((id) => !usedPracticeJoins.has(id)),
    { lessonpracticequestionstatus: 0 },
  );
  hide(
    "lessonquizquestions",
    "lessonquizquestionid",
    allSlots.flatMap((s) => s.quizJoins).filter((id) => !usedQuizJoins.has(id)),
    { lessonquizquestionstatus: 0 },
  );
  hide("questions", "questionid", questionIdsOf(slots).filter((id) => !assigned.includes(id)), { isdeleted: 1 });

  // One entry per lesson: a file to copy, or (keep) a video left alone, in which case there is nothing to copy.
  const media = placed.map(({ slot, lesson }) => ({
    lessonid: slot.id,
    order: lesson.order,
    ref: lesson.video.ref,
    keep: lesson.video.keep === true,
    source: lesson.video.keep === true ? null : lesson.video.source ?? null,
    filename: lesson.video.keep === true ? null : lesson.video.filename,
  }));
  const owned = [
    { table: "curriculums", pk: "curriculumid", ids: [ID.curriculum] },
    { table: "documents", pk: "documentid", ids: placed.map((p) => p.slot.doc) }, // a kept video's row too: its owner is the organisation's or nobody's
    { table: "questions", pk: "questionid", ids: assigned },
  ];
  // A module after the first attaches to the curriculum and the grade that exist; it never creates them. A kept video needs the document row it keeps.
  const requires = [
    ...(later
      ? [
          { what: "curriculum", table: "curriculums", pk: "curriculumid", ids: [ID.curriculum] },
          { what: "grade", table: "grades", pk: "gradeid", ids: [ID.grade] },
        ]
      : []),
    ...placed
      .filter(({ lesson }) => lesson.video.keep === true)
      .map(({ slot, lesson }) => ({ what: `lesson ${lesson.order}'s video document`, kept: true, table: "documents", pk: "documentid", ids: [slot.doc] })),
  ];
  return {
    baseLanguage: BASE_LANGUAGE,
    translationLanguage: TRANSLATION_LANGUAGE,
    organisationid,
    module: { number: moduleNumber, levelid: slots.level, levelorder: moduleNumber, levelstatus, levelpoints, gradepoints, levelIsNew: existing === null ? null : ownLevel === null },
    curriculumid: ID.curriculum,
    curriculumName: t(content.programme),
    requires,
    steps,
    media,
    owned,
    notices,
  };
}

/** The SQL and parameters of one step. Identifiers come from the plan, which only this file builds. */
function statementOf(step) {
  const q = (name) => `\`${name}\``;
  if (step.kind === "translate") {
    // `lastupdated` is assigned first, because MySQL evaluates the assignments in order and the changed-or-not test must still see the old text and hash.
    const cols = Object.keys(step.values);
    const changed = `BINARY ${q("text")} <> BINARY VALUES(${q("text")}) OR ${q("sourcehash")} <> VALUES(${q("sourcehash")})`;
    return {
      sql:
        `INSERT INTO ${q(step.table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ` +
        `ON DUPLICATE KEY UPDATE ${q(step.touch)} = IF(${changed}, VALUES(${q(step.touch)}), ${q(step.touch)}), ` +
        step.update.map((c) => `${q(c)} = VALUES(${q(c)})`).join(", "),
      params: cols.map((c) => step.values[c]),
    };
  }
  if (step.kind === "upsert") {
    const cols = Object.keys(step.values);
    return {
      sql:
        `INSERT INTO ${q(step.table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ` +
        `ON DUPLICATE KEY UPDATE ${step.update.map((c) => `${q(c)} = VALUES(${q(c)})`).join(", ")}`,
      params: cols.map((c) => step.values[c]),
    };
  }
  const set = Object.keys(step.set);
  return {
    sql: `UPDATE ${q(step.table)} SET ${set.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${q(step.pk)} IN (${step.ids.map(() => "?").join(", ")})`,
    params: [...set.map((c) => step.set[c]), ...step.ids],
  };
}

module.exports = {
  LESSON_IDS,
  BASE_LANGUAGE,
  TRANSLATION_LANGUAGE,
  ANSWER_BEARING_FIELDS,
  FILENAME,
  MODULE_ID_NAMESPACE,
  LESSON_TOTAL_POINTS,
  DEFAULT_QUIZ_POINTS,
  lessonPassingPoints,
  storedPassMark,
  reachablePoints,
  asCorrectFlag,
  isSeedPlaceholder,
  MAX_LESSONS_LATER_MODULE,
  OLD_SHAPE,
  ContentRefused,
  validateContent,
  planContent,
  statementOf,
  slotsOf,
  lessonSlotsOf,
  questionIdsOf,
  idsOfSlots,
  uuidV5,
  moduleId,
  sourceHash,
  translationId,
  questionTexts,
  isAnswerBearing,
};
