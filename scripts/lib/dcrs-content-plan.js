/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * The pure half of `seed:dcrs -- --content <dir>`: turns a `content.json` into a plan
 * of row writes for the fixed DCRS ids, and refuses a content file that cannot be
 * written as it stands. Nothing here touches a database or a file.
 *
 * This file is a verbatim twin: edtech-lms-api/scripts/lib/dcrs-content-plan.js and
 * edtech-lms-rpi-api/scripts/lib/dcrs-content-plan.js must stay byte-identical (a spec
 * in each repo pins the hash; change both, then both hashes).
 *
 * content.json
 * ```
 * { "curriculum": { "name": { "en": "...", "km": "..." } },
 *   "level":      { "name": { "en": "...", "km": "..." } },          // optional
 *   "lessons": [ {
 *     "id": "<one of the four fixed DCRS lesson ids>", "order": 1,
 *     "name":  { "en": "...", "km": "..." },
 *     "video": { "ref": "...", "filename": "dcrs-m1-l1.mp4", "source": "..." },   // source optional
 *     "practice": [ QUESTION, ... ], "quiz": [ QUESTION, ... ] } ] }
 * QUESTION = { "ident": "DCRS-M1-P1", "text": { "en", "km" }, "title": { "en", "km" } /* optional, not stored *\/,
 *              "options": [ { "text": { "en", "km" }, "correct": true | false }, ... ] }
 * ```
 *
 * What the plan does, in order (parents before the rows that hang from them):
 *  - upserts the curriculum (name), the level (name, when given), and for every lesson
 *    NAMED in the file: the lesson, its video document, learning item, practice and
 *    quiz, then the questions and the join rows that put them in the practice and the quiz;
 *  - hides what the file does not name, reversibly: the other lessons are marked
 *    `isdeleted` with their documents, and their learning items, practices, quizzes and
 *    join rows get status 0; seed questions the file no longer uses are marked `isdeleted`.
 *    Naming a lesson again in a later file un-hides it (the upsert sets the flags back).
 *
 * Where the ids come from. Questions take the seed's seven fixed question ids in order
 * (the practice questions of the first named lesson, then its quiz questions, then the next
 * lesson's), so a file may carry at most seven questions in all. A lesson has room for four
 * practice and four quiz questions: its own seed join-row ids first, then ids reserved for
 * this mode (the c0000000-0000-4000-8000-0000000000xx namespace from 0x32 up).
 *
 * The language of the learner-facing text (`lang`): `km` (default), `en`, or `both`
 * ("km\nen"). The other language stays in content.json only.
 */

const LANGS = ["km", "en", "both"];
const DEFAULT_LANG = "km";
const FILENAME = /^[A-Za-z0-9_-]+\.mp4$/;
const IDENT = /^DCRS-[A-Za-z0-9-]+$/;
const MAX_QUESTIONS_PER_SET = 4;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

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

/** `{ en, km }` to the string the learner sees. */
function pickLang(text, lang) {
  if (lang === "both") return `${text.km}\n${text.en}`;
  return text[lang];
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
 * The fixed slots of the seed, from its id map: per lesson the rows that hang from it and
 * the join-row ids it may use; one pool of question ids.
 */
function slotsOf(ID) {
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
  return { lessons, questions };
}

/**
 * Checks a parsed content.json; returns it unchanged when it is acceptable, throws
 * ContentRefused (every problem listed) when not.
 */
function validateContent(content, ID) {
  const problems = [];
  const slots = slotsOf(ID);
  const bilingual = (v, where) => {
    if (!isObject(v) || !isText(v.en) || !isText(v.km)) problems.push(`${where} needs a non-empty "en" and "km"`);
  };
  if (!isObject(content)) throw new ContentRefused(["content.json is not an object"]);
  if (!isObject(content.curriculum)) problems.push("curriculum is missing");
  else bilingual(content.curriculum.name, "curriculum.name");
  if (content.level !== undefined) {
    if (!isObject(content.level)) problems.push("level is not an object");
    else bilingual(content.level.name, "level.name");
  }
  if (!Array.isArray(content.lessons) || content.lessons.length === 0) {
    problems.push("lessons must be a non-empty list");
    throw new ContentRefused(problems);
  }

  const fixedLessonIds = new Set(slots.lessons.map((l) => l.id));
  const seenLessons = new Set();
  const seenIdents = new Set();
  const seenFiles = new Set();
  let questionCount = 0;
  content.lessons.forEach((lesson, i) => {
    const at = `lessons[${i}]`;
    if (!isObject(lesson)) {
      problems.push(`${at} is not an object`);
      return;
    }
    if (typeof lesson.id !== "string" || !fixedLessonIds.has(lesson.id)) problems.push(`${at}.id is not a DCRS fixed lesson id`);
    else if (seenLessons.has(lesson.id)) problems.push(`${at}.id is named twice`);
    else seenLessons.add(lesson.id);
    if (!Number.isInteger(lesson.order) || lesson.order < 1) problems.push(`${at}.order must be a whole number from 1`);
    bilingual(lesson.name, `${at}.name`);
    if (!isObject(lesson.video) || !isText(lesson.video.ref)) problems.push(`${at}.video.ref is missing`);
    else if (typeof lesson.video.filename !== "string" || !FILENAME.test(lesson.video.filename)) {
      problems.push(`${at}.video.filename must be a bare key like dcrs-m1-l1.mp4`);
    } else if (seenFiles.has(lesson.video.filename)) problems.push(`${at}.video.filename is used by another lesson`);
    else seenFiles.add(lesson.video.filename);
    if (isObject(lesson.video) && lesson.video.source !== undefined && !isText(lesson.video.source)) {
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
      questionCount += list.length;
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
  if (questionCount > slots.questions.length) {
    problems.push(`the file names ${questionCount} questions; the seed has ${slots.questions.length} fixed question ids`);
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
 * `ID` is the seed's id map; `organisationid` owns the rows a fresh insert would create.
 * Returns `{ lang, steps, media }`. A step is either
 *   `{ kind: "upsert", table, pk, id, values, update }`  (INSERT ... ON DUPLICATE KEY UPDATE `update` columns)
 *   `{ kind: "hide", table, pk, ids, set }`              (UPDATE ... SET `set` WHERE pk IN ids)
 * Insert values outside `update` only matter for a row that is not there yet (the seed's
 * own placeholder pass normally creates them first), and never overwrite one that is.
 */
function planContent(content, ID, { lang = DEFAULT_LANG, organisationid } = {}) {
  if (!LANGS.includes(lang)) throw new ContentRefused([`lang must be one of ${LANGS.join(", ")}`]);
  validateContent(content, ID);
  if (!isText(organisationid)) throw new ContentRefused(["organisationid is required to plan"]);
  const slots = slotsOf(ID);
  const t = (text) => pickLang(text, lang);
  const steps = [];
  const upsert = (table, pk, values, update) => steps.push({ kind: "upsert", table, pk, id: values[pk], values, update });
  const hide = (table, pk, ids, set) => {
    if (ids.length > 0) steps.push({ kind: "hide", table, pk, ids: [...new Set(ids)], set });
  };

  const named = new Map(content.lessons.map((l) => [l.id, l]));
  const live = slots.lessons.filter((s) => named.has(s.id)).sort((a, b) => named.get(a.id).order - named.get(b.id).order);
  const hidden = slots.lessons.filter((s) => !named.has(s.id));

  upsert(
    "curriculums",
    "curriculumid",
    {
      curriculumid: ID.curriculum,
      curriculumname: t(content.curriculum.name),
      curriculumstatus: 1,
      curriculumdescription: "DCRS curriculum",
      isdeleted: 0,
      subjectid: ID.subject,
      organisationid,
    },
    ["curriculumname", "curriculumstatus", "isdeleted"],
  );
  if (content.level) {
    upsert(
      "levels",
      "levelid",
      {
        levelid: ID.level,
        gradeid: ID.grade,
        levelname: t(content.level.name),
        leveldescription: "DCRS level",
        isdeleted: 0,
        levelstatus: 1,
        levelorder: 1,
        passing_points: 80,
        quiz_points: 20,
        points: 100,
      },
      ["levelname", "levelstatus", "isdeleted"],
    );
  }

  // Which question id each question takes: in order through the live lessons, practice before quiz.
  let nextQuestion = 0;
  const assigned = [];
  const placed = live.map((slot) => {
    const lesson = named.get(slot.id);
    const take = (list, kind) =>
      list.map((q, j) => {
        const id = slots.questions[nextQuestion++];
        assigned.push(id);
        return { q, id, kind, join: (kind === "practice" ? slot.practiceJoins : slot.quizJoins)[j] };
      });
    return { slot, lesson, practice: take(lesson.practice, "practice"), quiz: take(lesson.quiz, "quiz") };
  });

  for (const { slot, lesson } of placed) {
    upsert(
      "lessons",
      "lessonid",
      {
        lessonid: slot.id,
        levelid: ID.level,
        lessonname: t(lesson.name),
        lessondescription: "DCRS lesson",
        practicecount: 1,
        quizcount: 1,
        lessonpasspercentage: 80,
        lessonorder: lesson.order,
        lessonstatus: 1,
        isdeleted: 0,
        total_points: 100,
        passing_points: 80,
        learning_points: 20,
        quizzes_points: 40,
        practices_points: 40,
      },
      ["lessonname", "lessonorder", "lessonstatus", "isdeleted"],
    );
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
    upsert(
      "lessonlearnings",
      "lessonlearningid",
      {
        lessonlearningid: slot.learning,
        lessonlearningname: t(lesson.name),
        lessonlearningdescription: "DCRS lesson video",
        lessonlearningstatus: 1,
        lessonid: slot.id,
        documentid: slot.doc,
        lessonlearningorder: 1,
        points: 20,
      },
      ["lessonlearningname", "lessonlearningstatus"],
    );
    upsert(
      "lessonpractices",
      "lessonpracticeid",
      {
        lessonpracticeid: slot.practice,
        lessonid: slot.id,
        lessonpracticeorder: 1,
        lessonpracticestatus: 1,
        lessonpracticename: t(lesson.name),
        lessonpracticedescription: "DCRS practice set",
        points: 40,
      },
      ["lessonpracticename", "lessonpracticestatus"],
    );
    upsert(
      "lessonquizzes",
      "lessonquizid",
      {
        lessonquizid: slot.quiz,
        lessonid: slot.id,
        lessonquizorder: 1,
        lessonquizname: t(lesson.name),
        lessonquizstatus: 1,
        lessonquizdescription: "DCRS quiz",
        points: 40,
      },
      ["lessonquizname", "lessonquizstatus"],
    );
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
          questionfeedback: null,
          organisationid,
        },
        questionUpdate,
      );
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

  // Hidden, reversibly: what the file does not name.
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
    slots.lessons.flatMap((s) => s.practiceJoins).filter((id) => !usedPracticeJoins.has(id)),
    { lessonpracticequestionstatus: 0 },
  );
  hide(
    "lessonquizquestions",
    "lessonquizquestionid",
    slots.lessons.flatMap((s) => s.quizJoins).filter((id) => !usedQuizJoins.has(id)),
    { lessonquizquestionstatus: 0 },
  );
  hide("questions", "questionid", slots.questions.filter((id) => !assigned.includes(id)), { isdeleted: 1 });

  const media = placed.map(({ slot, lesson }) => ({
    lessonid: slot.id,
    ref: lesson.video.ref,
    source: lesson.video.source ?? null,
    filename: lesson.video.filename,
  }));
  return { lang, steps, media };
}

/** The SQL and parameters of one step. Identifiers come from the plan, which only this file builds. */
function statementOf(step) {
  const q = (name) => `\`${name}\``;
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

module.exports = { LESSON_IDS, LANGS, DEFAULT_LANG, FILENAME, ContentRefused, validateContent, planContent, statementOf, slotsOf, pickLang };
