/**
 * `seed:dcrs -- --content <dir>`: the plan a content.json turns into (a pure function of the
 * file: English in the base columns, Khmer as `contenttranslations` rows), what is refused, the
 * applier on a stand-in connection, and the command line.
 * The seed itself is run for real against scratch databases (see the change description).
 *
 * Khmer fixtures here are opaque runs of Khmer-block code points (consonants, the subscript
 * sign, vowels), not words: the specs need text that only a Khmer-aware check can tell from
 * ASCII, not text that means anything.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/* eslint-disable @typescript-eslint/no-var-requires */
const { ID } = require("../../scripts/seed-dcrs-content");
const {
  ContentRefused,
  LESSON_IDS,
  BASE_LANGUAGE,
  TRANSLATION_LANGUAGE,
  ANSWER_BEARING_FIELDS,
  MODULE_ID_NAMESPACE,
  MAX_LESSONS_LATER_MODULE,
  LESSON_TOTAL_POINTS,
  DEFAULT_QUIZ_POINTS,
  OLD_SHAPE,
  validateContent,
  planContent,
  statementOf,
  slotsOf,
  idsOfSlots,
  uuidV5,
  moduleId,
  sourceHash,
  translationId,
  questionTexts,
  isAnswerBearing,
} = require("../../scripts/lib/dcrs-content-plan");
const { applyPlan, preflight, readExisting, formatReport, curriculumNameLengths, formatCurriculumName } = require("../../scripts/lib/dcrs-content-apply");
const { USAGE, parseArgs, levelSwitchOf, prepare, printDryRun } = require("../../scripts/lib/dcrs-content-cli");
/* eslint-enable @typescript-eslint/no-var-requires */
import {
  ANSWER_BEARING_FIELDS as CONSTANT_ANSWER_BEARING_FIELDS,
  SUBKEY_MAX_LENGTH,
  TRANSLATABLE_FIELDS,
  sourceHash as constantSourceHash,
} from "../constants/content-translations";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORG = "a0000000-0000-4000-8000-0000000000aa";
// The digest of the ids of Module 1's plan (one line "kind:table:id" per step, hides by their ids, in order), taken from the plan as it was
// before modules existed (the commit under this change) for the same file in its old shape. A change to any Module 1 id, or to the order
// the statements run in, changes it.
const MODULE_1_STEP_IDS_DIGEST = "e9b16197ddd9dd01808faefd8237e0a74097a472ff999716f897082875e11d6d";
const NOW = new Date("2026-10-28T09:30:15.123Z");
// consonant + subscript sign + consonant + dependent vowel, then a second run; never a real word
const km = (tag: string) => `\u1780\u17d2\u1781\u17b6${tag}\u1782\u17d2\u1783\u17c1`;
const bi = (tag: string) => ({ en: `en ${tag}`, km: km(tag) });

const question = (ident: string, tag: string, options = 4, correct = 0): Json => ({
  ident,
  text: bi(`${tag} stem`),
  options: Array.from({ length: options }, (_, i) => ({ text: bi(`${tag} option ${i}`), correct: i === correct })),
});

const sample = (over: Json = {}): Json => ({
  programme: bi("programme"),
  module: { number: 1, name: bi("module") },
  lessons: [
    {
      id: ID.lesson1,
      order: 1,
      name: bi("lesson"),
      video: { ref: "REF-1", filename: "dcrs-m1-l1.mp4", source: "lesson_final.mp4" },
      practice: [question("DCRS-M1-P1", "p1"), question("DCRS-M1-P2", "p2")],
      quiz: [question("DCRS-M1-Q1", "q1", 4, 2), question("DCRS-M1-Q2", "q2", 3, 1)],
    },
  ],
  ...over,
});

const plan = (content: Json = sample(), now: Date = NOW) => planContent(content, ID, { organisationid: ORG, now });
const refusal = (content: unknown): string[] => {
  try {
    validateContent(content, ID);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentRefused);
    return (e as { problems: string[] }).problems;
  }
  throw new Error("expected the content to be refused");
};

const translations = (p: Json): Json[] => p.steps.filter((s: Json) => s.kind === "translate").map((s: Json) => s.values);
const forRow = (p: Json, tablename: string, rowid: string): Json[] => translations(p).filter((v) => v.tablename === tablename && v.rowid === rowid);
const hidden = (p: Json) => Object.fromEntries(p.steps.filter((s: Json) => s.kind === "hide").map((s: Json) => [s.table, s.ids]));
const upserted = (p: Json, table: string): string[] => p.steps.filter((s: Json) => s.kind === "upsert" && s.table === table).map((s: Json) => s.id);

describe("the seed's id map and the plan's slots", () => {
  it("agree on the four lesson ids, and every slot id is distinct", () => {
    expect(LESSON_IDS).toEqual([ID.lesson1, ID.lesson2, ID.lesson3, ID.lesson4]);
    const slots = slotsOf(ID);
    const all: string[] = [...slots.questions];
    for (const l of slots.lessons) all.push(l.id, l.doc, l.learning, l.practice, l.quiz, ...l.practiceJoins, ...l.quizJoins);
    expect(new Set(all).size).toBe(all.length);
    // ids reserved for content mode never collide with an id the seed's own map hands out
    const seeded = new Set(Object.values(ID));
    const reserved = slots.lessons.flatMap((l: Json) => [...l.practiceJoins, ...l.quizJoins]).filter((id: string) => !seeded.has(id));
    // 12 practice joins (three more per lesson) and 9 quiz joins (the seed already had 1 + 2 + 3 + 1 of its own)
    expect(reserved).toHaveLength(21);
    expect(reserved[0]).toBe("c0000000-0000-4000-8000-000000000032");
    expect(reserved.at(-1)).toBe("c0000000-0000-4000-8000-000000000046");
    expect(slots.lessons[0].practiceJoins).toEqual([
      ID.pqLesson1,
      "c0000000-0000-4000-8000-000000000032",
      "c0000000-0000-4000-8000-000000000033",
      "c0000000-0000-4000-8000-000000000034",
    ]);
    expect(slots.lessons[0].quizJoins).toEqual([ID.qqLesson1, "c0000000-0000-4000-8000-000000000035", "c0000000-0000-4000-8000-000000000036", "c0000000-0000-4000-8000-000000000037"]);
  });
});

