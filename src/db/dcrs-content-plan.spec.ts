/**
 * `seed:dcrs -- --content <dir>`: the plan a content.json turns into (a pure function of the
 * file), what is refused, the applier on a stand-in connection, and the command line.
 * The seed itself is run for real against scratch databases (see the change description).
 *
 * Khmer fixtures here are opaque runs of Khmer-block code points (consonants, the subscript
 * sign, vowels), not words: the specs need text that only a Khmer-aware check can tell from
 * ASCII, not text that means anything.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/* eslint-disable @typescript-eslint/no-var-requires */
const { ID } = require("../../scripts/seed-dcrs-content");
const { ContentRefused, LESSON_IDS, validateContent, planContent, statementOf, slotsOf } = require("../../scripts/lib/dcrs-content-plan");
const { applyPlan, formatReport } = require("../../scripts/lib/dcrs-content-apply");
const { parseArgs, prepare, printDryRun } = require("../../scripts/lib/dcrs-content-cli");
/* eslint-enable @typescript-eslint/no-var-requires */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORG = "a0000000-0000-4000-8000-0000000000aa";
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

const plan = (content: Json = sample(), lang?: string) => planContent(content, ID, { lang, organisationid: ORG });
const refusal = (content: unknown): string[] => {
  try {
    validateContent(content, ID);
  } catch (e) {
    expect(e).toBeInstanceOf(ContentRefused);
    return (e as { problems: string[] }).problems;
  }
  throw new Error("expected the content to be refused");
};

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
    expect(p.steps.map((s: Json) => `${s.kind}:${s.table}`)).toEqual([
      "upsert:curriculums",
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
    expect(JSON.parse(q3.values.questionheading)).toEqual({ headingtext: km("q1 stem"), headingfile: null });
    expect(q3.values.questiontext).toBe(km("q1 stem"));
    expect(q3.update).not.toContain("questionid");
    expect(q3.update).not.toContain("organisationid");
  });

  it("learner-facing text is Khmer by default, English with lang=en, Khmer then English with lang=both", () => {
    const name = (p: Json) => p.steps.find((s: Json) => s.table === "lessons").values.lessonname;
    const stem = (p: Json) => p.steps.find((s: Json) => s.table === "questions").values.questiontext;
    expect(name(plan())).toBe(km("lesson"));
    expect(name(plan(sample(), "km"))).toBe(km("lesson"));
    expect(name(plan(sample(), "en"))).toBe("en lesson");
    expect(name(plan(sample(), "both"))).toBe(`${km("lesson")}\nen lesson`);
    expect(stem(plan(sample(), "both"))).toBe(`${km("p1 stem")}\nen p1 stem`);
    const option = (p: Json) => JSON.parse(p.steps.find((s: Json) => s.table === "questions").values.questionoptions)[0];
    expect(option(plan(sample(), "en"))).toMatchObject({ questionoptiontext: "en p1 option 0", questionoptionvalue: "en p1 option 0" });
    expect(plan().steps.find((s: Json) => s.table === "curriculums").values.curriculumname).toBe(km("module"));
    expect(() => plan(sample(), "fr")).toThrow(ContentRefused);
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
    expect(lesson.sql).toMatch(/ON DUPLICATE KEY UPDATE `lessonname` = VALUES\(`lessonname`\), `lessonorder` = VALUES\(`lessonorder`\), `lessonstatus` = VALUES\(`lessonstatus`\), `isdeleted` = VALUES\(`isdeleted`\)$/);
    expect(lesson.sql.match(/\?/g)).toHaveLength(lesson.params.length);
    const hide = statementOf(p.steps.find((s: Json) => s.kind === "hide" && s.table === "lessons"));
    expect(hide).toEqual({ sql: "UPDATE `lessons` SET `isdeleted` = ? WHERE `lessonid` IN (?, ?, ?)", params: [1, ID.lesson2, ID.lesson3, ID.lesson4] });
  });
});

// ---- the applier, on an in-memory stand-in for the connection ----------------------------------

type Store = Record<string, Record<string, Json>>;
const fakeConn = (opts: { ignoreUpdates?: boolean; failOnTable?: string } = {}) => {
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
  put("curriculums", { curriculumid: ID.curriculum, curriculumname: "placeholder", curriculumstatus: 1, isdeleted: 0 });
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
    expect(fake.log).toEqual(["begin", "commit"]);

    const second = await applyPlan(fake.conn, plan());
    for (const c of Object.values(second.tables) as Json[]) expect(c).toMatchObject({ inserted: 0, updated: 0, hidden: 0 });
    expect(formatReport(second)).toMatch(/^ {2}table +inserted updated unchanged hidden\n/);
  });

  it("is reversible: naming the hidden lesson again makes it live", async () => {
    const fake = fakeConn();
    placeholderRows(fake.store);
    await applyPlan(fake.conn, plan());
    const c = sample();
    c.lessons.push({ id: ID.lesson2, order: 2, name: bi("two"), video: { ref: "R2", filename: "dcrs-m1-l2.mp4" }, practice: [], quiz: [] });
    await applyPlan(fake.conn, plan(c));
    expect(fake.store.lessons[ID.lesson2]).toMatchObject({ isdeleted: 0, lessonstatus: 1, lessonname: km("two") });
    expect(fake.store.documents[ID.doc2].isdeleted).toBe(0);
  });

  it("rolls the whole run back when a statement fails", async () => {
    const fake = fakeConn({ failOnTable: "questions" });
    placeholderRows(fake.store);
    const before = JSON.stringify(fake.store);
    await expect(applyPlan(fake.conn, plan())).rejects.toThrow("boom");
    expect(JSON.stringify(fake.store)).toBe(before);
    expect(fake.log).toEqual(["begin", "rollback"]);
  });

  it("refuses to report success when a hide did not take, and rolls back", async () => {
    const fake = fakeConn({ ignoreUpdates: true });
    placeholderRows(fake.store);
    await expect(applyPlan(fake.conn, plan())).rejects.toThrow(/content check failed: lessons has 3 of 3 rows the plan hid still showing/);
    expect(fake.log).toEqual(["begin", "rollback"]);
  });
});

// ---- the command line ----------------------------------------------------------------------------

describe("the command line", () => {
  it("reads --content, --lang and --dry-run, and refuses anything else", () => {
    expect(parseArgs([])).toEqual({ content: null, lang: "km", dryRun: false });
    expect(parseArgs(["--content", "/x"])).toEqual({ content: "/x", lang: "km", dryRun: false });
    expect(parseArgs(["--content", "/x", "--lang", "both", "--dry-run"])).toEqual({ content: "/x", lang: "both", dryRun: true });
    for (const bad of [["--wat"], ["--content"], ["--content", "--lang"], ["--content", "/x", "--lang", "fr"], ["--lang", "en"], ["--dry-run"], ["--content", "/x", "--lang"]]) {
      expect(() => parseArgs(bad)).toThrow(ContentRefused);
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
    expect(prepare([], ID)).toEqual({ args: { content: null, lang: "km", dryRun: false }, content: null });
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
      printDryRun(sample(), ID, "km");
    } finally {
      log.mockRestore();
    }
    const text = out.join("\n");
    expect(text).toMatch(/^DCRS content plan \(dry run, language km\): 23 steps, no database used\./);
    expect(text).toContain("upsert questions 1");
    expect(text).toContain("hide   lessons 3");
    expect(text).toContain("media: copy lesson_final.mp4 to <media folder>/dcrs-m1-l1.mp4");
    expect(text).not.toMatch(/en p1|\u1780/);
  });
});
