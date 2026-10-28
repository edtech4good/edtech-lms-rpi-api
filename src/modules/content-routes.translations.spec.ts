import { Op } from "sequelize";
import { ContentTranslations } from "src/business/content-translations";
import { CONTENT_TRANSLATIONS_HEADER, sourceHash } from "src/constants/content-translations";
import { contenttranslations } from "src/models/data-models/contenttranslations";
import { organisations } from "src/models/data-models/organisations";
import { ROUTES, CONTENT, IDS, LEARNER, LEARNER_Y, ORG_X, ORG_Y, asJson, installContentFakes } from "src/test-support/content-routes-fixture";

/**
 * `X-Content-Translations: 1` on the content routes the learner app reads (bilingual content, B-1): the real
 * controllers and business methods over the fixture tree (src/test-support/content-routes-fixture.ts), with
 * `contenttranslations` and `organisations` faked. Without the header nothing changes: see
 * `content-routes.snapshot.spec.ts`. Khmer text is an opaque run of code points of the Khmer block.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const khmer = (n: number, from: number): string => String.fromCodePoint(...Array.from({ length: n }, (_, i) => from + i));
const TEXT = (n: number): string => khmer(5, 0x1780 + n * 3);
const ON = "1";

let stored: Row[];
let queries: Row[];
let contentLanguage: string | null;
let n = 0;
const tr = (tablename: string, rowid: string, field: string, base: string, text: string, over: Row = {}): Row => ({
  translationid: `t-${++n}`,
  organisationid: ORG_X,
  tablename,
  rowid,
  field,
  subkey: "",
  language: "km",
  text,
  sourcehash: sourceHash(base),
  lastupdated: new Date(),
  ...over,
});

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    const list = cond && typeof cond === "object" ? (cond as Record<symbol, unknown[]>)[Op.in as unknown as symbol] : undefined;
    return list ? list.includes(row[key]) : row[key] === cond;
  });

const find = (table: string, id: string): Row => CONTENT[table].find((r) => Object.values(r)[0] === id)!;

beforeEach(() => {
  installContentFakes();
  queries = [];
  contentLanguage = "en";
  // what organisation X has translated (and what Y has, for the same rows)
  stored = [
    tr("curriculums", "c1", "curriculumname", "Mathematics", TEXT(1)),
    tr("grades", "g1", "gradename", "Grade One", TEXT(2)),
    tr("levels", "lv1", "levelname", "Level A", TEXT(3)),
    tr("lessons", "ls1", "lessonname", "Counting", TEXT(4)),
    tr("lessons", "ls1", "lessondescription", "OLD description", TEXT(5)), // stale: the base text has changed since
    tr("lessons", "ls1", "lessonname", "Counting", TEXT(6), { language: "th" }),
    tr("lessonlearnings", "ll1", "lessonlearningname", "Watch the video", TEXT(7)),
    tr("lessonpractices", "pr1", "lessonpracticename", "Practice counting", TEXT(8)),
    tr("lessonquizzes", "qz1", "lessonquizname", "Counting quiz", TEXT(9)),
    tr("lessonplans", "pl1", "lessonplanname", "Teaching plan", TEXT(10)),
    tr("questions", "q1", "questiontext", "Which number is larger?", TEXT(11)),
    tr("questions", "q1", "headingtext", "Larger", TEXT(12)),
    tr("questions", "q1", "questionoptiontext", "12", TEXT(13), { subkey: IDS.optionB }),
    tr("questions", "q1", "questionoptiontext", "OLD seven", TEXT(14), { subkey: IDS.optionA }), // stale
    tr("questions", "q1", "feedback", "Well done", TEXT(15), { subkey: "correctmessage" }),
    // template 21: what is typed is the answer, and what is stored here is refused at import; if it is there anyway it is not served
    tr("questions", "q21", "questiontext", "Type ----- the number", TEXT(16)),
    tr("questions", "q21", "questionoptiontext", "twelve", TEXT(17), { subkey: IDS.typedOption }),
    tr("questions", "q21", "headingtext", "Typing", TEXT(18)),
    // organisation Y's translations of the very same rows, in the same language
    tr("lessons", "ls1", "lessonname", "Counting", "Y-ONLY-LESSON", { organisationid: ORG_Y }),
    tr("curriculums", "c1", "curriculumname", "Mathematics", "Y-ONLY-CURRICULUM", { organisationid: ORG_Y }),
    tr("questions", "q1", "questiontext", "Which number is larger?", "Y-ONLY-QUESTION", { organisationid: ORG_Y }),
  ];
  jest.spyOn(contenttranslations, "findAll").mockImplementation((async (options: { where: Row }) => {
    queries.push(options.where);
    return stored.filter((r) => matches(r, options.where)).map((r) => ({ ...r }));
  }) as never);
  jest.spyOn(organisations, "scope").mockReturnValue(organisations as never);
  jest.spyOn(organisations, "findOne").mockImplementation((async () => ({ contentlanguage: contentLanguage })) as never);
});
afterEach(() => jest.restoreAllMocks());

const get = async (route: string, header: string | undefined = ON, user = LEARNER): Promise<Row> => asJson(await ROUTES[route](user, header));
const kmOf = (row: Row): Row => row.translations.km;

describe("with the header, every content row of every route carries its translations and the root carries the content language", () => {
  it("GET curriculum/subjects", async () => {
    const body = await get("GET curriculum/subjects");
    expect(body.contentlanguage).toBe("en");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].translations).toEqual({ km: { curriculumname: TEXT(1) } });
    expect(body.data[0].curriculumname).toBe("Mathematics"); // the base text is still the base text
  });

  it("GET grade/curriculum/:curriculumid", async () => {
    const body = await get("GET grade/curriculum/:curriculumid");
    expect(body.contentlanguage).toBe("en");
    expect(body.data[0].translations).toEqual({ km: { gradename: TEXT(2) } });
  });

  it("GET level/grade/:gradeid", async () => {
    const body = await get("GET level/grade/:gradeid");
    expect(body.contentlanguage).toBe("en");
    expect(body.data[0].translations).toEqual({ km: { levelname: TEXT(3) } });
  });

  it("GET level/library: the curricula, grades and levels, one query per table", async () => {
    const body = await get("GET level/library");
    expect(body.contentlanguage).toBe("en");
    const curriculum = body.data.curricula[0];
    expect(curriculum.translations).toEqual({ km: { curriculumname: TEXT(1) } });
    expect(curriculum.grades[0].translations).toEqual({ km: { gradename: TEXT(2) } });
    expect(curriculum.grades[0].levels[0].translations).toEqual({ km: { levelname: TEXT(3) } });
    expect(queries.map((q) => q.tablename).sort()).toEqual(["curriculums", "grades", "levels"]);
  });

  it("GET lesson/level/:levelid: each lesson (the stale description is absent, the Thai name is there) and the level", async () => {
    const body = await get("GET lesson/level/:levelid");
    expect(body.contentlanguage).toBe("en");
    const [first, second] = body.data.lesson;
    expect(first.translations).toEqual({ km: { lessonname: TEXT(4) }, th: { lessonname: TEXT(6) } });
    expect(first.translations.km.lessondescription).toBeUndefined();
    expect(second.translations).toEqual({});
    expect(body.data.level).toBeNull(); // no level quiz in the fixture: the level is not in this answer
  });

  it("GET lesson/level/:levelid: the level, when the route returns one", async () => {
    CONTENT.levelquizquestions.push({ levelquizquestionid: "lvq1", levelid: "lv1", questionid: "q1", levelquizquestionstatus: true });
    try {
      const body = await get("GET lesson/level/:levelid");
      expect(body.data.level.translations).toEqual({ km: { levelname: TEXT(3) } });
    } finally {
      CONTENT.levelquizquestions.pop();
    }
  });

  it("GET lesson/level/:levelid/steps: carries no learner text, so there is nothing to translate and nothing is added", async () => {
    expect(await get("GET lesson/level/:levelid/steps")).toEqual(await get("GET lesson/level/:levelid/steps", undefined));
    expect(queries).toEqual([]);
  });

  it("GET lesson/:lessonid/learning: the lesson and the learnings, practices and quizzes it lists", async () => {
    const body = await get("GET lesson/:lessonid/learning");
    expect(body.contentlanguage).toBe("en");
    expect(kmOf(body.data)).toEqual({ lessonname: TEXT(4) });
    expect(kmOf(body.data.lessonlearnings[0])).toEqual({ lessonlearningname: TEXT(7) });
    expect(kmOf(body.data.lessonpractices[0])).toEqual({ lessonpracticename: TEXT(8) });
    expect(kmOf(body.data.lessonquizzes[0])).toEqual({ lessonquizname: TEXT(9) });
    expect(body.data.lessonplans).toBeUndefined(); // a learner is not shown the teaching plan
  });

  it("GET lesson/:lessonid/learning for a teacher: the plans too", async () => {
    const body = await get("GET lesson/:lessonid/learning", ON, { ...LEARNER, is_teacher_acc: true });
    expect(kmOf(body.data.lessonplans[0])).toEqual({ lessonplanname: TEXT(10) });
  });

  it("GET lesson/learning/:lessonlearningid", async () => {
    const body = await get("GET lesson/learning/:lessonlearningid");
    expect(body.contentlanguage).toBe("en");
    expect(body.data.translations).toEqual({ km: { lessonlearningname: TEXT(7) } });
  });

  describe("GET question/practice/:lessonpracticeid and question/quiz/:lessonquizid", () => {
    it("the question's text, heading, option text keyed by option id and feedback: the stale option is absent", async () => {
      const body = await get("GET question/practice/:lessonpracticeid");
      expect(body.contentlanguage).toBe("en");
      const question = body.data[0].question;
      expect(question.translations).toEqual({
        km: {
          questiontext: TEXT(11),
          headingtext: TEXT(12),
          [`questionoptiontext.${IDS.optionB}`]: TEXT(13),
          "feedback.correctmessage": TEXT(15),
        },
      });
      expect(question.translations.km[`questionoptiontext.${IDS.optionA}`]).toBeUndefined(); // stale: untranslated
      expect(JSON.stringify(question.translations)).not.toContain("OLD");
      // the base text and the answer key are what they were
      expect(question.questionoptions.map((o: Row) => [o.questionoptionid, o.questionoptiontext, o.questionoptioniscorrect])).toEqual([
        [IDS.optionA, "7", false],
        [IDS.optionB, "12", true],
      ]);
    });

    it("an answer-bearing field is never served: template 21's typed answers and questiontext, even when a row for them is stored", async () => {
      const body = await get("GET question/practice/:lessonpracticeid");
      expect(body.data[1].question.translations).toEqual({ km: { headingtext: TEXT(18) } });
    });

    it("the quiz questions are decorated the same way", async () => {
      const body = await get("GET question/quiz/:lessonquizid");
      expect(body.contentlanguage).toBe("en");
      expect(kmOf(body.data[0].question)).toMatchObject({ questiontext: TEXT(11), [`questionoptiontext.${IDS.optionB}`]: TEXT(13) });
    });
  });
});

describe("the content language", () => {
  it("is null when the organisation has none, and the rows still carry (empty or present) translations", async () => {
    contentLanguage = null;
    const body = await get("GET lesson/level/:levelid");
    expect(body.contentlanguage).toBeNull();
    expect(body.data.lesson[0].translations.km.lessonname).toBe(TEXT(4));
  });

  it("is added to the root only: no row carries it", async () => {
    const body = await get("GET curriculum/subjects");
    expect(Object.keys(body).sort()).toEqual(["contentlanguage", "data", "error"]);
    expect(body.data[0].contentlanguage).toBeUndefined();
  });
});

describe("another organisation's translations never appear (leak rows)", () => {
  it("every query names the caller's organisation, and Y's text is nowhere in X's answers", async () => {
    for (const route of Object.keys(ROUTES)) await get(route);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((q) => q.organisationid === ORG_X)).toBe(true);
    for (const route of Object.keys(ROUTES)) expect(JSON.stringify(await get(route))).not.toMatch(/Y-ONLY/);
  });

  // (the content guard that would answer 404 to Y for X's rows is proved in org-boundary.leak.spec.ts; here the rows are the
  // same on purpose, so that only the translations can differ)
  it("organisation Y's learner, reading the same routes, sees only Y's translations: its three rows and nothing of X's", async () => {
    const lesson = await get("GET lesson/level/:levelid", ON, LEARNER_Y);
    expect(lesson.data.lesson[0].translations).toEqual({ km: { lessonname: "Y-ONLY-LESSON" } });
    const curricula = await get("GET curriculum/subjects", ON, LEARNER_Y);
    expect(curricula.data[0].translations).toEqual({ km: { curriculumname: "Y-ONLY-CURRICULUM" } });
    const practice = await get("GET question/practice/:lessonpracticeid", ON, LEARNER_Y);
    expect(practice.data[0].question.translations).toEqual({ km: { questiontext: "Y-ONLY-QUESTION" } });
    for (const route of Object.keys(ROUTES)) {
      const text = JSON.stringify(await get(route, ON, LEARNER_Y));
      for (const mine of stored.filter((r) => r.organisationid === ORG_X)) expect(text).not.toContain(mine.text);
    }
  });

  it("a token with no organisation gets no translations at all, and no content language (the header is not honoured)", async () => {
    const body = await get("GET lesson/level/:levelid", ON, { ...LEARNER, organisationid: null });
    expect(JSON.stringify(body)).not.toMatch(/translations|contentlanguage/);
    expect(queries).toEqual([]);
  });
});

describe("the header", () => {
  it("is exactly X-Content-Translations: 1", () => {
    expect(CONTENT_TRANSLATIONS_HEADER).toBe("X-Content-Translations");
    for (const off of ["0", "true", "", "yes", " 2 "]) expect(ContentTranslations.from(off, LEARNER)).toBeUndefined();
  });

  it("not sent: the translations table is never read, and no content language is asked for", async () => {
    for (const route of Object.keys(ROUTES)) await ROUTES[route](LEARNER);
    expect(queries).toEqual([]);
    expect(organisations.findOne).not.toHaveBeenCalled();
  });

  it("uses one query per table per request: the lesson route asks for each table once", async () => {
    await get("GET lesson/:lessonid/learning");
    expect(queries.map((q) => q.tablename).sort()).toEqual(["lessonlearnings", "lessonpractices", "lessonquizzes", "lessons"]);
    queries.length = 0;
    await get("GET question/practice/:lessonpracticeid");
    expect(queries.map((q) => q.tablename)).toEqual(["questions"]);
    expect(find("questions", "q1").questionid).toBe("q1");
  });
});