describe("planning a content file", () => {
  it("writes lesson 1 with its four questions and joins, and hides everything the file does not name", () => {
    const p = plan();
    expect(p.steps.filter((s: Json) => s.kind !== "translate").map((s: Json) => `${s.kind}:${s.table}`)).toEqual([
      "upsert:curriculums",
      "upsert:grades",
      "upsert:levels",
      "upsert:lessons",
      "upsert:documents",
      "upsert:lessonlearnings",
      "upsert:lessonpractices",
      "upsert:lessonquizzes",
      "upsert:questions",
      "upsert:questions",
      "upsert:questions",
      "upsert:questions",
      "upsert:lessonpracticequestions",
      "upsert:lessonpracticequestions",
      "upsert:lessonquizquestions",
      "upsert:lessonquizquestions",
      "hide:lessons",
      "hide:documents",
      "hide:lessonlearnings",
      "hide:lessonpractices",
      "hide:lessonquizzes",
      "hide:lessonpracticequestions",
      "hide:lessonquizquestions",
      "hide:questions",
    ]);
    expect(upserted(p, "lessons")).toEqual([ID.lesson1]);
    expect(upserted(p, "questions")).toEqual([ID.q1, ID.q2, ID.q3, ID.q4]);
    expect(upserted(p, "lessonpracticequestions")).toEqual([ID.pqLesson1, "c0000000-0000-4000-8000-000000000032"]);
    expect(upserted(p, "lessonquizquestions")).toEqual([ID.qqLesson1, "c0000000-0000-4000-8000-000000000035"]);
    const h = hidden(p);
    expect(h.lessons).toEqual([ID.lesson2, ID.lesson3, ID.lesson4]);
    expect(h.documents).toEqual([ID.doc2, ID.doc3, ID.doc4]);
    expect(h.lessonlearnings).toEqual([ID.learning2, ID.learning3, ID.learning4]);
    expect(h.lessonpractices).toEqual([ID.practice2, ID.practice3, ID.practice4]);
    expect(h.lessonquizzes).toEqual([ID.quiz2, ID.quiz3, ID.quiz4]);
    expect(h.questions).toEqual([ID.q5, ID.q6, ID.q7]);
    // every join slot of lesson 1 not used, and every slot of the hidden lessons
    expect(h.lessonpracticequestions).not.toContain(ID.pqLesson1);
    expect(h.lessonpracticequestions).toContain(ID.pqLesson2);
    expect(h.lessonpracticequestions).toContain("c0000000-0000-4000-8000-000000000034");
    expect(h.lessonquizquestions).not.toContain(ID.qqLesson1);
    expect(h.lessonquizquestions).toEqual(expect.arrayContaining([ID.qqLesson2Q2, ID.qqLesson2Q3, ID.qqLesson3Q4, ID.qqLesson3Q5, ID.qqLesson3Q6, ID.qqLesson4]));
    // the hide steps set the reversible flag and nothing else
    expect(p.steps.filter((s: Json) => s.kind === "hide").map((s: Json) => s.set)).toEqual([
      { isdeleted: 1 },
      { isdeleted: 1 },
      { lessonlearningstatus: 0 },
      { lessonpracticestatus: 0 },
      { lessonquizstatus: 0 },
      { lessonpracticequestionstatus: 0 },
      { lessonquizquestionstatus: 0 },
      { isdeleted: 1 },
    ]);
  });

  it("puts the video's key in the document row and marks the media as coming from the folder", () => {
    const doc = plan().steps.find((s: Json) => s.table === "documents");
    expect(doc.values.documentname).toBe("dcrs-m1-l1.mp4");
    expect(JSON.parse(doc.values.documents3meta)).toEqual({ seeded: true, media: "folder" });
    expect(doc.update).toEqual(["documentname", "documents3meta", "isdeleted"]);
    expect(plan().media).toEqual([{ lessonid: ID.lesson1, ref: "REF-1", source: "lesson_final.mp4", filename: "dcrs-m1-l1.mp4" }]);
  });

  it("builds each question as a single-answer text question with the one correct option marked", () => {
    const q3 = plan().steps.find((s: Json) => s.table === "questions" && s.id === ID.q3);
    const options = JSON.parse(q3.values.questionoptions);
    expect(options.map((o: Json) => [o.questionoptionid, o.questionoptioniscorrect, o.questionoptionsequence])).toEqual([
      [`${ID.q3}-opt-1`, false, 1],
      [`${ID.q3}-opt-2`, false, 2],
      [`${ID.q3}-opt-3`, true, 3],
      [`${ID.q3}-opt-4`, false, 4],
    ]);
    expect(q3.values).toMatchObject({ templatetypeid: 1, isdeleted: 0, questionstatus: 1, questionidentifier: "DCRS-M1-Q1", questionfeedback: null, organisationid: ORG });
    expect(JSON.parse(q3.values.questionheading)).toEqual({ headingtext: "en q1 stem", headingfile: null });
    expect(q3.values.questiontext).toBe("en q1 stem");
    expect(q3.update).not.toContain("questionid");
    expect(q3.update).not.toContain("organisationid");
  });

  it("blanks every placeholder description and names the grade after the programme the file gives", () => {
    const p = plan();
    const row = (table: string) => p.steps.find((s: Json) => s.kind === "upsert" && s.table === table);
    for (const [table, column] of [
      ["curriculums", "curriculumdescription"],
      ["grades", "gradedescription"],
      ["levels", "leveldescription"],
      ["lessons", "lessondescription"],
      ["lessonlearnings", "lessonlearningdescription"],
      ["lessonpractices", "lessonpracticedescription"],
      ["lessonquizzes", "lessonquizdescription"],
    ]) {
      expect(row(table).values[column]).toBe("");
      // in the update list too, or a row the seed's placeholder pass made first would keep its placeholder
      expect(row(table).update).toContain(column);
    }
    expect(row("grades").values).toMatchObject({ gradeid: ID.grade, curriculumid: ID.curriculum, gradename: "en programme", gradestatus: 1, isdeleted: 0 });
    expect(row("grades").update).toEqual(["gradename", "gradedescription", "gradestatus", "isdeleted", "points"]);
    expect(forRow(p, "grades", ID.grade).map((v) => [v.field, v.text])).toEqual([["gradename", km("programme")]]);
    // the grade comes after its curriculum and before the level that hangs from it
    const order = p.steps.map((s: Json) => s.table);
    expect(order.indexOf("grades")).toBeGreaterThan(order.indexOf("curriculums"));
    expect(order.indexOf("grades")).toBeLessThan(order.indexOf("levels"));
    // nothing of the seed's placeholder wording is left in what is written
    expect(JSON.stringify(p.steps.filter((s: Json) => s.kind !== "hide").map((s: Json) => s.values))).not.toMatch(/DCRS (curriculum|grade|level|lesson|practice set|quiz)|Cohort II/);
  });

  it("writes the English text into the base columns and no Khmer into them", () => {
    const p = plan();
    const row = (table: string) => p.steps.find((s: Json) => s.kind === "upsert" && s.table === table).values;
    expect(row("curriculums").curriculumname).toBe("en programme");
    expect(row("grades").gradename).toBe("en programme");
    expect(row("levels").levelname).toBe("en module");
    expect(row("lessons").lessonname).toBe("en lesson");
    expect(row("lessonlearnings").lessonlearningname).toBe("en lesson");
    expect(row("lessonpractices").lessonpracticename).toBe("en lesson");
    expect(row("lessonquizzes").lessonquizname).toBe("en lesson");
    const options = JSON.parse(row("questions").questionoptions);
    expect(options[0]).toMatchObject({ questionoptiontext: "en p1 option 0", questionoptionvalue: "en p1 option 0" });
    for (const step of p.steps.filter((x: Json) => x.kind === "upsert")) expect(JSON.stringify(step.values)).not.toMatch(/[\u1780-\u17ff]/);
    expect(p).toMatchObject({ baseLanguage: BASE_LANGUAGE, translationLanguage: TRANSLATION_LANGUAGE, organisationid: ORG });
    expect([BASE_LANGUAGE, TRANSLATION_LANGUAGE]).toEqual(["en", "km"]);
    expect(() => planContent(sample(), ID, { organisationid: ORG })).toThrow(ContentRefused); // no clock, no plan
    expect(() => planContent(sample(), ID, { organisationid: ORG, now: "not a date" })).toThrow(ContentRefused);
  });

  it("writes one km row for each Khmer text, keyed by row, field and option id, with the hash of the English", () => {
    const p = plan();
    const names = ["curriculums", "grades", "levels", "lessons", "lessonlearnings", "lessonpractices", "lessonquizzes"];
    const keyed = (v: Json) => `${v.tablename}/${v.rowid}/${v.field}/${v.subkey}`;
    const all = translations(p);
    expect(new Set(all.map(keyed)).size).toBe(all.length);
    // 7 names (curriculum, grade, level, lesson, learning item, practice, quiz) + 4 questions x (text + heading) + 15 options
    expect(all).toHaveLength(7 + 8 + 15);
    const lessonSlot = slotsOf(ID).lessons[0];
    expect(all.slice(0, 7).map(keyed)).toEqual([
      `curriculums/${ID.curriculum}/curriculumname/`,
      `grades/${ID.grade}/gradename/`,
      `levels/${ID.level}/levelname/`,
      `lessons/${lessonSlot.id}/lessonname/`,
      `lessonlearnings/${lessonSlot.learning}/lessonlearningname/`,
      `lessonpractices/${lessonSlot.practice}/lessonpracticename/`,
      `lessonquizzes/${lessonSlot.quiz}/lessonquizname/`,
    ]);
    for (const v of all.slice(0, 7)) expect(names).toContain(v.tablename);
    expect(forRow(p, "lessons", ID.lesson1)).toEqual([
      {
        translationid: translationId("lessons", ID.lesson1, "lessonname", "", "km"),
        organisationid: ORG,
        tablename: "lessons",
        rowid: ID.lesson1,
        field: "lessonname",
        subkey: "",
        language: "km",
        text: km("lesson"),
        sourcehash: createHash("sha256").update("en lesson", "utf8").digest("hex"),
        lastupdated: "2026-10-28 09:30:15.123",
      },
    ]);
    // the third question of the file takes q3; its options are keyed by the option ids the question row carries
    const q3 = forRow(p, "questions", ID.q3);
    expect(q3.map((v) => [v.field, v.subkey])).toEqual([
      ["questiontext", ""],
      ["headingtext", ""],
      ["questionoptiontext", `${ID.q3}-opt-1`],
      ["questionoptiontext", `${ID.q3}-opt-2`],
      ["questionoptiontext", `${ID.q3}-opt-3`],
      ["questionoptiontext", `${ID.q3}-opt-4`],
    ]);
    expect(q3.map((v) => v.text)).toEqual([km("q1 stem"), km("q1 stem"), ...[0, 1, 2, 3].map((i) => km(`q1 option ${i}`))]);
    const stored = p.steps.find((s: Json) => s.table === "questions" && s.id === ID.q3).values;
    const stem = JSON.parse(stored.questionheading).headingtext;
    expect(q3[1].sourcehash).toBe(createHash("sha256").update(stem, "utf8").digest("hex"));
    const stored3 = JSON.parse(stored.questionoptions);
    q3.slice(2).forEach((v, i) => {
      expect(stored3[i].questionoptionid).toBe(v.subkey);
      expect(v.sourcehash).toBe(createHash("sha256").update(stored3[i].questionoptiontext, "utf8").digest("hex"));
    });
    expect(all.every((v) => v.language === "km" && v.organisationid === ORG && v.subkey.length <= SUBKEY_MAX_LENGTH)).toBe(true);
  });

  it("hashes the exact English UTF-8 text, with no normalising, and agrees with the API's own function", () => {
    const text = " caf\u00e9\u00a0 \n\ttwo lines \u2713 \ud83d\ude00 ";
    expect(sourceHash(text)).toBe(constantSourceHash(text));
    expect(sourceHash(text)).toBe(createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex"));
    const c = sample();
    c.lessons[0].name = { en: text, km: km("odd") };
    const row = translations(plan(c)).find((v) => v.tablename === "lessons")!;
    expect(row.sourcehash).toBe(constantSourceHash(text));
    expect(plan(c).steps.find((s: Json) => s.table === "lessons").values.lessonname).toBe(text);
  });

  it("only plans rows for fields the API accepts as translations, and never for a text an answer is graded by", () => {
    for (const v of translations(plan())) expect(TRANSLATABLE_FIELDS[v.tablename]).toContain(v.field);
    expect(ANSWER_BEARING_FIELDS).toEqual(CONSTANT_ANSWER_BEARING_FIELDS);
    // the readiness questions are template 1: nothing they carry is answer-bearing
    expect(translations(plan()).filter((v) => isAnswerBearing(1, v.field))).toEqual([]);
    // the same texts as a template whose answer is the typed text: the question text and the options go, the heading stays
    const q = question("DCRS-M1-P1", "p1");
    const fields = (template: number) => questionTexts(template, ID.q1, q).map((t: Json) => t.field);
    expect(fields(1)).toEqual(["questiontext", "headingtext", "questionoptiontext", "questionoptiontext", "questionoptiontext", "questionoptiontext"]);
    expect(fields(21)).toEqual(["headingtext"]);
    expect(fields(8)).toEqual(["headingtext", "questionoptiontext", "questionoptiontext", "questionoptiontext", "questionoptiontext"]);
    expect(fields(23)).toEqual(fields(8));
  });

  it("carries a question's feedback messages when the file has them, as the base text and as km rows", () => {
    const c = sample();
    c.lessons[0].practice[0].feedback = { correctmessage: bi("well done"), incorrectmessage: bi("look again") };
    c.lessons[0].practice[1].feedback = { incorrectmessage: bi("only this one") };
    const p = plan(c);
    expect(JSON.parse(p.steps.find((s: Json) => s.table === "questions" && s.id === ID.q1).values.questionfeedback)).toEqual({ correctmessage: "en well done", incorrectmessage: "en look again" });
    expect(JSON.parse(p.steps.find((s: Json) => s.table === "questions" && s.id === ID.q2).values.questionfeedback)).toEqual({ incorrectmessage: "en only this one" });
    expect(p.steps.find((s: Json) => s.table === "questions" && s.id === ID.q3).values.questionfeedback).toBeNull();
    expect(forRow(p, "questions", ID.q1).filter((v) => v.field === "feedback").map((v) => [v.subkey, v.text])).toEqual([
      ["correctmessage", km("well done")],
      ["incorrectmessage", km("look again")],
    ]);
    expect(forRow(p, "questions", ID.q2).filter((v) => v.field === "feedback").map((v) => v.subkey)).toEqual(["incorrectmessage"]);
    expect(refusal({ ...sample(), lessons: [{ ...sample().lessons[0], practice: [{ ...question("DCRS-M1-P1", "p1"), feedback: { other: bi("x") } }] }] })).toEqual([
      "lessons[0].practice[0].feedback.other is not a message (correctmessage, incorrectmessage)",
    ]);
  });

  it("gives a translation the same id on every run, so the same file seeds the same rows in both APIs", () => {
    const ids = translations(plan()).map((v) => v.translationid);
    expect(ids).toEqual(translations(plan(sample(), new Date("2030-01-01T00:00:00Z"))).map((v) => v.translationid));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(translationId("lessons", ID.lesson1, "lessonname", "", "km")).not.toBe(translationId("lessons", ID.lesson1, "lessonname", "", "en"));
  });

  it("a lesson with fewer questions hides the join slots and question ids it no longer uses", () => {
    const c = sample();
    c.lessons[0].practice = [question("DCRS-M1-P1", "p1")];
    c.lessons[0].quiz = [];
    const p = plan(c);
    expect(upserted(p, "questions")).toEqual([ID.q1]);
    expect(hidden(p).questions).toEqual([ID.q2, ID.q3, ID.q4, ID.q5, ID.q6, ID.q7]);
    expect(hidden(p).lessonquizquestions).toContain(ID.qqLesson1);
    expect(hidden(p).lessonpracticequestions).not.toContain(ID.pqLesson1);
    expect(hidden(p).lessonpracticequestions).toContain("c0000000-0000-4000-8000-000000000032");
  });

  it("naming another lesson brings it back: it is upserted live instead of hidden", () => {
    const c = sample();
    c.lessons.push({ id: ID.lesson2, order: 2, name: bi("two"), video: { ref: "REF-2", filename: "dcrs-m1-l2.mp4" }, practice: [], quiz: [question("DCRS-M1-Q3", "q3")] });
    const p = plan(c);
    expect(upserted(p, "lessons")).toEqual([ID.lesson1, ID.lesson2]);
    const lesson2 = p.steps.find((s: Json) => s.table === "lessons" && s.id === ID.lesson2);
    expect(lesson2.values).toMatchObject({ isdeleted: 0, lessonstatus: 1, lessonorder: 2 });
    expect(lesson2.update).toEqual(expect.arrayContaining(["isdeleted", "lessonstatus"]));
    expect(hidden(p).lessons).toEqual([ID.lesson3, ID.lesson4]);
    expect(upserted(p, "lessonquizquestions")).toEqual([ID.qqLesson1, "c0000000-0000-4000-8000-000000000035", ID.qqLesson2Q2]);
    expect(upserted(p, "questions")).toEqual([ID.q1, ID.q2, ID.q3, ID.q4, ID.q5]);
  });

  it("is a pure function of the file: planning twice gives the same plan", () => {
    expect(plan()).toEqual(plan());
  });
});

describe("the programme", () => {
  const gradeStep = (p: Json) => p.steps.find((s: Json) => s.kind === "upsert" && s.table === "grades");
  const curriculumStep = (p: Json) => p.steps.find((s: Json) => s.kind === "upsert" && s.table === "curriculums");

  it("names the curriculum and the grade after the programme: English in the base column, Khmer as the km row with the hash of that English", () => {
    const p = plan();
    expect(curriculumStep(p).values.curriculumname).toBe("en programme");
    expect(gradeStep(p).values.gradename).toBe("en programme");
    for (const [table, rowid, field] of [
      ["curriculums", ID.curriculum, "curriculumname"],
      ["grades", ID.grade, "gradename"],
    ]) {
      expect(forRow(p, table, rowid)).toEqual([
        {
          translationid: translationId(table, rowid, field, "", "km"),
          organisationid: ORG,
          tablename: table,
          rowid,
          field,
          subkey: "",
          language: "km",
          text: km("programme"),
          sourcehash: createHash("sha256").update("en programme", "utf8").digest("hex"),
          lastupdated: "2026-10-28 09:30:15.123",
        },
      ]);
    }
    // nothing Khmer in the base columns, and one curriculum row and one grade row only
    expect(JSON.stringify(gradeStep(p).values)).not.toMatch(/[\u1780-\u17ff]/);
    expect(JSON.stringify(curriculumStep(p).values)).not.toMatch(/[\u1780-\u17ff]/);
    expect(translations(p).filter((v) => v.tablename === "grades")).toHaveLength(1);
    expect(translations(p).filter((v) => v.tablename === "curriculums")).toHaveLength(1);
  });

  it("never names the curriculum or the grade after the module: the module is the level", () => {
    const p = plan(sample({ module: { number: 1, name: bi("quite another title") } }));
    expect(curriculumStep(p).values.curriculumname).toBe("en programme");
    expect(gradeStep(p).values.gradename).toBe("en programme");
    expect(p.steps.find((s: Json) => s.kind === "upsert" && s.table === "levels").values.levelname).toBe("en quite another title");
    expect(forRow(p, "levels", ID.level).map((v) => [v.text, v.sourcehash])).toEqual([[km("quite another title"), sourceHash("en quite another title")]]);
    expect(forRow(p, "curriculums", ID.curriculum).map((v) => v.text)).toEqual([km("programme")]);
    // and the programme's own wording is nowhere else
    expect(JSON.stringify(p.steps.filter((s: Json) => s.table === "levels" || s.table === "lessons"))).not.toContain("en programme");
  });

  it("is accepted by the validator and refused when missing or not a pair of non-empty lines", () => {
    expect(() => validateContent(sample(), ID)).not.toThrow();
    const without = sample();
    delete without.programme;
    expect(refusal(without)).toEqual([
      'programme is missing; it is required, as "programme": { "en": "...", "km": "..." } (the curriculum and the grade are named after it)',
    ]);
    expect(refusal(sample({ programme: { en: "only english" } }))).toEqual(['programme needs a non-empty "en" and "km"']);
    expect(refusal(sample({ programme: { en: "  ", km: km("x") } }))).toEqual(['programme needs a non-empty "en" and "km"']);
    expect(refusal(sample({ programme: null }))).toEqual(['programme needs a non-empty "en" and "km"']);
    expect(refusal(sample({ programme: "text" }))).toEqual(['programme needs a non-empty "en" and "km"']);
    expect(refusal(sample({ programme: { en: "two\nlines", km: km("x") } }))).toEqual(["programme.en must be one line (it has a line break)"]);
    expect(refusal(sample({ programme: { en: "x", km: `${km("a")}\r\n${km("b")}` } }))).toEqual(["programme.km must be one line (it has a line break)"]);
    expect(refusal(sample({ programme: { en: "x\u2028y", km: km("x") } }))).toEqual(["programme.en must be one line (it has a line break)"]);
  });

  it("refuses a file in the old shape, with a message that names the new one", () => {
    const old = {
      programme: bi("programme"),
      curriculum: { name: bi("module") },
      level: { name: bi("module level") },
      lessons: sample().lessons,
    };
    expect(refusal(old)).toEqual([OLD_SHAPE]);
    expect(OLD_SHAPE).toContain('"programme": { "en", "km" } (required)');
    expect(OLD_SHAPE).toContain('"module": { "number": N, "name": { "en", "km" } }');
    // the old shape without a level, or without a programme, is the old shape too; and a new file that still carries one of the old keys is refused
    const { level, ...noLevel } = old; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(refusal(noLevel)).toEqual([OLD_SHAPE]);
    const { programme, ...noProgramme } = old; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(refusal(noProgramme)).toEqual([OLD_SHAPE]);
    expect(refusal(sample({ curriculum: { name: bi("module") } }))).toEqual([OLD_SHAPE]);
    expect(() => planContent(old, ID, { organisationid: ORG, now: NOW })).toThrow(ContentRefused);
  });

  it("refuses a module that is missing, has no usable number or no name", () => {
    const without = sample();
    delete without.module;
    expect(refusal(without)).toEqual(['module is missing; it is required, as "module": { "number": N, "name": { "en": "...", "km": "..." } }']);
    for (const number of [0, -1, 1.5, "2", null, undefined, NaN]) {
      expect(refusal(sample({ module: { number, name: bi("m") } }))).toEqual(["module.number must be a whole number from 1"]);
    }
    expect(refusal(sample({ module: { number: 1, name: { en: "only" } } }))).toEqual(['module.name needs a non-empty "en" and "km"']);
    expect(refusal(sample({ module: "Module 1" }))).toEqual(['module is missing; it is required, as "module": { "number": N, "name": { "en": "...", "km": "..." } }']);
  });
});

// ---- a module after the first ------------------------------------------------------------------

const laterSample = (number = 2, over: Json = {}): Json => ({
  programme: bi("programme"),
  module: { number, name: bi(`module ${number}`) },
  lessons: [
    {
      order: 1,
      name: bi("later one"),
      video: { ref: "REF-L1", filename: `dcrs-m${number}-l1.mp4`, source: "synthetic.mp4" },
      practice: [question(`DCRS-M${number}-P1`, "lp1"), question(`DCRS-M${number}-P2`, "lp2")],
      quiz: [question(`DCRS-M${number}-Q1`, "lq1", 3, 1)],
    },
    {
      order: 2,
      name: bi("later two"),
      video: { ref: "REF-L2", filename: `dcrs-m${number}-l2.mp4` },
      practice: [question(`DCRS-M${number}-P3`, "lp3")],
      quiz: [],
    },
  ],
  ...over,
});

const module1Ids = (): Set<string> => new Set<string>([...(Object.values(ID) as string[]), ...idsOfSlots(slotsOf(ID, 1))]);
/** The ids a plan writes or hides that belong to the module itself: every one but the programme's own rows (the curriculum and the grade). */
const moduleOwnIds = (p: Json): string[] =>
  p.steps
    .filter((s: Json) => !(s.kind === "upsert" && (s.table === "curriculums" || s.table === "grades")))
    .filter((s: Json) => !(s.kind === "translate" && (s.values.tablename === "curriculums" || s.values.tablename === "grades")))
    .flatMap((s: Json) => (s.kind === "hide" ? s.ids : [s.id]));

describe("version-5 ids", () => {
  it("uuidV5 is RFC 4122 version 5 (the specification's own example)", () => {
    // RFC 4122 appendix B names the DNS namespace; the value is the well-known uuid5(NAMESPACE_DNS, "python.org")
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("derives a module's ids from the pinned namespace and the role path, and the derivation never changes", () => {
    expect(MODULE_ID_NAMESPACE).toBe("5d7c3c0e-2b6a-4f0e-9a41-6e0c1f8d2a73");
    expect(moduleId(2, "lesson", 1)).toBe(uuidV5(MODULE_ID_NAMESPACE, "dcrs/m2/lesson/1"));
    // pinned, so that a change to the namespace or to the role paths (which would rename every later module) goes red
    expect(moduleId(2, "lesson", 1)).toBe("7b29725e-170d-5683-870a-081b71155e98");
    expect(moduleId(2, "level")).toBe("044fdb7c-67f6-598a-99f6-a241808437f5");
    expect(moduleId(2, "q", "practice", 1, 3)).toBe("02b9ef89-c357-5779-8ae9-51f410ae49ce");
    const slots = slotsOf(ID, 2);
    expect(slots.level).toBe(moduleId(2, "level"));
    expect(slots.lessons[0]).toMatchObject({
      n: 1,
      id: moduleId(2, "lesson", 1),
      doc: moduleId(2, "doc", 1),
      learning: moduleId(2, "learning", 1),
      practice: moduleId(2, "practice", 1),
      quiz: moduleId(2, "quiz", 1),
    });
    expect(slots.lessons[0].practiceJoins[2]).toBe(moduleId(2, "join", "practice", 1, 3));
    expect(slots.lessons[0].quizJoins[0]).toBe(moduleId(2, "join", "quiz", 1, 1));
    expect(slots.lessons[0].practiceQuestions[2]).toBe(moduleId(2, "q", "practice", 1, 3));
    expect(slots.lessons[11].quizQuestions[3]).toBe(moduleId(2, "q", "quiz", 12, 4));
    for (const id of idsOfSlots(slots)) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("gives a module 12 lesson slots of up to four practice and four quiz questions, and no id twice", () => {
    const slots = slotsOf(ID, 2);
    expect(slots.pooled).toBe(false);
    expect(slots.lessons).toHaveLength(MAX_LESSONS_LATER_MODULE);
    expect(slots.questions).toHaveLength(12 * 8);
    const all = idsOfSlots(slots);
    expect(new Set(all).size).toBe(all.length);
    // 1 level + 12 x (5 rows + 8 joins) + 96 questions
    expect(all).toHaveLength(1 + 12 * 13 + 96);
  });

  it("no id of one module equals an id of another module, or one of Module 1's fixed ids or the seed's id map", () => {
    const m1 = module1Ids();
    expect(m1.size).toBeGreaterThan(60);
    const seen = new Set<string>();
    let total = 0;
    for (const n of [2, 3, 4, 5, 9, 10, 11, 12, 21, 99, 100, 111]) {
      const ids = idsOfSlots(slotsOf(ID, n));
      total += ids.length;
      for (const id of ids) {
        expect(m1.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(total);
    // Module 1's own slots are the seed's fixed ids, not derived ones
    expect(slotsOf(ID, 1).level).toBe(ID.level);
    expect(slotsOf(ID).lessons.map((l: Json) => l.id)).toEqual(LESSON_IDS);
  });

  it("the plan itself refuses to run if a derived id ever equalled one of Module 1's", () => {
    // planContent asserts it; a clash cannot be built from the real namespace, so check the guard through a seed map that holds a derived id
    const hostile = { ...ID, extraThing: moduleId(2, "lesson", 1) };
    expect(() => planContent(laterSample(2), hostile, { organisationid: ORG, now: NOW })).toThrow(/not distinct from Module 1's fixed ids/);
    expect(() => planContent(laterSample(3), hostile, { organisationid: ORG, now: NOW })).not.toThrow();
  });
});

describe("planning a module after the first", () => {
  const p2 = (over: Json = {}, opts: Json = {}) => planContent(laterSample(2, over), ID, { organisationid: ORG, now: NOW, ...opts });

  it("pins Module 1's ids: the file Module 1 has always been written from gives exactly the same ids and statements in the same order", () => {
    const ids = plan().steps.map((s: Json) => `${s.kind}:${s.table}:${s.kind === "hide" ? s.ids.join(",") : s.id}`);
    // the digest of this list is the one the plan produced before modules existed (computed from the commit this change was made on top of)
    expect(createHash("sha256").update(ids.join("\n")).digest("hex")).toBe(MODULE_1_STEP_IDS_DIGEST);
  });

  it("writes the module's own level under the existing grade: order = module number; without a switch the plan does not write levelstatus", () => {
    const level = p2().steps.find((s: Json) => s.kind === "upsert" && s.table === "levels");
    expect(level.id).toBe(moduleId(2, "level"));
    expect(level.values).toMatchObject({ gradeid: ID.grade, levelname: "en module 2", leveldescription: "", levelorder: 2, levelstatus: 1, isdeleted: 0 });
    expect(level.update).toEqual(["levelname", "leveldescription", "levelorder", "points", "isdeleted"]);
    // nothing is known of the database here (existing: null), so the switch is unknown; two lessons of 100 and no level quiz (the import writes none)
    expect(p2().module).toEqual({ number: 2, levelid: moduleId(2, "level"), levelorder: 2, levelstatus: null, levelpoints: 200, gradepoints: 200, levelIsNew: null });
    expect(plan(laterSample(7)).module).toMatchObject({ number: 7, levelorder: 7 });
    expect(plan(laterSample(7)).steps.find((s: Json) => s.table === "levels").values.levelorder).toBe(7);
    expect(forRow(p2(), "levels", moduleId(2, "level")).map((v) => [v.text, v.sourcehash])).toEqual([[km("module 2"), sourceHash("en module 2")]]);
  });

  it("with the draft switch the level is written switched off (levelstatus 0), and nothing else about the plan changes but the grade's points", () => {
    const draft = p2({}, { levelSwitch: "draft" });
    const live = p2({}, { levelSwitch: "live" });
    expect(draft.steps.find((s: Json) => s.table === "levels").values.levelstatus).toBe(0);
    expect(draft.steps.find((s: Json) => s.table === "levels").update).toContain("levelstatus");
    expect(draft.module.levelstatus).toBe(0);
    expect(live.steps.find((s: Json) => s.table === "levels").values.levelstatus).toBe(1);
    expect(live.module.levelstatus).toBe(1);
    const strip = (p: Json) => JSON.stringify(p.steps.filter((s: Json) => s.table !== "levels" && s.table !== "grades"));
    expect(strip(draft)).toBe(strip(live));
    // lessons are not switched off themselves: the level is what keeps them from learners
    expect(draft.steps.filter((s: Json) => s.table === "lessons" && s.kind === "upsert").every((s: Json) => s.values.lessonstatus === 1 && s.values.isdeleted === 0)).toBe(true);
    expect(planContent(sample(), ID, { organisationid: ORG, now: NOW, levelSwitch: "live" }).steps.find((s: Json) => s.table === "levels").values.levelstatus).toBe(1);
    for (const bad of ["yes", true, false, "Draft", 0]) {
      expect(() => planContent(laterSample(), ID, { organisationid: ORG, now: NOW, levelSwitch: bad })).toThrow(ContentRefused);
    }
    expect(() => planContent(laterSample(), ID, { organisationid: ORG, now: NOW, renameLessons: "yes" })).toThrow(ContentRefused);
  });

  it("puts every lesson, question and join under its own derived id, by role", () => {
    const p = p2();
    expect(upserted(p, "lessons")).toEqual([moduleId(2, "lesson", 1), moduleId(2, "lesson", 2)]);
    expect(upserted(p, "documents")).toEqual([moduleId(2, "doc", 1), moduleId(2, "doc", 2)]);
    expect(upserted(p, "lessonlearnings")).toEqual([moduleId(2, "learning", 1), moduleId(2, "learning", 2)]);
    expect(upserted(p, "lessonpractices")).toEqual([moduleId(2, "practice", 1), moduleId(2, "practice", 2)]);
    expect(upserted(p, "lessonquizzes")).toEqual([moduleId(2, "quiz", 1), moduleId(2, "quiz", 2)]);
    expect(upserted(p, "questions")).toEqual([
      moduleId(2, "q", "practice", 1, 1),
      moduleId(2, "q", "practice", 1, 2),
      moduleId(2, "q", "quiz", 1, 1),
      moduleId(2, "q", "practice", 2, 1),
    ]);
    expect(upserted(p, "lessonpracticequestions")).toEqual([moduleId(2, "join", "practice", 1, 1), moduleId(2, "join", "practice", 1, 2), moduleId(2, "join", "practice", 2, 1)]);
    expect(upserted(p, "lessonquizquestions")).toEqual([moduleId(2, "join", "quiz", 1, 1)]);
    const lesson = p.steps.find((s: Json) => s.kind === "upsert" && s.table === "lessons" && s.id === moduleId(2, "lesson", 2));
    expect(lesson.values).toMatchObject({ levelid: moduleId(2, "level"), lessonorder: 2, lessonname: "en later two", isdeleted: 0, lessonstatus: 1 });
    expect(p.steps.find((s: Json) => s.table === "documents").values.documentname).toBe("dcrs-m2-l1.mp4");
    expect(p.media).toEqual([
      { lessonid: moduleId(2, "lesson", 1), ref: "REF-L1", source: "synthetic.mp4", filename: "dcrs-m2-l1.mp4" },
      { lessonid: moduleId(2, "lesson", 2), ref: "REF-L2", source: null, filename: "dcrs-m2-l2.mp4" },
    ]);
    // a question's options are keyed by its own id
    const q = p.steps.find((s: Json) => s.table === "questions" && s.id === moduleId(2, "q", "quiz", 1, 1));
    expect(JSON.parse(q.values.questionoptions).map((o: Json) => o.questionoptionid)).toEqual([1, 2, 3].map((i) => `${moduleId(2, "q", "quiz", 1, 1)}-opt-${i}`));
    expect(q.values.questionidentifier).toBe("DCRS-M2-Q1");
  });

  it("a lesson is its order: the lesson of order 3 is slot 3 whatever the file lists before it", () => {
    const c = laterSample(2);
    c.lessons[0].order = 3;
    c.lessons[1].order = 1;
    const p = plan(c);
    // written in lesson order, each under the slot its order names
    expect(upserted(p, "lessons")).toEqual([moduleId(2, "lesson", 1), moduleId(2, "lesson", 3)]);
    expect(p.steps.find((s: Json) => s.table === "lessons" && s.id === moduleId(2, "lesson", 3)).values.lessonname).toBe("en later one");
    // the first-listed lesson (order 3) takes its practice questions from slot 3's own ids, not from the front of a pool
    expect(upserted(p, "questions")).toContain(moduleId(2, "q", "practice", 3, 2));
    expect(upserted(p, "questions")).not.toContain(moduleId(2, "q", "practice", 2, 1));
  });

  it("touches nothing of Module 1 or any other module: no write or hide of a Module 1 id, except the programme's own curriculum and grade rows", () => {
    const m1 = module1Ids();
    for (const levelSwitch of ["live", "draft"]) {
      const p = p2({}, { levelSwitch });
      for (const id of moduleOwnIds(p)) expect(m1.has(id)).toBe(false);
      const touched = p.steps.filter((s: Json) => s.kind !== "translate").flatMap((s: Json) => (s.kind === "hide" ? s.ids : [s.id])).filter((id: string) => m1.has(id));
      expect(touched).toEqual([ID.curriculum, ID.grade]);
      // everything the module hides is one of its own slots
      const own = new Set(idsOfSlots(slotsOf(ID, 2)));
      for (const step of p.steps.filter((s: Json) => s.kind === "hide")) for (const id of step.ids) expect(own.has(id)).toBe(true);
      // the same file as module 3 shares no id with it
      const other = new Set(moduleOwnIds(plan(laterSample(3))));
      for (const id of moduleOwnIds(p)) expect(other.has(id)).toBe(false);
    }
  });

  it("renames the curriculum and the grade (and sets the grade's points) and no more: their other columns are not in the update list, so a draft module cannot publish the programme", () => {
    const p = p2();
    const c = p.steps.find((s: Json) => s.kind === "upsert" && s.table === "curriculums");
    const g = p.steps.find((s: Json) => s.kind === "upsert" && s.table === "grades");
    expect(c.update).toEqual(["curriculumname"]);
    expect(g.update).toEqual(["gradename", "points"]);
    expect(c.values.curriculumname).toBe("en programme");
    expect(g.values.gradename).toBe("en programme");
    expect(statementOf(c).sql).toMatch(/ON DUPLICATE KEY UPDATE `curriculumname` = VALUES\(`curriculumname`\)$/);
    expect(p.requires).toEqual([
      { what: "curriculum", table: "curriculums", pk: "curriculumid", ids: [ID.curriculum] },
      { what: "grade", table: "grades", pk: "gradeid", ids: [ID.grade] },
    ]);
    expect(plan().requires).toEqual([]);
    expect(p.curriculumName).toBe("en programme");
  });

  it("gives the programme's two translation rows the ids Module 1 gives them, and every other row a version-5 id from its role path", () => {
    const m1 = translations(plan());
    const p = p2();
    const rows = translations(p);
    for (const table of ["curriculums", "grades"]) {
      expect(rows.find((v) => v.tablename === table)!.translationid).toBe(m1.find((v) => v.tablename === table)!.translationid);
    }
    const lessonRow = rows.find((v) => v.tablename === "lessons" && v.rowid === moduleId(2, "lesson", 1))!;
    expect(lessonRow.translationid).toBe(uuidV5(MODULE_ID_NAMESPACE, `dcrs/m2/tr/lessons/${moduleId(2, "lesson", 1)}/lessonname/`));
    const optionRow = rows.find((v) => v.field === "questionoptiontext" && v.subkey === `${moduleId(2, "q", "quiz", 1, 1)}-opt-2`)!;
    expect(optionRow.translationid).toBe(uuidV5(MODULE_ID_NAMESPACE, `dcrs/m2/tr/questions/${moduleId(2, "q", "quiz", 1, 1)}/questionoptiontext/${moduleId(2, "q", "quiz", 1, 1)}-opt-2`));
    const ids = rows.map((v) => v.translationid);
    expect(new Set(ids).size).toBe(ids.length);
    const m1ids = new Set(m1.map((v) => v.translationid));
    expect(rows.filter((v) => m1ids.has(v.translationid)).map((v) => v.tablename).sort()).toEqual(["curriculums", "grades"]);
    // 2 programme rows + level + 2 x (lesson, learning, practice, quiz) + 4 questions x (text, heading) + options (4+4+3+4) ... counted from the rows themselves
    expect(rows.filter((v) => v.tablename === "levels")).toHaveLength(1);
  });

  it("is a pure function of the file: the same file plans to the same ids on any day", () => {
    expect(p2()).toEqual(p2());
    expect(idsOf(p2())).toEqual(idsOf(planContent(laterSample(2), ID, { organisationid: ORG, now: new Date("2031-05-05T00:00:00Z") })));
  });

  it("hides only this module's own lessons the file does not name: all of the other eleven slots, and none of Module 1's", () => {
    const h = hidden(p2());
    expect(h.lessons).toEqual(slotsOf(ID, 2).lessons.slice(2).map((l: Json) => l.id));
    expect(h.lessons).toHaveLength(10);
    expect(h.documents).toEqual(slotsOf(ID, 2).lessons.slice(2).map((l: Json) => l.doc));
    expect(h.lessonlearnings).toHaveLength(10);
    expect(h.lessonpractices).toHaveLength(10);
    expect(h.lessonquizzes).toHaveLength(10);
    for (const id of Object.values(h).flat() as string[]) expect(module1Ids().has(id)).toBe(false);
  });

  it("with a lesson dropped from the file, only that lesson of this module is newly hidden", () => {
    const before = hidden(p2());
    const c = laterSample(2);
    c.lessons.pop(); // the lesson of order 2
    const after = hidden(plan(c));
    const dropped = slotsOf(ID, 2).lessons[1];
    expect(after.lessons.filter((id: string) => !before.lessons.includes(id))).toEqual([dropped.id]);
    expect(after.documents.filter((id: string) => !before.documents.includes(id))).toEqual([dropped.doc]);
    expect(after.lessonlearnings.filter((id: string) => !before.lessonlearnings.includes(id))).toEqual([dropped.learning]);
    expect(after.lessonpractices.filter((id: string) => !before.lessonpractices.includes(id))).toEqual([dropped.practice]);
    expect(after.lessonquizzes.filter((id: string) => !before.lessonquizzes.includes(id))).toEqual([dropped.quiz]);
    // its question ids and join slots go too, and they are its own
    expect(after.questions.filter((id: string) => !before.questions.includes(id))).toEqual([dropped.practiceQuestions[0]]);
    expect(after.lessonpracticequestions.filter((id: string) => !before.lessonpracticequestions.includes(id))).toEqual([dropped.practiceJoins[0]]);
    // lesson 1 is still live
    expect(after.lessons).not.toContain(slotsOf(ID, 2).lessons[0].id);
  });

  it("a question that stays in a lesson keeps its id when a sibling is dropped (ids are roles, not positions in a pool)", () => {
    const full = upserted(p2(), "questions");
    const c = laterSample(2);
    c.lessons.shift(); // drop lesson order 1: lesson 2's question must not move to lesson 1's ids
    const some = upserted(plan(c), "questions");
    expect(some).toEqual([moduleId(2, "q", "practice", 2, 1)]);
    expect(full).toContain(moduleId(2, "q", "practice", 2, 1));
  });

  it("allows what Module 1 cannot: more than seven questions, up to 12 lessons of four practice and four quiz", () => {
    const lessons = Array.from({ length: 12 }, (_, i) => ({
      order: i + 1,
      name: bi(`l${i + 1}`),
      video: { ref: `R${i + 1}`, filename: `dcrs-m2-l${i + 1}.mp4` },
      practice: Array.from({ length: 4 }, (_x, j) => question(`DCRS-M2-L${i + 1}P${j + 1}`, `l${i}p${j}`)),
      quiz: Array.from({ length: 4 }, (_x, j) => question(`DCRS-M2-L${i + 1}Q${j + 1}`, `l${i}q${j}`)),
    }));
    const p = plan(laterSample(2, { lessons }));
    expect(upserted(p, "questions")).toHaveLength(96);
    expect(new Set(upserted(p, "questions")).size).toBe(96);
    expect(hidden(p).lessons).toBeUndefined();
    expect(hidden(p).questions).toBeUndefined();
    expect(upserted(p, "lessons")).toHaveLength(12);
    // Module 1 still allows seven
    const eight = sample();
    eight.lessons[0].practice = Array.from({ length: 4 }, (_, i) => question(`DCRS-M1-P${i + 1}`, `p${i}`));
    eight.lessons[0].quiz = Array.from({ length: 4 }, (_, i) => question(`DCRS-M1-Q${i + 1}`, `q${i}`));
    expect(refusal(eight)).toEqual(["the file names 8 questions; the seed has 7 fixed question ids"]);
  });

  it("refuses what a later module cannot hold: a lesson id, an order out of range or repeated, a fifth question", () => {
    const withId = laterSample(2);
    withId.lessons[0].id = ID.lesson1;
    expect(refusal(withId)).toEqual(["lessons[0].id must not be given for module 2: its lessons are identified by their order"]);
    for (const order of [0, 13, 1.5, "1", undefined]) {
      const c = laterSample(2);
      c.lessons[0].order = order;
      expect(refusal(c)).toEqual(["lessons[0].order must be a whole number from 1 to 12 (it is also the lesson's slot in the module)"]);
    }
    const twice = laterSample(2);
    twice.lessons[1].order = 1;
    expect(refusal(twice)).toEqual(["lessons[1].order 1 is used by another lesson"]);
    const five = laterSample(2);
    five.lessons[0].quiz = Array.from({ length: 5 }, (_, i) => question(`DCRS-M2-X${i}`, `x${i}`));
    expect(refusal(five)).toEqual(["lessons[0].quiz names 5 questions; a lesson has room for 4"]);
    // Module 1 still needs one of its four fixed ids
    const noId = sample();
    delete noId.lessons[0].id;
    expect(refusal(noId)).toEqual(["lessons[0].id is not a DCRS fixed lesson id"]);
    // a file that names Module 1's lesson ids but says it is module 2 is a mismatch
    const mismatch = sample({ module: { number: 2, name: bi("m") } });
    expect(refusal(mismatch)).toEqual(["lessons[0].id must not be given for module 2: its lessons are identified by their order"]);
  });
});

/** Every id a plan writes, in order (a step's id, or the ids a hide names). */
const idsOf = (p: Json): string[] => p.steps.flatMap((s: Json) => (s.kind === "hide" ? s.ids : [s.id]));

describe("the level switch, the points and the lesson slots", () => {
  const level = (levelid: string, over: Json = {}): Json => ({ levelid, levelstatus: 1, isdeleted: 0, points: 100, quiz_points: 20, levelquizrows: 0, ...over });
  const lessonRow = (n: number, over: Json = {}): Json => ({ lessonid: moduleId(2, "lesson", n), lessonname: n === 1 ? "en later one" : "en later two", isdeleted: 0, total_points: 100, ...over });
  const db = (levels: Json[], lessons: Json[] = []): Json => ({ levels, lessons });
  const run = (content: Json, opts: Json = {}): Json => planContent(content, ID, { organisationid: ORG, now: NOW, ...opts });
  const problemsOf = (fn: () => unknown): string[] => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ContentRefused);
      return (e as { problems: string[] }).problems;
    }
    throw new Error("expected the plan to be refused");
  };
  const step = (p: Json, table: string): Json => p.steps.find((s: Json) => s.kind === "upsert" && s.table === table);
  const NEW_LEVEL = (n: number) => `module ${n}'s level is not in the database yet; say whether learners see it: --draft (switched off, built but not shown) or --live (switched on)`;
  const NO_DRAFT_1 = "--draft is refused for module 1: it is the delivered module, and a learner already reads it; switch a later module off, not this one";
  const SLOT = (n: number, order: number) =>
    `module ${n}, lesson slot ${order}: the lesson there now (hidden or not) has another English name than the file's; give the new lesson a new order (--rename-lessons renames it in place)`;

  describe("the switch is explicit", () => {
    it("a level that is not in the database is refused without --draft or --live, with the reason, for Module 1 and for a later module", () => {
      expect(problemsOf(() => run(laterSample(2), { existing: db([level(ID.level)]) }))).toEqual([NEW_LEVEL(2)]);
      expect(problemsOf(() => run(laterSample(3), { existing: db([level(ID.level)]) }))).toEqual([NEW_LEVEL(3)]);
      expect(problemsOf(() => run(sample(), { existing: db([]) }))).toEqual([NEW_LEVEL(1)]);
      // either flag names it; and a dry run (nothing known of the database) is not refused for it
      expect(() => run(laterSample(2), { existing: db([level(ID.level)]), levelSwitch: "draft" })).not.toThrow();
      expect(() => run(laterSample(2), { existing: db([level(ID.level)]), levelSwitch: "live" })).not.toThrow();
      expect(() => run(sample(), { existing: db([]), levelSwitch: "live" })).not.toThrow();
      expect(() => run(laterSample(2))).not.toThrow();
    });

    it("an existing level keeps the switch it has when neither flag is given: the run does not write the column", () => {
      for (const status of [0, 1]) {
        const p = run(laterSample(2), { existing: db([level(ID.level), level(moduleId(2, "level"), { levelstatus: status, points: 200 })]) });
        const l = step(p, "levels");
        expect(l.update).toEqual(["levelname", "leveldescription", "levelorder", "points", "isdeleted"]);
        expect(statementOf(l).sql).not.toContain("`levelstatus` = VALUES");
        expect(l.values.levelstatus).toBe(status);
        expect(p.module).toMatchObject({ levelstatus: status, levelIsNew: false });
      }
      // a switch that came back as the text of a number is still that number
      expect(run(laterSample(2), { existing: db([level(ID.level), level(moduleId(2, "level"), { levelstatus: "0", points: 200 })]) }).module.levelstatus).toBe(0);
    });

    it("--draft and --live write the column, and say what they wrote", () => {
      const existing = db([level(ID.level), level(moduleId(2, "level"), { levelstatus: 1, points: 200 })]);
      const draft = run(laterSample(2), { existing, levelSwitch: "draft" });
      const live = run(laterSample(2), { existing: db([level(ID.level), level(moduleId(2, "level"), { levelstatus: 0, points: 200 })]), levelSwitch: "live" });
      expect(step(draft, "levels").update).toEqual(["levelname", "leveldescription", "levelstatus", "levelorder", "points", "isdeleted"]);
      expect(step(draft, "levels").values.levelstatus).toBe(0);
      expect(step(live, "levels").values.levelstatus).toBe(1);
      expect(draft.module).toMatchObject({ levelstatus: 0, levelIsNew: false });
      expect(live.module).toMatchObject({ levelstatus: 1, levelIsNew: false });
      expect(run(laterSample(2), { existing: db([level(ID.level)]), levelSwitch: "draft" }).module).toMatchObject({ levelstatus: 0, levelIsNew: true });
    });

    it("--draft is refused for Module 1, with the reason, whatever the database holds", () => {
      expect(problemsOf(() => run(sample(), { levelSwitch: "draft" }))).toEqual([NO_DRAFT_1]);
      expect(problemsOf(() => run(sample(), { levelSwitch: "draft", existing: db([level(ID.level)]) }))).toEqual([NO_DRAFT_1]);
      expect(problemsOf(() => run(sample(), { levelSwitch: "draft", existing: db([]) }))).toEqual([NO_DRAFT_1]);
      expect(run(sample(), { levelSwitch: "live", existing: db([level(ID.level)]) }).module.levelstatus).toBe(1);
    });
  });

  describe("the points follow central's rule over the live modules", () => {
    it("Module 1 with one lesson: its level is the lesson's total_points (no level quiz, so no quiz points), and the grade is that level's", () => {
      const p = run(sample());
      expect(LESSON_TOTAL_POINTS).toBe(100);
      // quiz_points is written as it always was (the level's own setting); it is just not part of `points` without a level quiz
      expect(step(p, "levels").values).toMatchObject({ points: 100, quiz_points: DEFAULT_QUIZ_POINTS });
      expect(step(p, "levels").update).not.toContain("quiz_points");
      expect(step(p, "grades").values.points).toBe(100);
      expect(step(p, "levels").update).toContain("points");
      expect(step(p, "grades").update).toContain("points");
      expect(p.module).toMatchObject({ levelpoints: 100, gradepoints: 100 });
    });

    it("Module 1 with all four lessons counts each of them", () => {
      const c = sample();
      c.lessons = LESSON_IDS.map((id: string, i: number) => ({
        id,
        order: i + 1,
        name: bi(`lesson ${i + 1}`),
        video: { ref: `REF-${i + 1}`, filename: `dcrs-m1-l${i + 1}.mp4` },
        practice: [question(`DCRS-M1-P${i + 1}`, `p${i + 1}`)],
        quiz: [],
      }));
      const p = run(c);
      expect(p.module).toMatchObject({ levelpoints: 4 * 100, gradepoints: 4 * 100 });
    });

    it("a later module's level counts its lessons, and the grade counts the modules that are switched on", () => {
      const existing = db([level(ID.level)]);
      const live = run(laterSample(2), { existing, levelSwitch: "live" });
      const draft = run(laterSample(2), { existing, levelSwitch: "draft" });
      expect(live.module).toMatchObject({ levelpoints: 200, gradepoints: 300 });
      expect(step(live, "levels").values.points).toBe(200);
      expect(step(live, "grades").values.points).toBe(300);
      // a draft module is in its own level's points but not in the grade's: learners' progress is out of the live modules only
      expect(draft.module).toMatchObject({ levelpoints: 200, gradepoints: 100 });
      expect(step(draft, "levels").values.points).toBe(200);
      expect(step(draft, "grades").values.points).toBe(100);
      expect(step(live, "grades").update).toEqual(["gradename", "points"]);
    });

    it("another module that is switched off or deleted is not in the grade's points, one a person added that is live is", () => {
      const own = level(moduleId(2, "level"), { points: 200 });
      const base = (extra: Json[]) => run(laterSample(2), { existing: db([level(ID.level), own, ...extra]) }).module.gradepoints;
      expect(base([])).toBe(300);
      expect(base([level("x1", { levelstatus: 0, points: 999 })])).toBe(300);
      expect(base([level("x2", { isdeleted: 1, points: 999 })])).toBe(300);
      expect(base([level("x3", { points: 50 })])).toBe(350);
      // Module 1's own level switched off (an admin did it) drops out too
      expect(run(laterSample(2), { existing: db([level(ID.level, { levelstatus: 0 }), own]) }).module.gradepoints).toBe(200);
      // the module's own row in the database is replaced by what this run writes, never added to it
      expect(run(laterSample(2), { existing: db([level(ID.level), level(moduleId(2, "level"), { points: 5000 })]) }).module).toMatchObject({ levelpoints: 200, gradepoints: 300 });
    });

    it("a lesson the file no longer names is not in the level's points; a lesson's own total_points are the database's", () => {
      const c = laterSample(2);
      c.lessons.pop();
      expect(run(c, { existing: db([level(ID.level)]), levelSwitch: "live" }).module).toMatchObject({ levelpoints: 100, gradepoints: 200 });
      const own = level(moduleId(2, "level"), { quiz_points: 50, points: 0 });
      expect(run(laterSample(2), { existing: db([level(ID.level), own], [lessonRow(1, { total_points: 150 })]) }).module.levelpoints).toBe(150 + 100);
    });

    it("quiz_points count only when the level has an active level-quiz row: none, none; one or more, counted; the module's level and the grade's other levels alike", () => {
      // no level-quiz row: the level is worth its lessons, whatever quiz_points says
      const noQuiz = level(moduleId(2, "level"), { quiz_points: 50, points: 0, levelquizrows: 0 });
      expect(run(laterSample(2), { existing: db([level(ID.level), noQuiz]) }).module.levelpoints).toBe(200);
      // an active row: the quiz points are in
      const quiz = level(moduleId(2, "level"), { quiz_points: 50, points: 0, levelquizrows: 1 });
      expect(run(laterSample(2), { existing: db([level(ID.level), quiz]) }).module.levelpoints).toBe(250);
      expect(run(laterSample(2), { existing: db([level(ID.level), level(moduleId(2, "level"), { quiz_points: 50, levelquizrows: "3" })]) }).module.levelpoints).toBe(250);
      // Module 1 with a level quiz: 100 + 20, and the grade follows
      const withQuiz = run(sample(), { existing: db([level(ID.level, { levelquizrows: 2 })], [{ lessonid: ID.lesson1, lessonname: "x", isdeleted: 0, total_points: 100 }]) });
      expect(withQuiz.module).toMatchObject({ levelpoints: 120, gradepoints: 120 });
      expect(step(withQuiz, "levels").values.points).toBe(120);
      // another module's stored points (with its quiz, if it has one) are what the grade adds
      expect(run(laterSample(2), { existing: db([level(ID.level, { points: 120, levelquizrows: 1 }), noQuiz]), levelSwitch: "live" }).module.gradepoints).toBe(120 + 200);
    });

    it("Module 1 over the shape UAT is in (the level at 100 with quiz_points 20 and no level-quiz row, the grade at 100) plans exactly the points it has", () => {
      const existing = db([level(ID.level, { points: 100, quiz_points: 20, levelquizrows: 0 })], [{ lessonid: ID.lesson1, lessonname: "x", isdeleted: 0, total_points: 100 }]);
      const p = run(sample(), { existing });
      expect(p.module).toMatchObject({ levelpoints: 100, gradepoints: 100 });
      expect(step(p, "levels").values.points).toBe(100);
      expect(step(p, "grades").values.points).toBe(100);
    });
  });

  describe("a lesson slot cannot change meaning", () => {
    it("is refused when a lesson of the slot, hidden or not, has another English name, naming the slot and every slot that does", () => {
      const existing = db([level(ID.level), level(moduleId(2, "level"))], [lessonRow(1, { lessonname: "en something else" })]);
      expect(problemsOf(() => run(laterSample(2), { existing }))).toEqual([SLOT(2, 1)]);
      const both = db([level(ID.level), level(moduleId(2, "level"))], [lessonRow(1, { lessonname: "other" }), lessonRow(2, { lessonname: "another" })]);
      expect(problemsOf(() => run(laterSample(2), { existing: both }))).toEqual([SLOT(2, 1), SLOT(2, 2)]);
      // the reason names the slot, never the client's text
      expect(JSON.stringify(problemsOf(() => run(laterSample(2), { existing })))).not.toMatch(/something else|en later/);
    });

    it("a hidden lesson's slot is not free: another lesson cannot take it without --rename-lessons, whether the old lesson is hidden or not", () => {
      const levels = [level(ID.level), level(moduleId(2, "level"))];
      const hiddenOld = db(levels, [lessonRow(1, { lessonname: "en something else", isdeleted: 1 })]);
      expect(problemsOf(() => run(laterSample(2), { existing: hiddenOld }))).toEqual([SLOT(2, 1)]);
      // the same name in a hidden slot is the same lesson coming back: allowed
      expect(() => run(laterSample(2), { existing: db(levels, [lessonRow(1, { isdeleted: 1 })]) })).not.toThrow();
      // with the flag the slot is renamed in place
      expect(() => run(laterSample(2), { existing: hiddenOld, renameLessons: true })).not.toThrow();
    });

    it("passes when the name is unchanged, when the slot is empty, and when nothing is known of the database", () => {
      const levels = [level(ID.level), level(moduleId(2, "level"))];
      expect(() => run(laterSample(2), { existing: db(levels, [lessonRow(1), lessonRow(2)]) })).not.toThrow();
      expect(() => run(laterSample(2), { existing: db(levels, []) })).not.toThrow();
      expect(() => run(laterSample(2))).not.toThrow();
      // a slot the file does not name is not compared (it is hidden, not renamed)
      const c = laterSample(2);
      c.lessons.pop();
      expect(() => run(c, { existing: db(levels, [lessonRow(2, { lessonname: "en something else" })]) })).not.toThrow();
    });

    it("--rename-lessons allows the rename in place, and the lesson then carries the file's name", () => {
      const existing = db([level(ID.level), level(moduleId(2, "level"))], [lessonRow(1, { lessonname: "en something else" })]);
      const p = run(laterSample(2), { existing, renameLessons: true });
      expect(step(p, "lessons").values).toMatchObject({ lessonid: moduleId(2, "lesson", 1), lessonname: "en later one" });
      expect(step(p, "lessons").update).toContain("lessonname");
    });

    it("does not apply to Module 1, whose lessons are identified by their fixed ids", () => {
      const existing = db([level(ID.level)], [{ lessonid: ID.lesson1, lessonname: "something else", isdeleted: 0, total_points: 100 }]);
      expect(() => run(sample(), { existing })).not.toThrow();
    });
  });
});

describe("refusing a content file", () => {
  it("refuses a question with no correct option, and one with two", () => {
    const none = sample();
    none.lessons[0].practice[0].options.forEach((o: Json) => (o.correct = false));
    expect(refusal(none)).toEqual(["lessons[0].practice[0] has 0 correct options; it needs exactly 1"]);
    const two = sample();
    two.lessons[0].quiz[1].options[0].correct = true;
    expect(refusal(two)).toEqual(["lessons[0].quiz[1] has 2 correct options; it needs exactly 1"]);
  });

  it("refuses an id that is not a DCRS fixed lesson id, and a lesson named twice", () => {
    const other = sample();
    other.lessons[0].id = "00000000-0000-4000-8000-000000000001";
    expect(refusal(other)).toEqual(["lessons[0].id is not a DCRS fixed lesson id"]);
    const twice = sample();
    twice.lessons.push({ ...twice.lessons[0], video: { ref: "R", filename: "dcrs-m1-l9.mp4" }, practice: [], quiz: [] });
    expect(refusal(twice)).toEqual(["lessons[1].id is named twice"]);
  });

  it("refuses more questions than the seed has ids for, in a set and in all", () => {
    const five = sample();
    five.lessons[0].practice = Array.from({ length: 5 }, (_, i) => question(`DCRS-M1-P${i + 1}`, `p${i}`));
    expect(refusal(five)).toEqual(["lessons[0].practice names 5 questions; a lesson has room for 4"]);
    const eight = sample();
    eight.lessons[0].practice = Array.from({ length: 4 }, (_, i) => question(`DCRS-M1-P${i + 1}`, `p${i}`));
    eight.lessons[0].quiz = Array.from({ length: 4 }, (_, i) => question(`DCRS-M1-Q${i + 1}`, `q${i}`));
    expect(refusal(eight)).toEqual(["the file names 8 questions; the seed has 7 fixed question ids"]);
  });

  it("refuses a question with too few options, a missing language, a bad file key and a repeated identifier", () => {
    const c = sample();
    c.lessons[0].practice[0].options = [{ text: bi("only"), correct: true }];
    c.lessons[0].practice[1].text = { en: "english only" };
    c.lessons[0].video.filename = "../dcrs-m1-l1.mp4";
    c.lessons[0].quiz[0].ident = "DCRS-M1-P1";
    expect(refusal(c)).toEqual([
      "lessons[0].video.filename must be a bare key like dcrs-m1-l1.mp4",
      "lessons[0].practice[0] has 1 options; it needs 2 to 8",
      'lessons[0].practice[1].text needs a non-empty "en" and "km"',
      "lessons[0].quiz[0].ident DCRS-M1-P1 is used twice",
    ]);
    for (const bad of ["a.mp3", "dir/a.mp4", "a b.mp4", ".mp4", "a.mp4.exe", "a.MP4x"]) {
      const f = sample();
      f.lessons[0].video.filename = bad;
      expect(refusal(f)).toEqual(["lessons[0].video.filename must be a bare key like dcrs-m1-l1.mp4"]);
    }
  });

  it("refuses what is not a content file at all", () => {
    expect(refusal(null)).toEqual(["content.json is not an object"]);
    expect(refusal({ programme: bi("p"), module: { number: 1, name: bi("m") }, lessons: [] })).toEqual(["lessons must be a non-empty list"]);
  });
});

describe("statementOf", () => {
  it("builds an upsert that updates only the named columns, and a hide by primary key", () => {
    const p = plan();
    const lesson = statementOf(p.steps.find((s: Json) => s.table === "lessons"));
    expect(lesson.sql).toMatch(/^INSERT INTO `lessons` \(`lessonid`, `levelid`,/);
    expect(lesson.sql).toMatch(/ON DUPLICATE KEY UPDATE `lessonname` = VALUES\(`lessonname`\), `lessondescription` = VALUES\(`lessondescription`\), `lessonorder` = VALUES\(`lessonorder`\), `lessonstatus` = VALUES\(`lessonstatus`\), `isdeleted` = VALUES\(`isdeleted`\)$/);
    expect(lesson.sql.match(/\?/g)).toHaveLength(lesson.params.length);
    const hide = statementOf(p.steps.find((s: Json) => s.kind === "hide" && s.table === "lessons"));
    expect(hide).toEqual({ sql: "UPDATE `lessons` SET `isdeleted` = ? WHERE `lessonid` IN (?, ?, ?)", params: [1, ID.lesson2, ID.lesson3, ID.lesson4] });
  });

  it("builds a translation upsert that keeps the row's id and moves lastupdated only when the text or the hash changes", () => {
    const stmt = statementOf(plan().steps.find((s: Json) => s.kind === "translate"));
    expect(stmt.sql).toMatch(/^INSERT INTO `contenttranslations` \(`translationid`, `organisationid`, `tablename`, `rowid`, `field`, `subkey`, `language`, `text`, `sourcehash`, `lastupdated`\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?\) /);
    // lastupdated is assigned before the text and hash, which MySQL would otherwise have already overwritten when it tests them
    expect(stmt.sql).toMatch(
      /ON DUPLICATE KEY UPDATE `lastupdated` = IF\(BINARY `text` <> BINARY VALUES\(`text`\) OR `sourcehash` <> VALUES\(`sourcehash`\), VALUES\(`lastupdated`\), `lastupdated`\), `text` = VALUES\(`text`\), `sourcehash` = VALUES\(`sourcehash`\)$/,
    );
    expect(stmt.sql).not.toMatch(/`translationid` = VALUES|`organisationid` = VALUES/);
    expect(stmt.sql.match(/\?/g)).toHaveLength(stmt.params.length);
  });
});

// ---- the applier, on an in-memory stand-in for the connection ----------------------------------

type Store = Record<string, Record<string, Json>>;
const fakeConn = (opts: { ignoreUpdates?: boolean; failOnTable?: string; noTranslationsTable?: boolean } = {}) => {
  let store: Store = {};
  let snapshot: Store | null = null;
  const log: string[] = [];
  const clone = (s: Store): Store => JSON.parse(JSON.stringify(s));
  const conn = {
    beginTransaction: jest.fn(async () => {
      snapshot = clone(store);
      log.push("begin");
    }),
    commit: jest.fn(async () => {
      snapshot = null;
      log.push("commit");
    }),
    rollback: jest.fn(async () => {
      if (snapshot) store = snapshot;
      snapshot = null;
      log.push("rollback");
    }),
    execute: jest.fn(async (sql: string, params: unknown[]): Promise<[Json, undefined]> => {
      if (/information_schema\.columns/.test(sql)) return [[{ n: opts.noTranslationsTable ? 1 : 2 }] as unknown as Json, undefined];
      if (/^SELECT l\.levelid, l\.levelstatus, l\.isdeleted, l\.points, l\.quiz_points, \(SELECT COUNT\(\*\) FROM `levelquizquestions` q WHERE q\.`levelid` = l\.`levelid` AND q\.`levelquizquestionstatus` = 1\) AS levelquizrows FROM `levels` l WHERE l\.`gradeid` = \?$/.test(sql)) {
        const rows = Object.values(store.levels ?? {}).filter((l: Json) => l.gradeid === params[0]);
        const active = (levelid: string) => Object.values(store.levelquizquestions ?? {}).filter((q: Json) => q.levelid === levelid && Number(q.levelquizquestionstatus) === 1).length;
        return [
          rows.map((l: Json) => ({ levelid: l.levelid, levelstatus: l.levelstatus, isdeleted: l.isdeleted, points: l.points, quiz_points: l.quiz_points, levelquizrows: active(l.levelid) })) as unknown as Json,
          undefined,
        ];
      }
      if (/^SELECT lessonid, lessonname, isdeleted, total_points FROM `lessons` WHERE `lessonid` IN \(.*\)$/.test(sql)) {
        const rows = (params as string[]).map((id) => store.lessons?.[id]).filter((l) => l !== undefined);
        return [rows.map((l: Json) => ({ lessonid: l.lessonid, lessonname: l.lessonname, isdeleted: l.isdeleted, total_points: l.total_points })) as unknown as Json, undefined];
      }
      if (/^SELECT curriculumname FROM curriculums WHERE curriculumid = \?$/.test(sql)) {
        const row = store.curriculums?.[params[0] as string];
        return [(row ? [{ curriculumname: row.curriculumname }] : []) as unknown as Json, undefined];
      }
      const lang = /^SELECT contentlanguage FROM organisations WHERE organisationid = \?( FOR UPDATE)?$/.exec(sql);
      if (lang) {
        const org = store.organisations?.[params[0] as string];
        return [(org ? [{ contentlanguage: org.contentlanguage }] : []) as unknown as Json, undefined];
      }
      if (/^UPDATE organisations SET contentlanguage = \? WHERE organisationid = \? AND contentlanguage IS NULL$/.test(sql)) {
        const org = store.organisations?.[params[1] as string];
        if (!org || org.contentlanguage !== null || opts.ignoreUpdates) return [{ affectedRows: 0 }, undefined];
        org.contentlanguage = params[0];
        return [{ affectedRows: 1 }, undefined];
      }
      if (/^SELECT COUNT\(\*\) AS n FROM organisations WHERE organisationid = \? AND contentlanguage = \?$/.test(sql)) {
        return [[{ n: String(store.organisations?.[params[0] as string]?.contentlanguage).toLowerCase() === params[1] ? 1 : 0 }] as unknown as Json, undefined];
      }
      const owner = /^SELECT COUNT\(\*\) AS n FROM `(\w+)` WHERE `(\w+)` IN \((.*?)\) AND `organisationid` IS NOT NULL AND `organisationid` <> \?$/.exec(sql);
      if (owner) {
        const ids = params.slice(0, -1) as string[];
        const n = ids.filter((id) => { const o = store[owner[1]]?.[id]?.organisationid; return o !== undefined && o !== null && o !== params[params.length - 1]; }).length;
        return [[{ n }] as unknown as Json, undefined];
      }
      if (/^INSERT INTO `contenttranslations`/.test(sql)) {
        if (opts.failOnTable === "contenttranslations") throw new Error("boom");
        const cols = ["translationid", "organisationid", "tablename", "rowid", "field", "subkey", "language", "text", "sourcehash", "lastupdated"];
        const row: Json = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
        const rows = (store.contenttranslations ??= {});
        const key = [row.tablename, row.rowid, row.field, row.subkey, row.language].join("|");
        const old = rows[key];
        if (!old) {
          rows[key] = row;
          return [{ affectedRows: 1 }, undefined];
        }
        // the statement's own rule: the id and owner stay, text and hash follow, lastupdated moves only when one of them changed
        const changed = old.text !== row.text || old.sourcehash !== row.sourcehash;
        if (changed) Object.assign(old, { text: row.text, sourcehash: row.sourcehash, lastupdated: row.lastupdated });
        return [{ affectedRows: changed ? 2 : 0 }, undefined];
      }
      const tcount = /^SELECT COUNT\(\*\) AS n FROM `contenttranslations` WHERE `tablename` = \?/.exec(sql);
      if (tcount) {
        const [tablename, rowid, field, subkey, language, organisationid, sourcehash, text] = params as string[];
        const r = store.contenttranslations?.[[tablename, rowid, field, subkey, language].join("|")];
        return [[{ n: r && r.organisationid === organisationid && r.sourcehash === sourcehash && r.text === text ? 1 : 0 }] as unknown as Json, undefined];
      }
      const ins = /^INSERT INTO `(\w+)` \((.*?)\) VALUES .* ON DUPLICATE KEY UPDATE (.*)$/.exec(sql);
      if (ins) {
        const [, table, colList, updList] = ins;
        if (opts.failOnTable === table) throw new Error("boom");
        const cols = colList.split(", ").map((c) => c.replace(/`/g, ""));
        const upd = [...updList.matchAll(/`(\w+)` = VALUES/g)].map((m) => m[1]);
        const row: Json = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
        const rows = (store[table] ??= {});
        const old = rows[row[cols[0]]];
        if (!old) {
          rows[row[cols[0]]] = row;
          return [{ affectedRows: 1 }, undefined];
        }
        let changed = false;
        for (const c of upd) if (old[c] !== row[c]) { old[c] = row[c]; changed = true; }
        return [{ affectedRows: changed ? 2 : 0 }, undefined];
      }
      const upd = /^UPDATE `(\w+)` SET (.*) WHERE `(\w+)` IN \((.*)\)$/.exec(sql);
      if (upd) {
        const [, table, setList, pk] = upd;
        const sets = [...setList.matchAll(/`(\w+)` = \?/g)].map((m) => m[1]);
        const ids = params.slice(sets.length) as string[];
        let n = 0;
        for (const id of ids) {
          const row = store[table]?.[id];
          if (!row || opts.ignoreUpdates) continue;
          let changed = false;
          sets.forEach((c, i) => { if (row[c] !== params[i]) { row[c] = params[i]; changed = true; } });
          if (changed) n += 1;
        }
        void pk;
        return [{ affectedRows: n }, undefined];
      }
      const cnt = /^SELECT COUNT\(\*\) AS n FROM `(\w+)` WHERE `(\w+)` IN \((.*?)\)((?: AND `\w+` = \?)*)$/.exec(sql);
      if (cnt) {
        const [, table, , marks, conds] = cnt;
        const ids = params.slice(0, marks.split(",").length) as string[];
        const cols = [...conds.matchAll(/`(\w+)` = \?/g)].map((m) => m[1]);
        const vals = params.slice(ids.length);
        const n = ids.filter((id) => { const r = store[table]?.[id]; return r && cols.every((c, i) => r[c] === vals[i]); }).length;
        return [[{ n }] as unknown as Json, undefined];
      }
      throw new Error(`unexpected statement: ${sql}`);
    }),
  };
  return { conn, get store() { return store; }, log };
};

/** What the seed's own placeholder pass leaves behind for the rows the plan updates in place. */
const placeholderRows = (store: Store) => {
  const put = (table: string, row: Json) => ((store[table] ??= {})[row[Object.keys(row)[0]]] = row);
  const s = slotsOf(ID);
  put("organisations", { organisationid: ORG, contentlanguage: null });
  put("curriculums", { curriculumid: ID.curriculum, curriculumname: "placeholder", curriculumdescription: "DCRS curriculum", curriculumstatus: 1, isdeleted: 0 });
  put("grades", { gradeid: ID.grade, gradename: "Cohort II", gradedescription: "DCRS grade", gradestatus: 1, isdeleted: 0, points: 100 });
  // the seed's own placeholder level: switched on, 100 points, a level quiz of 20
  put("levels", { levelid: ID.level, gradeid: ID.grade, levelname: "placeholder", levelstatus: 1, isdeleted: 0, points: 100, quiz_points: 20 });
  for (const l of s.lessons) {
    put("lessons", { lessonid: l.id, lessonname: "placeholder", lessonorder: l.n, lessonstatus: 1, isdeleted: 0, total_points: 100 });
    put("documents", { documentid: l.doc, documentname: "old.mp4", documents3meta: "{}", isdeleted: 0 });
    put("lessonlearnings", { lessonlearningid: l.learning, lessonlearningname: "placeholder", lessonlearningstatus: 1 });
    put("lessonpractices", { lessonpracticeid: l.practice, lessonpracticename: "placeholder", lessonpracticestatus: 1 });
    put("lessonquizzes", { lessonquizid: l.quiz, lessonquizname: "placeholder", lessonquizstatus: 1 });
  }
  for (const id of s.questions) put("questions", { questionid: id, questiontext: "placeholder", isdeleted: 0, questionstatus: 1 });
  for (const id of [ID.pqLesson1, ID.pqLesson2, ID.pqLesson3, ID.pqLesson4]) put("lessonpracticequestions", { lessonpracticequestionid: id, lessonpracticequestionstatus: 1 });
  for (const id of [ID.qqLesson1, ID.qqLesson2Q2, ID.qqLesson2Q3, ID.qqLesson3Q4, ID.qqLesson3Q5, ID.qqLesson3Q6, ID.qqLesson4]) put("lessonquizquestions", { lessonquizquestionid: id, lessonquizquestionstatus: 1 });
};

describe("applying a plan", () => {
  it("counts inserted, updated and hidden rows per table, and a second run changes nothing", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    const first = await applyPlan(fake.conn, plan());
    expect(first.tables.organisations).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(first.tables.grades).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(fake.store.grades[ID.grade]).toMatchObject({ gradename: "en programme", gradedescription: "" });
    expect(fake.store.curriculums[ID.curriculum]).toMatchObject({ curriculumname: "en programme", curriculumdescription: "" });
    expect(fake.store.levels[ID.level]).toMatchObject({ levelname: "en module", levelstatus: 1 });
    expect(first.tables.contenttranslations).toEqual({ inserted: 30, updated: 0, unchanged: 0, hidden: 0 });
    expect(fake.store.organisations[ORG].contentlanguage).toBe("en");
    expect(first.tables.lessons).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 3 });
    expect(first.tables.questions).toEqual({ inserted: 0, updated: 4, unchanged: 0, hidden: 3 });
    // one join row was already there for lesson 1 and one is new; the three that exist for the hidden lessons are hidden
    // (the join-row slots that were never created are not rows, so they are not counted)
    expect(first.tables.lessonpracticequestions).toEqual({ inserted: 1, updated: 1, unchanged: 0, hidden: 3 });
    expect(first.tables.lessonquizquestions).toEqual({ inserted: 1, updated: 1, unchanged: 0, hidden: 6 });
    expect(first.tables.documents).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 3 });
    expect(fake.store.documents[ID.doc1].documentname).toBe("dcrs-m1-l1.mp4");
    expect(fake.store.lessons[ID.lesson3].isdeleted).toBe(1);
    expect(fake.store.questions[ID.q7].isdeleted).toBe(1);
    expect(fake.log[0]).toBe("begin");
    expect(fake.log[fake.log.length - 1]).toBe("commit");
    expect(fake.log.filter((l: string) => l === "rollback")).toEqual([]);

    const second = await applyPlan(fake.conn, plan());
    for (const c of Object.values(second.tables) as Json[]) expect(c).toMatchObject({ inserted: 0, updated: 0, hidden: 0 });
    expect(second.tables.contenttranslations).toEqual({ inserted: 0, updated: 0, unchanged: 30, hidden: 0 });
    expect(second.tables.organisations).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(formatReport(second)).toMatch(/^ {2}table +inserted updated unchanged hidden\n/);
  });

  it("writes the programme into the curriculum and the grade, a second run changes nothing, and an edited Khmer programme updates both rows and keeps their ids", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    const key = `grades|${ID.grade}|gradename||km`;
    const ckey = `curriculums|${ID.curriculum}|curriculumname||km`;
    const first = await applyPlan(fake.conn, plan(sample({ programme: bi("programme") })));
    expect(fake.store.grades[ID.grade]).toMatchObject({ gradename: "en programme", gradedescription: "" });
    expect(fake.store.curriculums[ID.curriculum]).toMatchObject({ curriculumname: "en programme", curriculumdescription: "" });
    expect(fake.store.contenttranslations[key]).toMatchObject({ text: km("programme"), sourcehash: sourceHash("en programme") });
    expect(fake.store.contenttranslations[ckey]).toMatchObject({ text: km("programme"), sourcehash: sourceHash("en programme") });
    expect(first.tables.contenttranslations).toEqual({ inserted: 30, updated: 0, unchanged: 0, hidden: 0 });
    const id = fake.store.contenttranslations[key].translationid;
    const cid = fake.store.contenttranslations[ckey].translationid;

    const second = await applyPlan(fake.conn, plan(sample({ programme: bi("programme") })));
    for (const c of Object.values(second.tables) as Json[]) expect(c).toMatchObject({ inserted: 0, updated: 0, hidden: 0 });
    expect(second.tables.contenttranslations).toEqual({ inserted: 0, updated: 0, unchanged: 30, hidden: 0 });

    const edited = await applyPlan(fake.conn, plan(sample({ programme: { en: "en programme", km: km("programme edited") } }), new Date("2026-11-01T00:00:00.000Z")));
    expect(edited.tables.contenttranslations).toEqual({ inserted: 0, updated: 2, unchanged: 28, hidden: 0 });
    expect(fake.store.contenttranslations[key]).toMatchObject({ translationid: id, text: km("programme edited"), lastupdated: "2026-11-01 00:00:00.000" });
    expect(fake.store.contenttranslations[ckey]).toMatchObject({ translationid: cid, text: km("programme edited") });
  });

  it("is reversible: naming the hidden lesson again makes it live", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    await applyPlan(fake.conn, plan());
    const c = sample();
    c.lessons.push({ id: ID.lesson2, order: 2, name: bi("two"), video: { ref: "R2", filename: "dcrs-m1-l2.mp4" }, practice: [], quiz: [] });
    await applyPlan(fake.conn, plan(c));
    expect(fake.store.lessons[ID.lesson2]).toMatchObject({ isdeleted: 0, lessonstatus: 1, lessonname: "en two" });
    expect(fake.store.documents[ID.doc2].isdeleted).toBe(0);
  });

  it("a second run with a changed Khmer text updates that row, keeps its id and moves its date; the rest stay as they were", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    await applyPlan(fake.conn, plan());
    const key = `lessons|${ID.lesson1}|lessonname||km`;
    const before = { ...fake.store.contenttranslations[key] };
    const snapshot = JSON.stringify(fake.store.contenttranslations);
    const changed = sample();
    changed.lessons[0].name.km = km("edited lesson");
    const later = new Date("2026-11-01T00:00:00.000Z");
    const run = await applyPlan(fake.conn, plan(changed, later));
    // the lesson's name, and the learning item, practice and quiz that carry it
    expect(run.tables.contenttranslations).toEqual({ inserted: 0, updated: 4, unchanged: 26, hidden: 0 });
    const after = fake.store.contenttranslations[key];
    expect(after).toMatchObject({ translationid: before.translationid, text: km("edited lesson"), sourcehash: before.sourcehash, lastupdated: "2026-11-01 00:00:00.000" });
    expect(before.lastupdated).toBe("2026-10-28 09:30:15.123");
    const others = JSON.parse(snapshot);
    const now = { ...fake.store.contenttranslations };
    for (const k of Object.keys(now).filter((x) => /^lesson(s|learnings|practices|quizzes)\|/.test(x))) {
      delete now[k];
      delete others[k];
    }
    expect(Object.keys(now)).toHaveLength(26);
    expect(now).toEqual(others);
  });

  it("an English edit gives the row a new hash and a later date, and a row an admin saved keeps its own id", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    const adminId = "11111111-1111-4111-8111-111111111111";
    fake.store.contenttranslations = {
      [`lessons|${ID.lesson1}|lessonname||km`]: { translationid: adminId, organisationid: ORG, tablename: "lessons", rowid: ID.lesson1, field: "lessonname", subkey: "", language: "km", text: "x", sourcehash: "0".repeat(64), lastupdated: "2020-01-01 00:00:00.000" },
    };
    await applyPlan(fake.conn, plan());
    expect(fake.store.contenttranslations[`lessons|${ID.lesson1}|lessonname||km`]).toMatchObject({ translationid: adminId, text: km("lesson"), sourcehash: sourceHash("en lesson") });
    const edited = sample();
    edited.lessons[0].name.en = "en lesson, reworded";
    const run = await applyPlan(fake.conn, plan(edited, new Date("2026-11-02T00:00:00Z")));
    // the lesson name, the learning item, practice and quiz names that carry it
    expect(run.tables.contenttranslations.updated).toBe(4);
    expect(fake.store.contenttranslations[`lessons|${ID.lesson1}|lessonname||km`].sourcehash).toBe(sourceHash("en lesson, reworded"));
  });

  it("refuses an organisation with another content language, writing nothing", async () => {
    for (const language of ["km", "fr", "KM"]) {
      const fake = fakeConn();
      placeholderRows(fake.store);
      fake.store.organisations[ORG].contentlanguage = language;
      const before = JSON.stringify(fake.store);
      await expect(preflight(fake.conn, plan())).rejects.toThrow(ContentRefused);
      await expect(applyPlan(fake.conn, plan())).rejects.toThrow(/content language is "/);
      expect(JSON.stringify(fake.store)).toBe(before);
      expect(fake.log).toContain("rollback");
    }
    // an organisation already on en (any case) is accepted and left as it is
    const fake = fakeConn();
    placeholderRows(fake.store);
    fake.store.organisations[ORG].contentlanguage = "EN";
    await expect(preflight(fake.conn, plan())).resolves.toBeUndefined();
    await applyPlan(fake.conn, plan());
    expect(fake.store.organisations[ORG].contentlanguage).toBe("EN");
  });

  it("the preflight also refuses a database without the translations migration, and seed rows another organisation owns", async () => {
    const noTable = fakeConn({ noTranslationsTable: true });
    placeholderRows(noTable.store);
    await expect(preflight(noTable.conn, plan())).rejects.toThrow(/run the migrations first/);
    const foreign = fakeConn();
    placeholderRows(foreign.store);
    foreign.store.questions[ID.q2].organisationid = "a0000000-0000-4000-8000-0000000000bb";
    await expect(preflight(foreign.conn, plan())).rejects.toThrow(/1 questions row\(s\) of this seed belong to another organisation/);
    foreign.store.questions[ID.q2].organisationid = ORG;
    foreign.store.curriculums[ID.curriculum].organisationid = null;
    await expect(preflight(foreign.conn, plan())).resolves.toBeUndefined();
  });

  it("rolls the whole run back when a statement fails", async () => {
    const fake = fakeConn({ failOnTable: "questions" });
    placeholderRows(fake.store);
    const before = JSON.stringify(fake.store);
    await expect(applyPlan(fake.conn, plan())).rejects.toThrow("boom");
    expect(JSON.stringify(fake.store)).toBe(before);
    expect(fake.log.filter((l: string) => l === "begin" || l === "commit" || l === "rollback")).toEqual(["begin", "rollback"]);
    // a failing translation write rolls back the organisation's language and every row before it too
    const late = fakeConn({ failOnTable: "contenttranslations" });
    placeholderRows(late.store);
    const untouched = JSON.stringify(late.store);
    await expect(applyPlan(late.conn, plan())).rejects.toThrow("boom");
    expect(JSON.stringify(late.store)).toBe(untouched);
    expect(late.store.organisations[ORG].contentlanguage).toBeNull();
  });

  it("refuses to report success when a translation is not there as the plan wrote it, and rolls back", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    const realExecute = fake.conn.execute.getMockImplementation() as (sql: string, params: unknown[]) => Promise<[Json, undefined]>;
    // a store that silently kept an older text (as a unique key held by another row would)
    fake.conn.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      const result = await realExecute(sql, params);
      if (/^INSERT INTO `contenttranslations`/.test(sql) && params[2] === "curriculums") fake.store.contenttranslations[`curriculums|${ID.curriculum}|curriculumname||km`].text = "older";
      return result;
    });
    await expect(applyPlan(fake.conn, plan())).rejects.toThrow(/content check failed: the km translation of curriculums\.curriculumname is not there as the plan wrote it/);
    expect(fake.log[fake.log.length - 1]).toBe("rollback");
  });

  it("refuses to report success when a hide did not take, and rolls back", async () => {
    const fake = fakeConn({ ignoreUpdates: true });
    placeholderRows(fake.store);
    await expect(applyPlan(fake.conn, plan())).rejects.toThrow(/content check failed/);
    expect(fake.log[fake.log.length - 1]).toBe("rollback");
  });
});

/** The plan the seed makes: the database is read first (`readExisting`), so the level's switch and the points follow what is there. */
const planned = async (fake: Json, content: Json, opts: Json = {}, now: Date = NOW): Promise<Json> =>
  planContent(content, ID, { organisationid: ORG, now, ...opts, existing: await readExisting(fake.conn, content, ID) });

describe("applying a module after the first", () => {
  /** A stand-in database that already holds Module 1 (switched on), written by the plan the seed makes. */
  const withModule1 = async (opts: Parameters<typeof fakeConn>[0] = {}) => {
    const fake = fakeConn(opts);
    placeholderRows(fake.store);
    await applyPlan(fake.conn, await planned(fake, sample(), { levelSwitch: "live" }));
    return fake;
  };
  /** Every row whose key is one of Module 1's ids, as the store holds it, for before/after comparisons. */
  const module1Rows = (store: Store): string => {
    const m1 = module1Ids();
    const out: Record<string, Json> = {};
    for (const [table, rows] of Object.entries(store)) {
      if (table === "contenttranslations") {
        for (const [k, row] of Object.entries(rows)) if (m1.has(row.rowid)) out[`${table}|${k}`] = row;
      } else {
        // the grade's points are the programme's total over its live levels, so a run of another module moves them (asserted where it matters)
        for (const [id, row] of Object.entries(rows)) if (m1.has(id)) out[`${table}|${id}`] = table === "grades" ? { ...row, points: "<total>" } : row;
      }
    }
    return JSON.stringify(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const zero = (r: Json) => {
    for (const c of Object.values(r.tables) as Json[]) expect(c).toMatchObject({ inserted: 0, updated: 0, hidden: 0 });
  };

  it("Module 1 run again over a database it already wrote (the curriculum already carries the programme name) changes nothing, and leaves the curriculum alone", async () => {
    const fake = await withModule1();
    expect(fake.store.curriculums[ID.curriculum].curriculumname).toBe("en programme");
    const before = JSON.stringify(fake.store);
    const again = await applyPlan(fake.conn, await planned(fake, sample(), {}, new Date("2031-01-01T00:00:00Z")));
    zero(again);
    expect(again.tables.curriculums).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(again.tables.grades).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(again.tables.levels).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(JSON.stringify(fake.store)).toBe(before);
  });

  it("Module 1 does not rename the curriculum from its module title: a database whose curriculum is called the programme keeps that name", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    // the state UAT is in: the curriculum was renamed to the programme by hand, its km row copied from the grade's
    fake.store.curriculums[ID.curriculum].curriculumname = "en programme";
    const key = `curriculums|${ID.curriculum}|curriculumname||km`;
    const handMade = { translationid: "22222222-2222-4222-8222-222222222222", organisationid: ORG, tablename: "curriculums", rowid: ID.curriculum, field: "curriculumname", subkey: "", language: "km", text: km("programme"), sourcehash: sourceHash("en programme"), lastupdated: "2026-10-29 08:00:00.000" };
    fake.store.contenttranslations = { [key]: { ...handMade } };
    const run = await applyPlan(fake.conn, await planned(fake, sample(), {}));
    expect(fake.store.curriculums[ID.curriculum].curriculumname).toBe("en programme");
    expect(fake.store.levels[ID.level].levelname).toBe("en module");
    // the hand-made curriculum row is left exactly as it was: same id, same date
    expect(fake.store.contenttranslations[key]).toEqual(handMade);
    expect(run.tables.curriculums.updated).toBe(1); // only its description is blanked, not its name
    expect(run.tables.contenttranslations.inserted).toBe(29);
  });

  it("writes Module 2 as a new level with its lessons and questions, and leaves every row of Module 1 exactly as it was (but the grade's points)", async () => {
    const fake = await withModule1();
    const before = module1Rows(fake.store);
    expect(before.length).toBeGreaterThan(1000);
    const p = await planned(fake, laterSample(2), { levelSwitch: "live" });
    await expect(preflight(fake.conn, p)).resolves.toBeUndefined();
    const run = await applyPlan(fake.conn, p);
    const level = fake.store.levels[moduleId(2, "level")];
    expect(level).toMatchObject({ levelid: moduleId(2, "level"), gradeid: ID.grade, levelname: "en module 2", levelorder: 2, levelstatus: 1, points: 200 });
    expect(Object.keys(fake.store.levels).sort()).toEqual([ID.level, moduleId(2, "level")].sort());
    expect(Object.keys(fake.store.lessons).filter((id) => !module1Ids().has(id)).sort()).toEqual([moduleId(2, "lesson", 1), moduleId(2, "lesson", 2)].sort());
    expect(fake.store.lessons[moduleId(2, "lesson", 1)]).toMatchObject({ levelid: moduleId(2, "level"), lessonname: "en later one", isdeleted: 0 });
    expect(run.tables.levels).toEqual({ inserted: 1, updated: 0, unchanged: 0, hidden: 0 });
    expect(run.tables.lessons.inserted).toBe(2);
    expect(run.tables.questions.inserted).toBe(4);
    // the programme's rows are the same text, so only the grade's points move (Module 1's 100 plus Module 2's 200); nothing of Module 1 is hidden or changed
    expect(run.tables.curriculums).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(run.tables.grades).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(fake.store.grades[ID.grade].points).toBe(300);
    expect(module1Rows(fake.store)).toBe(before);
    expect(fake.store.lessons[ID.lesson1].isdeleted).toBe(0);
    expect(fake.store.lessons[ID.lesson2].isdeleted).toBe(1); // hidden by Module 1's own run, as before, and not touched now
  });

  it("Module 2 run again changes nothing", async () => {
    const fake = await withModule1();
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    const before = JSON.stringify(fake.store);
    const again = await applyPlan(fake.conn, await planned(fake, laterSample(2), {}, new Date("2031-01-01T00:00:00Z")));
    zero(again);
    expect(again.tables.contenttranslations.unchanged).toBe(translations(plan(laterSample(2))).length);
    expect(JSON.stringify(fake.store)).toBe(before);
    expect(fake.log.filter((l: string) => l === "rollback")).toEqual([]);
    // and again with the switch named: the same as it is
    const named = await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    zero(named);
    expect(JSON.stringify(fake.store)).toBe(before);
  });

  it("--draft writes the level switched off, and --live switches the module on, changing the level row and the grade's points and nothing else", async () => {
    const fake = await withModule1();
    const before = module1Rows(fake.store);
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "draft" }));
    expect(fake.store.levels[moduleId(2, "level")]).toMatchObject({ levelstatus: 0, levelorder: 2, points: 200 });
    expect(fake.store.levels[ID.level].levelstatus).toBe(1);
    expect(fake.store.curriculums[ID.curriculum].curriculumstatus).toBe(1);
    // a draft module does not move the grade's points: learners' progress is out of the live modules only
    expect(fake.store.grades[ID.grade].points).toBe(100);
    const again = await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "draft" }));
    zero(again);
    // a run with no flag leaves it where it is
    const kept = await applyPlan(fake.conn, await planned(fake, laterSample(2), {}));
    zero(kept);
    expect(fake.store.levels[moduleId(2, "level")].levelstatus).toBe(0);
    const on = await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    expect(fake.store.levels[moduleId(2, "level")].levelstatus).toBe(1);
    expect(fake.store.grades[ID.grade].points).toBe(300);
    expect(on.tables.levels).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(on.tables.grades).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    for (const [table, c] of Object.entries(on.tables) as [string, Json][]) if (table !== "levels" && table !== "grades") expect(c).toMatchObject({ inserted: 0, updated: 0, hidden: 0 });
    expect(module1Rows(fake.store)).toBe(before);
    // and back to a draft: the grade's points fall by the module's again
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "draft" }));
    expect(fake.store.levels[moduleId(2, "level")].levelstatus).toBe(0);
    expect(fake.store.grades[ID.grade].points).toBe(100);
  });

  it("a draft module leaves a curriculum that is switched off switched off: it only renames", async () => {
    const fake = await withModule1();
    fake.store.curriculums[ID.curriculum].curriculumstatus = 0;
    fake.store.curriculums[ID.curriculum].isdeleted = 1;
    fake.store.curriculums[ID.curriculum].curriculumdescription = "kept";
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "draft" }));
    expect(fake.store.curriculums[ID.curriculum]).toMatchObject({ curriculumstatus: 0, isdeleted: 1, curriculumdescription: "kept", curriculumname: "en programme" });
  });

  it("a Module 2 file with a lesson dropped hides only that Module 2 lesson, and it comes back when named again", async () => {
    const fake = await withModule1();
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    const before = module1Rows(fake.store);
    const c = laterSample(2);
    c.lessons.pop();
    const run = await applyPlan(fake.conn, await planned(fake, c, {}));
    expect(run.tables.lessons.hidden).toBe(1);
    expect(run.tables.documents.hidden).toBe(1);
    expect(run.tables.questions.hidden).toBe(1);
    expect(fake.store.lessons[moduleId(2, "lesson", 2)].isdeleted).toBe(1);
    expect(fake.store.lessons[moduleId(2, "lesson", 1)].isdeleted).toBe(0);
    expect(fake.store.questions[moduleId(2, "q", "practice", 2, 1)].isdeleted).toBe(1);
    expect(fake.store.questions[moduleId(2, "q", "practice", 1, 1)].isdeleted).toBe(0);
    // the hidden lesson no longer counts in the level's points (one lesson of 100 and the quiz of 20), nor in the grade's
    expect(fake.store.levels[moduleId(2, "level")].points).toBe(100);
    expect(fake.store.grades[ID.grade].points).toBe(200);
    expect(module1Rows(fake.store)).toBe(before);
    await applyPlan(fake.conn, await planned(fake, laterSample(2), {}));
    expect(fake.store.lessons[moduleId(2, "lesson", 2)].isdeleted).toBe(0);
    expect(fake.store.questions[moduleId(2, "q", "practice", 2, 1)].isdeleted).toBe(0);
    expect(fake.store.levels[moduleId(2, "level")].points).toBe(200);
    expect(fake.store.grades[ID.grade].points).toBe(300);
  });

  it("a Module 1 file run after Module 2 hides only Module 1's lessons: Module 2's stay", async () => {
    const fake = await withModule1();
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    const m2 = JSON.stringify(Object.fromEntries(Object.entries(fake.store.lessons).filter(([id]) => !module1Ids().has(id))));
    const c = sample();
    c.lessons[0].practice = [];
    await applyPlan(fake.conn, await planned(fake, c, {}));
    expect(JSON.stringify(Object.fromEntries(Object.entries(fake.store.lessons).filter(([id]) => !module1Ids().has(id))))).toBe(m2);
    expect(fake.store.questions[moduleId(2, "q", "practice", 1, 1)].isdeleted).toBe(0);
    expect(fake.store.questions[ID.q3].isdeleted).toBe(1); // Module 1's own question that file no longer uses
  });

  it("a Module 2 file with another programme name renames the curriculum and the grade, and nothing else of Module 1 changes", async () => {
    const fake = await withModule1();
    const before = JSON.parse(module1Rows(fake.store)) as [string, Json][];
    const run = await applyPlan(fake.conn, await planned(fake, laterSample(2, { programme: bi("corrected programme") }), { levelSwitch: "draft" }, new Date("2026-11-03T00:00:00Z")));
    expect(fake.store.curriculums[ID.curriculum].curriculumname).toBe("en corrected programme");
    expect(fake.store.grades[ID.grade].gradename).toBe("en corrected programme");
    expect(run.tables.curriculums).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(run.tables.grades).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(fake.store.contenttranslations[`curriculums|${ID.curriculum}|curriculumname||km`]).toMatchObject({
      text: km("corrected programme"),
      sourcehash: sourceHash("en corrected programme"),
      lastupdated: "2026-11-03 00:00:00.000",
    });
    const after = JSON.parse(module1Rows(fake.store)) as [string, Json][];
    const changed = after.filter(([k, v], i) => JSON.stringify(v) !== JSON.stringify(before[i][1])).map(([k]) => k.split("|").slice(0, 2).join("|"));
    expect(changed.sort()).toEqual([`contenttranslations|curriculums`, `contenttranslations|grades`, `curriculums|${ID.curriculum}`, `grades|${ID.grade}`].sort());
    expect(fake.store.grades[ID.grade].points).toBe(100); // a draft Module 2 adds nothing to the grade
  });

  it("is refused when the database has no curriculum or no grade to attach to, naming which, and writes nothing", async () => {
    const bare = fakeConn();
    placeholderRows(bare.store);
    delete bare.store.curriculums;
    delete bare.store.grades;
    const refusalOf = async (conn: Json, content: Json): Promise<string[]> => {
      try {
        await preflight(conn, content);
      } catch (e) {
        expect(e).toBeInstanceOf(ContentRefused);
        return (e as { problems: string[] }).problems;
      }
      throw new Error("expected the preflight to refuse");
    };
    const before = JSON.stringify(bare.store);
    expect(await refusalOf(bare.conn, plan(laterSample(2)))).toEqual([
      "this file is module 2, which attaches to the programme's existing curriculum and grade, and this database has no such row; seed Module 1 first",
    ]);
    // the grade alone missing, the curriculum alone missing
    const noGrade = fakeConn();
    placeholderRows(noGrade.store);
    delete noGrade.store.grades;
    expect(await refusalOf(noGrade.conn, plan(laterSample(3)))).toEqual([
      "this file is module 3, which attaches to the programme's existing grade, and this database has no such row; seed Module 1 first",
    ]);
    const noCurriculum = fakeConn();
    placeholderRows(noCurriculum.store);
    delete noCurriculum.store.curriculums;
    expect(await refusalOf(noCurriculum.conn, plan(laterSample(2)))).toEqual([
      "this file is module 2, which attaches to the programme's existing curriculum, and this database has no such row; seed Module 1 first",
    ]);
    expect(JSON.stringify(bare.store)).toBe(before);
    // Module 1 creates them, so the same database is fine for it
    await expect(preflight(bare.conn, plan())).resolves.toBeUndefined();
    // and a database that has them is fine for Module 2
    const ok = fakeConn();
    placeholderRows(ok.store);
    await expect(preflight(ok.conn, plan(laterSample(2)))).resolves.toBeUndefined();
  });

  it("says by length only what a run does to the curriculum's name", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    fake.store.curriculums[ID.curriculum].curriculumname = "old name";
    const renamed = await curriculumNameLengths(fake.conn, plan());
    expect(renamed).toEqual({ before: 8, after: "en programme".length, same: false });
    expect(formatCurriculumName(renamed)).toBe(`  curriculum name: renamed, 8 characters before, ${"en programme".length} after`);
    fake.store.curriculums[ID.curriculum].curriculumname = "en programme";
    expect(formatCurriculumName(await curriculumNameLengths(fake.conn, plan()))).toBe(`  curriculum name: unchanged, ${"en programme".length} characters`);
    delete fake.store.curriculums;
    expect(formatCurriculumName(await curriculumNameLengths(fake.conn, plan()))).toBe(`  curriculum name: new, ${"en programme".length} characters`);
    // a Khmer-length name is counted in characters, and the text itself is never in the line
    fake.store.curriculums = { [ID.curriculum]: { curriculumid: ID.curriculum, curriculumname: km("programme") } };
    const line = formatCurriculumName(await curriculumNameLengths(fake.conn, plan()));
    expect(line).not.toMatch(/en programme|\u1780/);
    expect(line).toContain(`${[...km("programme")].length} characters before`);
  });

  it("rolls the whole Module 2 run back when a statement fails, Module 1 untouched", async () => {
    const opts: Json = {};
    const fake = await withModule1(opts);
    opts.failOnTable = "lessonquizquestions"; // Module 1 is in; the failure starts now
    const before = JSON.stringify(fake.store);
    await expect(applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }))).rejects.toThrow("boom");
    expect(JSON.stringify(fake.store)).toBe(before);
  });

  it("Module 1 run over a database in the shape UAT is in (the level at 100 points with quiz_points 20 and no level-quiz row, the grade at 100) writes no points at all", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    // the readiness programme as UAT holds it: Module 1 written by the earlier importer (one lesson, the level and the grade at 100 points, a quiz_points of 20, no level-quiz row), switched on
    await applyPlan(fake.conn, plan());
    expect(fake.store.levels[ID.level]).toMatchObject({ points: 100, quiz_points: 20, levelstatus: 1 });
    expect(fake.store.grades[ID.grade].points).toBe(100);
    expect(fake.store.levelquizquestions).toBeUndefined();
    const before = JSON.stringify(fake.store);
    const run = await applyPlan(fake.conn, await planned(fake, sample(), {}, new Date("2031-01-01T00:00:00Z")));
    zero(run);
    expect(run.tables.levels).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(run.tables.grades).toEqual({ inserted: 0, updated: 0, unchanged: 1, hidden: 0 });
    expect(JSON.stringify(fake.store)).toBe(before);
    // and with the switch named
    zero(await applyPlan(fake.conn, await planned(fake, sample(), { levelSwitch: "live" })));
    expect(JSON.stringify(fake.store)).toBe(before);
  });

  it("an active level-quiz row puts quiz_points into the level's points on the next run (and the grade's), an inactive one does not, and removing it takes them out", async () => {
    const fake = await withModule1();
    const put = (status: number) => ((fake.store.levelquizquestions ??= {})["lq-1"] = { levelquizquestionid: "lq-1", levelid: ID.level, questionid: "q", levelquizquestionstatus: status });
    put(0);
    zero(await applyPlan(fake.conn, await planned(fake, sample(), {})));
    expect(fake.store.levels[ID.level].points).toBe(100);
    put(1);
    const run = await applyPlan(fake.conn, await planned(fake, sample(), {}));
    expect(run.tables.levels).toEqual({ inserted: 0, updated: 1, unchanged: 0, hidden: 0 });
    expect(fake.store.levels[ID.level]).toMatchObject({ points: 120, quiz_points: 20 });
    expect(fake.store.grades[ID.grade].points).toBe(120);
    // a Module 2 run takes Module 1's stored 120 into the grade
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    expect(fake.store.grades[ID.grade].points).toBe(120 + 200);
    delete fake.store.levelquizquestions["lq-1"];
    await applyPlan(fake.conn, await planned(fake, sample(), {}));
    expect(fake.store.levels[ID.level].points).toBe(100);
  });

  it("the seed's order refuses a new Module 2 level without --draft or --live, before anything is written, and a Module 2 file naming a switch is written", async () => {
    const fake = await withModule1();
    const before = JSON.stringify(fake.store);
    await expect(planned(fake, laterSample(2), {})).rejects.toThrow(/module 2's level is not in the database yet/);
    expect(JSON.stringify(fake.store)).toBe(before);
    await expect(planned(fake, sample(), { levelSwitch: "draft" })).rejects.toThrow(/--draft is refused for module 1/);
    await expect(applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "draft" }))).resolves.toBeDefined();
  });

  it("a Module 2 lesson slot that would take another name is refused against the database, and --rename-lessons renames it and its Khmer text", async () => {
    const fake = await withModule1();
    await applyPlan(fake.conn, await planned(fake, laterSample(2), { levelSwitch: "live" }));
    const renamed = laterSample(2);
    renamed.lessons[0].name = bi("a different lesson");
    const before = JSON.stringify(fake.store);
    await expect(planned(fake, renamed, {})).rejects.toThrow(/module 2, lesson slot 1: the lesson there now \(hidden or not\) has another English name/);
    expect(JSON.stringify(fake.store)).toBe(before);
    // an unchanged file passes
    zero(await applyPlan(fake.conn, await planned(fake, laterSample(2), {})));
    // hiding the old lesson (dropping it from the file) does not free its slot: a different lesson cannot revive the row, with its ids and its learners' progress
    const dropped = laterSample(2);
    dropped.lessons.shift();
    await applyPlan(fake.conn, await planned(fake, dropped, {}));
    expect(fake.store.lessons[moduleId(2, "lesson", 1)].isdeleted).toBe(1);
    const hiddenRow = JSON.stringify(fake.store.lessons[moduleId(2, "lesson", 1)]);
    const afterHide = JSON.stringify(fake.store);
    await expect(planned(fake, renamed, {})).rejects.toThrow(/module 2, lesson slot 1: the lesson there now \(hidden or not\) has another English name.*give the new lesson a new order \(--rename-lessons renames it in place\)$/);
    expect(JSON.stringify(fake.store)).toBe(afterHide);
    expect(JSON.stringify(fake.store.lessons[moduleId(2, "lesson", 1)])).toBe(hiddenRow);
    // the old lesson named again by its own name comes back
    await applyPlan(fake.conn, await planned(fake, laterSample(2), {}));
    expect(fake.store.lessons[moduleId(2, "lesson", 1)]).toMatchObject({ lessonname: "en later one", isdeleted: 0 });
    // and with the flag, a live slot is renamed in place
    const again = laterSample(2);
    again.lessons[0].name = bi("a third lesson");
    await expect(planned(fake, again, {})).rejects.toThrow(/lesson slot 1/);
    await applyPlan(fake.conn, await planned(fake, again, { renameLessons: true }));
    expect(fake.store.lessons[moduleId(2, "lesson", 1)].lessonname).toBe("en a third lesson");
    expect(fake.store.contenttranslations[`lessons|${moduleId(2, "lesson", 1)}|lessonname||km`]).toMatchObject({ text: km("a third lesson"), sourcehash: sourceHash("en a third lesson") });
  });
});

// ---- the command line ----------------------------------------------------------------------------

describe("the command line", () => {
  const args = (over: Json = {}) => ({ content: null, dryRun: false, draft: false, live: false, renameLessons: false, help: false, ...over });
  it("reads --content, --draft, --live, --rename-lessons and --dry-run, and refuses anything else", () => {
    expect(parseArgs([])).toEqual(args());
    expect(parseArgs(["--content", "/x"])).toEqual(args({ content: "/x" }));
    expect(parseArgs(["--content", "/x", "--dry-run"])).toEqual(args({ content: "/x", dryRun: true }));
    expect(parseArgs(["--content", "/x", "--draft"])).toEqual(args({ content: "/x", draft: true }));
    expect(parseArgs(["--content", "/x", "--live"])).toEqual(args({ content: "/x", live: true }));
    expect(parseArgs(["--live", "--content", "/x", "--rename-lessons"])).toEqual(args({ content: "/x", live: true, renameLessons: true }));
    expect(parseArgs(["--draft", "--content", "/x", "--dry-run"])).toEqual(args({ content: "/x", dryRun: true, draft: true }));
    for (const bad of [["--wat"], ["--content"], ["--content", "--dry-run"], ["--dry-run"], ["--draft"], ["--live"], ["--rename-lessons"], ["--draft", "--dry-run"], ["--live", "--dry-run"]]) {
      expect(() => parseArgs(bad)).toThrow(ContentRefused);
    }
  });

  it("refuses --draft and --live together, with the reason", () => {
    for (const both of [["--content", "/x", "--draft", "--live"], ["--live", "--content", "/x", "--draft"]]) {
      let problems: string[] = [];
      try {
        parseArgs(both);
      } catch (e) {
        problems = (e as { problems: string[] }).problems;
      }
      expect(problems).toEqual(["--draft and --live cannot be used together: a module's level is either switched off or switched on"]);
    }
  });

  it("maps the flags to the plan's level switch", () => {
    expect(levelSwitchOf(args())).toBeNull();
    expect(levelSwitchOf(args({ draft: true }))).toBe("draft");
    expect(levelSwitchOf(args({ live: true }))).toBe("live");
  });

  it("refuses --lang in every form: it is retired", () => {
    for (const bad of [["--lang", "en"], ["--content", "/x", "--lang", "km"], ["--content", "/x", "--lang=both"], ["--content", "/x", "--lang"]]) {
      expect(() => parseArgs(bad)).toThrow(/--lang is retired: the English text is the base text/);
    }
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = exitSpy();
    try {
      expect(() => prepare(["--content", "/x", "--lang", "km"], ID)).toThrow("exit 1");
      expect(err.mock.calls.pop()?.[0]).toMatch(/^Refusing to run: --lang is retired/);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  const withFolder = (files: Record<string, string>, run: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcrs-content-spec-"));
    try {
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
      run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const exitSpy = () => jest.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);

  it("without --content there is no content and nothing to refuse", () => {
    expect(prepare([], ID)).toEqual({ args: args(), content: null });
  });

  it("loads a good folder, and exits 1 with the reasons for a missing file, bad JSON or a refused file", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = exitSpy();
    try {
      withFolder({ "content.json": JSON.stringify(sample()) }, (dir) => {
        expect(prepare(["--content", dir], ID).content).toEqual(sample());
      });
      withFolder({}, (dir) => expect(() => prepare(["--content", dir], ID)).toThrow("exit 1"));
      expect(err.mock.calls.pop()?.[0]).toMatch(/^Refusing to run: cannot read content\.json in the folder \(ENOENT\)\. Nothing was written\.$/);
      withFolder({ "content.json": "{ not json" }, (dir) => expect(() => prepare(["--content", dir], ID)).toThrow("exit 1"));
      expect(err.mock.calls.pop()?.[0]).toMatch(/content\.json is not valid JSON/);
      const bad = sample();
      bad.lessons[0].practice[0].options.forEach((o: Json) => (o.correct = false));
      withFolder({ "content.json": JSON.stringify(bad) }, (dir) => expect(() => prepare(["--content", dir], ID)).toThrow("exit 1"));
      expect(err.mock.calls.pop()?.[0]).toMatch(/lessons\[0\]\.practice\[0\] has 0 correct options/);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("--help prints the help line, which says what --draft and --live do, and exits 0", () => {
    const out: string[] = [];
    const log = jest.spyOn(console, "log").mockImplementation((m: string) => void out.push(m));
    const exit = exitSpy();
    try {
      expect(() => prepare(["--help"], ID)).toThrow("exit 0");
    } finally {
      exit.mockRestore();
      log.mockRestore();
    }
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("usage: seed:dcrs -- --content <dir> [--draft | --live] [--rename-lessons] [--dry-run]");
    expect(out[0]).toContain("--draft writes the module's level switched off, levelstatus 0: built but not shown to learners; --live writes it switched on, levelstatus 1; not both.");
    expect(out[0]).toContain("With neither, a level already in the database keeps its switch and a new level is refused. --draft is refused for module 1.");
    expect(out[0]).toContain("--rename-lessons lets a later module's lesson slot take another name");
    expect(out[0]).toBe(USAGE);
  });

  it("exits 1 with the reason for --draft on a Module 1 file and for --draft with --live, before anything is read from a database", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = exitSpy();
    try {
      withFolder({ "content.json": JSON.stringify(sample()) }, (dir) => expect(() => prepare(["--content", dir, "--draft"], ID)).toThrow("exit 1"));
      expect(err.mock.calls.pop()?.[0]).toMatch(/^Refusing to run: --draft is refused for module 1: it is the delivered module, and a learner already reads it; switch a later module off, not this one\. Nothing was written\.$/);
      withFolder({ "content.json": JSON.stringify(laterSample(2)) }, (dir) => expect(() => prepare(["--content", dir, "--draft", "--live"], ID)).toThrow("exit 1"));
      expect(err.mock.calls.pop()?.[0]).toBe("Refusing to run: --draft and --live cannot be used together: a module's level is either switched off or switched on. Nothing was written.");
      // a later module with either flag is fine
      withFolder({ "content.json": JSON.stringify(laterSample(2)) }, (dir) => {
        expect(prepare(["--content", dir, "--draft"], ID).args).toEqual(args({ content: dir, draft: true }));
        expect(prepare(["--content", dir, "--live"], ID).args).toEqual(args({ content: dir, live: true }));
      });
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("refuses a content.json in the old shape, naming the new shape, before anything is written", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = exitSpy();
    try {
      const old = { programme: bi("programme"), curriculum: { name: bi("m") }, level: { name: bi("m") }, lessons: sample().lessons };
      withFolder({ "content.json": JSON.stringify(old) }, (dir) => expect(() => prepare(["--content", dir], ID)).toThrow("exit 1"));
      expect(err.mock.calls.pop()?.[0]).toBe(`Refusing to run: ${OLD_SHAPE}. Nothing was written.`);
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  });

  it("a dry run of a later module says its level's order, the switch the flags ask for and its points, with ids and counts only", () => {
    const out: string[] = [];
    const log = jest.spyOn(console, "log").mockImplementation((m: string) => void out.push(m));
    try {
      printDryRun(laterSample(3), ID, { levelSwitch: "draft" });
      printDryRun(laterSample(3), ID, { levelSwitch: "live" });
      printDryRun(laterSample(3), ID);
    } finally {
      log.mockRestore();
    }
    const text = out.join("\n");
    expect(text).toContain("module 3: its level is order 3, switched off (levelstatus 0, --draft): built, not shown to learners");
    expect(text).toContain("module 3: its level is order 3, on (levelstatus 1, --live)");
    expect(text).toContain("module 3: its level is order 3, left as it is if it exists (neither --draft nor --live; a new level would be refused)");
    expect(text).toContain("points: the level 200; the grade 200 counting only this level (a real run adds the other live levels)");
    expect(text).toContain("points: the level 200; the grade 0 counting only this level (a real run adds the other live levels)");
    expect(text).toContain("media: copy synthetic.mp4 to <media folder>/dcrs-m3-l1.mp4");
    expect(text).not.toMatch(/en later|\u1780|c0000000/);
  });

  it("a dry run prints table names and counts only, never the content", () => {
    const out: string[] = [];
    const log = jest.spyOn(console, "log").mockImplementation((m: string) => void out.push(m));
    try {
      printDryRun(sample(), ID);
    } finally {
      log.mockRestore();
    }
    const text = out.join("\n");
    expect(text).toMatch(/^DCRS content plan \(dry run, base language en, translations km\): 54 steps, no database used\./);
    expect(text).toContain("translate questions 23");
    expect(text).toContain("translate lessons 1");
    expect(text).toContain("translate grades 1");
    expect(text).toContain("upsert questions 1");
    expect(text).toContain("hide   lessons 3");
    expect(text).toContain("module 1: its level is order 1, left as it is if it exists (neither --draft nor --live; a new level would be refused)");
    expect(text).toContain("media: copy lesson_final.mp4 to <media folder>/dcrs-m1-l1.mp4");
    expect(text).not.toMatch(/en p1|\u1780/);
  });
});
