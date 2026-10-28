import { Op } from "sequelize";
import { sourceHash } from "src/constants/content-translations";
import { contenttranslations } from "src/models/data-models/contenttranslations";
import { organisations } from "src/models/data-models/organisations";
import { ContentTranslations, withContentLanguage } from "./content-translations";

/**
 * The helper behind `X-Content-Translations: 1` (bilingual content, B-1). `contenttranslations` is an in-memory fake that
 * evaluates the equality and `Op.in` conditions the helper asks for and counts every query it receives. Khmer text is an
 * opaque run of code points of the Khmer block, never words.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ORG_X = "a1000000-0000-4000-8000-00000000000a";
const ORG_Y = "b2000000-0000-4000-8000-00000000000b";
const khmer = (n: number, from = 0x1780): string => String.fromCodePoint(...Array.from({ length: n }, (_, i) => from + (i % 0x40)));

let stored: Row[];
let queries: Array<{ where: Row; attributes: unknown }>;
let languageReads: number;

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    const list = cond && typeof cond === "object" ? (cond as Record<symbol, unknown[]>)[Op.in as unknown as symbol] : undefined;
    return list ? list.includes(row[key]) : row[key] === cond;
  });

let n = 0;
const tr = (tablename: string, rowid: string, field: string, base: string | null, over: Row = {}): Row => ({
  translationid: `t-${++n}`,
  organisationid: ORG_X,
  tablename,
  rowid,
  field,
  subkey: "",
  language: "km",
  text: khmer(6, 0x1790 + n),
  sourcehash: base === null ? "0".repeat(64) : sourceHash(base),
  lastupdated: new Date(),
  ...over,
});

beforeEach(() => {
  stored = [];
  queries = [];
  languageReads = 0;
  jest.spyOn(contenttranslations, "findAll").mockImplementation((async (options: { where: Row; attributes?: unknown }) => {
    queries.push({ where: options.where, attributes: options.attributes });
    return stored.filter((r) => matches(r, options.where)).map((r) => ({ ...r }));
  }) as never);
  jest.spyOn(organisations, "scope").mockReturnValue(organisations as never);
  jest.spyOn(organisations, "findOne").mockImplementation((async () => {
    languageReads += 1;
    return { contentlanguage: "en" };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

const asked = (header: unknown = "1", organisationid: string | null | undefined = ORG_X): ContentTranslations => {
  const t = ContentTranslations.from(header, { organisationid });
  if (!t) throw new Error("translations were not asked for");
  return t;
};

/** A row the way Sequelize hands it to a business method: attributes behind `get`, extra values by `setDataValue`. */
const instance = (values: Row): Row => {
  const data: Row = { ...values };
  return {
    get: (key: string) => data[key],
    setDataValue: (key: string, value: unknown) => {
      data[key] = value;
    },
    toJSON: () => ({ ...data }),
  };
};

describe("ContentTranslations.from: only the exact header value, and only for a caller with an organisation", () => {
  it.each([["1", true], [" 1 ", true], [["1"], true], ["0", false], ["true", false], ["", false], [undefined, false], [1, false], [["0", "1"], false]])(
    "header %j -> %s",
    (header, on) => {
      expect(Boolean(ContentTranslations.from(header, { organisationid: ORG_X }))).toBe(on);
    },
  );

  it("is nothing for a caller whose token has no organisation, and for no caller", () => {
    expect(ContentTranslations.from("1", { organisationid: null })).toBeUndefined();
    expect(ContentTranslations.from("1", { organisationid: " " })).toBeUndefined();
    expect(ContentTranslations.from("1", undefined)).toBeUndefined();
  });
});

