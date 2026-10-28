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
 * { "programme":  { "en": "...", "km": "..." },                      // optional: the programme's name, one line each
 *   "curriculum": { "name": { "en": "...", "km": "..." } },
 *   "level":      { "name": { "en": "...", "km": "..." } },          // optional
 *   "lessons": [ {
 *     "id": "<one of the four fixed DCRS lesson ids>", "order": 1,
 *     "name":  { "en": "...", "km": "..." },
 *     "video": { "ref": "...", "filename": "dcrs-m1-l1.mp4", "source": "..." },   // source optional
 *     "practice": [ QUESTION, ... ], "quiz": [ QUESTION, ... ] } ] }
 * QUESTION = { "ident": "DCRS-M1-P1", "text": { "en", "km" }, "title": { "en", "km" } /* optional, not stored *\/,
 *              "options": [ { "text": { "en", "km" }, "correct": true | false }, ... ],
 *              "feedback": { "correctmessage": { "en", "km" }, "incorrectmessage": { "en", "km" } } /* optional, each message optional *\/ }
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
 * Two languages, one meaning each (bilingual content design, section 6.4, decision 2). The ENGLISH text
 * goes into the base columns of the rows above, because the readiness programme's organisation has the base
 * language `en` (`organisations.contentlanguage`). The KHMER text goes into `contenttranslations`, one row per
 * text, language `km`: the lesson, curriculum and level names (and the learning item, practice and quiz that
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
 * would see. Content mode blanks every description the file does not provide (curriculum, level, lesson, learning item,
 * practice, quiz: the empty string) and names the grade, whose name the navigation shows, after the programme the file
 * gives (`programme`, English in the base column, Khmer as its km translation); a file without a `programme` names it after
 * the module title instead (the curriculum's name, with its km translation). A description is only blanked in the rows this
 * mode writes.
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
    else if (Buffer.byteLength(v.km, "utf8") > TRANSLATION_TEXT_MAX_BYTES) problems.push(`${where}.km is too long to store as a translation`);
  };
  if (!isObject(content)) throw new ContentRefused(["content.json is not an object"]);
  if (content.programme !== undefined) {
    bilingual(content.programme, "programme");
    // a programme's name is one line: the header that shows it has no room for a break
    for (const lang of ["en", "km"]) {
      if (isObject(content.programme) && typeof content.programme[lang] === "string" && /[\r\n\u2028\u2029]/.test(content.programme[lang])) {
        problems.push(`programme.${lang} must be one line (it has a line break)`);
      }
    }
  }
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
 * `ID` is the seed's id map; `organisationid` owns the rows a fresh insert would create and the
 * translation rows; `now` (a Date) is the time the translation rows are stamped with.
 * Returns `{ baseLanguage, translationLanguage, organisationid, steps, media, owned }`. A step is one of
 *   `{ kind: "upsert", table, pk, id, values, update }`  (INSERT ... ON DUPLICATE KEY UPDATE `update` columns)
 *   `{ kind: "translate", table: "contenttranslations", pk, id, values, update, touch }`  (the same, and `touch`
 *      (`lastupdated`) is only moved when a column of `update` changes)
 *   `{ kind: "hide", table, pk, ids, set }`              (UPDATE ... SET `set` WHERE pk IN ids)
 * Insert values outside `update` only matter for a row that is not there yet (the seed's
 * own placeholder pass normally creates them first), and never overwrite one that is.
 * `owned` lists the seed rows that must belong to `organisationid` (or to nobody yet) for the translations to be its own.
 */
function planContent(content, ID, { organisationid, now } = {}) {
  validateContent(content, ID);
  if (!isText(organisationid)) throw new ContentRefused(["organisationid is required to plan"]);
  const stamp = utcDatetime(now);
  const slots = slotsOf(ID);
  const t = (text) => text.en;
  const translations = [];
  const translate = (tablename, rowid, field, subkey, text) =>
    translations.push({ tablename, rowid, field, subkey, en: text.en, km: text.km });
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
      curriculumdescription: "",
      isdeleted: 0,
      subjectid: ID.subject,
      organisationid,
    },
    ["curriculumname", "curriculumdescription", "curriculumstatus", "isdeleted"],
  );
  translate("curriculums", ID.curriculum, "curriculumname", "", content.curriculum.name);
  // The grade's name is shown in the learner's navigation and cannot be empty: it is the programme the file gives, or, when the file
  // has none, the module title (the curriculum's name).
  const gradeName = content.programme ?? content.curriculum.name;
  upsert(
    "grades",
    "gradeid",
    {
      gradeid: ID.grade,
      curriculumid: ID.curriculum,
      gradestatus: 1,
      gradename: t(gradeName),
      gradedescription: "",
      gradeorder: 1,
      isdeleted: 0,
      passing_points: 80,
      points: 100,
    },
    ["gradename", "gradedescription", "gradestatus", "isdeleted"],
  );
  translate("grades", ID.grade, "gradename", "", gradeName);
  if (content.level) {
    upsert(
      "levels",
      "levelid",
      {
        levelid: ID.level,
        gradeid: ID.grade,
        levelname: t(content.level.name),
        leveldescription: "",
        isdeleted: 0,
        levelstatus: 1,
        levelorder: 1,
        passing_points: 80,
        quiz_points: 20,
        points: 100,
      },
      ["levelname", "leveldescription", "levelstatus", "isdeleted"],
    );
    translate("levels", ID.level, "levelname", "", content.level.name);
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
        lessondescription: "",
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
      ["lessonname", "lessondescription", "lessonorder", "lessonstatus", "isdeleted"],
    );
    translate("lessons", slot.id, "lessonname", "", lesson.name);
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
        lessonpracticestatus: 1,
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
        lessonquizstatus: 1,
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

  // The Khmer text, one row per text, after every row it hangs from.
  for (const x of translations) {
    const values = {
      translationid: translationId(x.tablename, x.rowid, x.field, x.subkey, TRANSLATION_LANGUAGE),
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
  const owned = [
    { table: "curriculums", pk: "curriculumid", ids: [ID.curriculum] },
    { table: "documents", pk: "documentid", ids: placed.map((p) => p.slot.doc) },
    { table: "questions", pk: "questionid", ids: assigned },
  ];
  return { baseLanguage: BASE_LANGUAGE, translationLanguage: TRANSLATION_LANGUAGE, organisationid, steps, media, owned };
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
  ContentRefused,
  validateContent,
  planContent,
  statementOf,
  slotsOf,
  sourceHash,
  translationId,
  questionTexts,
  isAnswerBearing,
};
