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
  validateContent,
  planContent,
  statementOf,
  slotsOf,
  sourceHash,
  translationId,
  questionTexts,
  isAnswerBearing,
} = require("../../scripts/lib/dcrs-content-plan");
const { applyPlan, preflight, formatReport } = require("../../scripts/lib/dcrs-content-apply");
const { parseArgs, prepare, printDryRun } = require("../../scripts/lib/dcrs-content-cli");
/* eslint-enable @typescript-eslint/no-var-requires */
import {
  ANSWER_BEARING_FIELDS as CONSTANT_ANSWER_BEARING_FIELDS,
  SUBKEY_MAX_LENGTH,
  TRANSLATABLE_FIELDS,
  sourceHash as constantSourceHash,
} from "../constants/content-translations";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORG = "a0000000-0000-4000-8000-0000000000aa";
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
  curriculum: { name: bi("module") },
  level: { name: bi("module level") },
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

  it("blanks every placeholder description and names the grade after the module title the file gives", () => {
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
    expect(row("grades").values).toMatchObject({ gradeid: ID.grade, curriculumid: ID.curriculum, gradename: "en module", gradestatus: 1, isdeleted: 0 });
    expect(row("grades").update).toEqual(["gradename", "gradedescription", "gradestatus", "isdeleted"]);
    expect(forRow(p, "grades", ID.grade).map((v) => [v.field, v.text])).toEqual([["gradename", km("module")]]);
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
    expect(row("curriculums").curriculumname).toBe("en module");
    expect(row("levels").levelname).toBe("en module level");
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
    expect(refusal({ curriculum: { name: bi("x") }, lessons: [] })).toEqual(["lessons must be a non-empty list"]);
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
  put("grades", { gradeid: ID.grade, gradename: "Cohort II", gradedescription: "DCRS grade", gradestatus: 1, isdeleted: 0 });
  put("levels", { levelid: ID.level, levelname: "placeholder", levelstatus: 1, isdeleted: 0 });
  for (const l of s.lessons) {
    put("lessons", { lessonid: l.id, lessonname: "placeholder", lessonorder: l.n, lessonstatus: 1, isdeleted: 0 });
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
    expect(fake.store.grades[ID.grade]).toMatchObject({ gradename: "en module", gradedescription: "" });
    expect(fake.store.curriculums[ID.curriculum].curriculumdescription).toBe("");
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

// ---- the command line ----------------------------------------------------------------------------

describe("the command line", () => {
  it("reads --content and --dry-run, and refuses anything else", () => {
    expect(parseArgs([])).toEqual({ content: null, dryRun: false });
    expect(parseArgs(["--content", "/x"])).toEqual({ content: "/x", dryRun: false });
    expect(parseArgs(["--content", "/x", "--dry-run"])).toEqual({ content: "/x", dryRun: true });
    for (const bad of [["--wat"], ["--content"], ["--content", "--dry-run"], ["--dry-run"]]) {
      expect(() => parseArgs(bad)).toThrow(ContentRefused);
    }
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
    expect(prepare([], ID)).toEqual({ args: { content: null, dryRun: false }, content: null });
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
    expect(text).toContain("media: copy lesson_final.mp4 to <media folder>/dcrs-m1-l1.mp4");
    expect(text).not.toMatch(/en p1|\u1780/);
  });
});