describe("decorate", () => {
  it("adds translations by language and field to a plain row and to a Sequelize-style row, serialised with the rest", async () => {
    stored = [
      tr("lessons", "l1", "lessonname", "Counting"),
      tr("lessons", "l1", "lessondescription", "Numbers", { language: "th" }),
    ];
    const plain: Row = { lessonid: "l1", lessonname: "Counting", lessondescription: "Numbers" };
    const model = instance({ lessonid: "l1", lessonname: "Counting", lessondescription: "Numbers" });
    await asked().decorate("lessons", [plain, model]);
    const expected = { km: { lessonname: stored[0].text }, th: { lessondescription: stored[1].text } };
    expect(plain.translations).toEqual(expected);
    expect(model.toJSON().translations).toEqual(expected);
  });

  it("every row gains translations, an empty object when it has none (so a client can tell 'asked, none' from 'not asked')", async () => {
    stored = [tr("lessons", "l1", "lessonname", "Counting")];
    const a: Row = { lessonid: "l1", lessonname: "Counting" };
    const b: Row = { lessonid: "l2", lessonname: "Other" };
    await asked().decorate("lessons", [a, b]);
    expect(Object.keys(a.translations)).toEqual(["km"]);
    expect(b.translations).toEqual({});
  });

  it("asks one query per table, whatever the number of rows, and only for this organisation's translations of this table", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ lessonid: `l${i}`, lessonname: `n${i}` }));
    stored = rows.map((r) => tr("lessons", r.lessonid, "lessonname", r.lessonname));
    await asked().decorate("lessons", rows);
    expect(queries).toHaveLength(1);
    expect(queries[0].where).toMatchObject({ organisationid: ORG_X, tablename: "lessons" });
    expect(rows.every((r: Row) => r.translations.km?.lessonname)).toBe(true);
  });

  it("splits only past 1000 ids", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ lessonid: `l${i}`, lessonname: `n${i}` }));
    await asked().decorate("lessons", rows);
    expect(queries).toHaveLength(3);
  });

  it("does nothing (and asks nothing) for no rows, a null row, or rows with no id", async () => {
    await asked().decorate("lessons", []);
    await asked().decorate("lessons", null);
    await asked().decorate("lessons", undefined);
    const noId: Row = { lessonname: "x" };
    await asked().decorate("lessons", noId);
    expect(queries).toHaveLength(0);
    expect(noId.translations).toEqual({});
  });

  describe("another organisation's translations never appear", () => {
    it("a translation of the same row owned by another organisation is not read, and the query names the caller's organisation", async () => {
      stored = [tr("lessons", "l1", "lessonname", "Counting", { organisationid: ORG_Y, text: khmer(3) }), tr("lessons", "l1", "lessonname", "Counting", { language: "th", text: khmer(4) })];
      const row: Row = { lessonid: "l1", lessonname: "Counting" };
      await asked().decorate("lessons", row);
      expect(row.translations).toEqual({ th: { lessonname: khmer(4) } });
      expect(queries.every((q) => q.where.organisationid === ORG_X)).toBe(true);
    });

    it("the other organisation's caller sees only its own", async () => {
      stored = [tr("lessons", "l1", "lessonname", "Counting", { organisationid: ORG_Y, text: khmer(3) }), tr("lessons", "l1", "lessonname", "Counting", { language: "th", text: khmer(4) })];
      const row: Row = { lessonid: "l1", lessonname: "Counting" };
      await asked("1", ORG_Y).decorate("lessons", row);
      expect(row.translations).toEqual({ km: { lessonname: khmer(3) } });
    });

    it("a translation of another table's row with the same id is not used", async () => {
      stored = [tr("levels", "l1", "levelname", "Counting")];
      const row: Row = { lessonid: "l1", lessonname: "Counting" };
      await asked().decorate("lessons", row);
      expect(row.translations).toEqual({});
    });
  });

  describe("a translation is served only while its base text is what it translated (sourcehash)", () => {
    it("a changed base text makes it untranslated, and a restored one makes it current again", async () => {
      stored = [tr("lessons", "l1", "lessonname", "Counting")];
      const edited: Row = { lessonid: "l1", lessonname: "Counting to ten" };
      await asked().decorate("lessons", edited);
      expect(edited.translations).toEqual({});
      const restored: Row = { lessonid: "l1", lessonname: "Counting" };
      await asked().decorate("lessons", restored);
      expect(restored.translations.km.lessonname).toBe(stored[0].text);
    });

    it("compares the hash without regard to letter case, and the text exactly (a trailing space is a change)", async () => {
      stored = [tr("lessons", "l1", "lessonname", "Counting", { sourcehash: sourceHash("Counting").toUpperCase() })];
      const same: Row = { lessonid: "l1", lessonname: "Counting" };
      const spaced: Row = { lessonid: "l1", lessonname: "Counting " };
      await asked().decorate("lessons", [same, spaced]);
      expect(same.translations.km).toBeDefined();
      expect(spaced.translations).toEqual({});
    });

    it("hashes the UTF-8 bytes of Khmer text exactly, with no normalisation", async () => {
      const base = `${khmer(10)}\u00e9`; // a composable pair at the end: NFC and NFD differ
      stored = [tr("lessons", "l1", "lessonname", base)];
      const nfd: Row = { lessonid: "l1", lessonname: base.normalize("NFD") };
      const exact: Row = { lessonid: "l1", lessonname: base };
      await asked().decorate("lessons", [exact, nfd]);
      expect(exact.translations.km).toBeDefined();
      expect(nfd.translations).toEqual({});
      expect(base.normalize("NFD")).not.toBe(base);
    });

    it("a field the row does not carry (a route that does not select it) is left out", async () => {
      stored = [tr("lessons", "l1", "lessondescription", "Numbers")];
      const row: Row = { lessonid: "l1", lessonname: "Counting" };
      await asked().decorate("lessons", row);
      expect(row.translations).toEqual({});
    });

    it("a null base text is never translated", async () => {
      stored = [tr("lessons", "l1", "lessondescription", null)];
      const row: Row = { lessonid: "l1", lessondescription: null };
      await asked().decorate("lessons", row);
      expect(row.translations).toEqual({});
    });
  });

  it("a field that is not translatable text is never served, even if a row for it is stored", async () => {
    stored = [tr("lessons", "l1", "lessonorder", "3")];
    const row: Row = { lessonid: "l1", lessonorder: "3" };
    await asked().decorate("lessons", row);
    expect(row.translations).toEqual({});
  });

  describe("questions: the text inside the JSON, keyed by option, partner, distractor or message", () => {
    const question = (over: Row = {}): Row => ({
      questionid: "q1",
      templatetypeid: 1,
      questiontext: "Which is larger?",
      questionheading: { headingfile: null, headingtext: "Larger" },
      questionoptions: [
        { questionoptionid: "o1", questionoptiontext: "7", questionassociate: { questionoptionid: "o1", questionassociatetext: "seven" } },
        { questionoptionid: "o2", questionoptiontext: "12", questionassociate: null },
      ],
      questiondistractors: [{ questiondistractorid: "d1", questiondistractortext: "99" }],
      questionfeedback: { correctmessage: "Well done", incorrectmessage: "Try again" },
      ...over,
    });

    it("serves each of the six kinds under '<field>' or '<field>.<subkey>'", async () => {
      stored = [
        tr("questions", "q1", "questiontext", "Which is larger?", { text: "A" }),
        tr("questions", "q1", "headingtext", "Larger", { text: "B" }),
        tr("questions", "q1", "questionoptiontext", "12", { subkey: "o2", text: "C" }),
        tr("questions", "q1", "questionassociatetext", "seven", { subkey: "o1", text: "D" }),
        tr("questions", "q1", "questiondistractortext", "99", { subkey: "d1", text: "E" }),
        tr("questions", "q1", "feedback", "Well done", { subkey: "correctmessage", text: "F" }),
        tr("questions", "q1", "feedback", "Try again", { subkey: "incorrectmessage", text: "G" }),
      ];
      const row = question();
      await asked().decorate("questions", row);
      expect(row.translations).toEqual({
        km: {
          questiontext: "A",
          headingtext: "B",
          "questionoptiontext.o2": "C",
          "questionassociatetext.o1": "D",
          "questiondistractortext.d1": "E",
          "feedback.correctmessage": "F",
          "feedback.incorrectmessage": "G",
        },
      });
    });

    it("a translation follows its option's id: after an edit the same id still has its own text, and a removed option has none", async () => {
      stored = [tr("questions", "q1", "questionoptiontext", "12", { subkey: "o2", text: "C" })];
      const reordered = question({ questionoptions: [{ questionoptionid: "o2", questionoptiontext: "12" }, { questionoptionid: "o1", questionoptiontext: "7" }] });
      await asked().decorate("questions", reordered);
      expect(reordered.translations.km["questionoptiontext.o2"]).toBe("C");
      const other = question({ questionoptions: [{ questionoptionid: "o9", questionoptiontext: "12" }] }); // a NEW id with the same text
      await asked().decorate("questions", other);
      expect(other.translations).toEqual({});
    });

    it("a translation whose option text has changed is stale: only the stale one is absent, the others stay", async () => {
      stored = [
        tr("questions", "q1", "questionoptiontext", "12", { subkey: "o2", text: "C" }),
        tr("questions", "q1", "questionoptiontext", "OLD", { subkey: "o1", text: "STALE" }),
      ];
      const row = question();
      await asked().decorate("questions", row);
      expect(row.translations).toEqual({ km: { "questionoptiontext.o2": "C" } });
    });

    it("reads JSON columns that arrive as strings", async () => {
      stored = [tr("questions", "q1", "questionoptiontext", "12", { subkey: "o2", text: "C" }), tr("questions", "q1", "headingtext", "Larger", { text: "B" })];
      const row = question({
        questionoptions: JSON.stringify(question().questionoptions),
        questionheading: JSON.stringify(question().questionheading),
      });
      await asked().decorate("questions", row);
      expect(row.translations.km).toEqual({ headingtext: "B", "questionoptiontext.o2": "C" });
    });

    it("never serves an answer-bearing field, whatever is stored: template 21's typed answers and questiontext, and fill-in-the-blank's questiontext", async () => {
      stored = [
        tr("questions", "q1", "questiontext", "Which is larger?", { text: "A" }),
        tr("questions", "q1", "questionoptiontext", "12", { subkey: "o2", text: "C" }),
        tr("questions", "q1", "headingtext", "Larger", { text: "B" }),
      ];
      const typed = question({ templatetypeid: 21 });
      await asked().decorate("questions", typed);
      expect(typed.translations).toEqual({ km: { headingtext: "B" } });
      const blank = question({ templatetypeid: 8 });
      await asked().decorate("questions", blank);
      expect(blank.translations).toEqual({ km: { headingtext: "B", "questionoptiontext.o2": "C" } });
      const choice = question({ templatetypeid: 1 });
      await asked().decorate("questions", choice);
      expect(Object.keys(choice.translations.km).sort()).toEqual(["headingtext", "questiontext", "questionoptiontext.o2"].sort());
    });

    it("an ordering question's option text is display text and is served (the sequence is what is graded)", async () => {
      stored = [tr("questions", "q1", "questionoptiontext", "12", { subkey: "o2", text: "C" })];
      for (const template of [5, 6]) {
        const row = question({ templatetypeid: template });
        await asked().decorate("questions", row);
        expect(row.translations.km["questionoptiontext.o2"]).toBe("C");
      }
    });

    it("reads the template when it is stored as a string", async () => {
      stored = [tr("questions", "q1", "questiontext", "Which is larger?", { text: "A" })];
      const row = question({ templatetypeid: "21" });
      await asked().decorate("questions", row);
      expect(row.translations).toEqual({});
    });
  });
});

describe("the organisation's content language", () => {
  it("is asked once per request and added to the response root", async () => {
    const t = asked();
    expect(await t.root({ data: [1], error: false })).toEqual({ data: [1], error: false, contentlanguage: "en" });
    await t.root({ data: [], error: false });
    expect(languageReads).toBe(1);
    expect(organisations.scope).toHaveBeenCalledWith("withContentLanguage");
  });

  it("is null when the organisation has none", async () => {
    jest.spyOn(organisations, "findOne").mockResolvedValue({ contentlanguage: null } as never);
    expect(await asked().root({ data: 1 })).toEqual({ data: 1, contentlanguage: null });
    jest.spyOn(organisations, "findOne").mockResolvedValue(null as never);
    expect(await asked().root({ data: 1 })).toEqual({ data: 1, contentlanguage: null });
  });

  it("withContentLanguage leaves a response with no translations asked for exactly as it is, and reads nothing", async () => {
    const body = { data: [1, 2], error: false };
    expect(await withContentLanguage(undefined, body)).toBe(body);
    expect(languageReads).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
