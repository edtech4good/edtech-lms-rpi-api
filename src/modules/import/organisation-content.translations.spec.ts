import { readFileSync } from "fs";
import { join } from "path";
import { sourceHash } from "src/constants/content-translations";
import { ApiError } from "src/models/ApiError";
import { validateOrganisationContent } from "./organisation-content.validator";

/**
 * The `contenttranslations` key of a format-3 content payload (bilingual content, B-1): the table kind "owned, with a
 * polymorphic parent", checked from the payload alone. The base payload is the provisioning sample (the one the
 * house specs already validate); Khmer text is an opaque run of code points of the Khmer block, never words.
 */
const SAMPLE = join(__dirname, "..", "..", "..", "scripts", "provision", "sample-content.json");
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const sample = (): Row => JSON.parse(readFileSync(SAMPLE, "utf8"));

const khmer = (n: number, from = 0x1780): string => String.fromCodePoint(...Array.from({ length: n }, (_, i) => from + (i % 0x40)));

const ORG = "a0000000-0000-4000-8000-000000000001";
const OTHER_ORG = "a1000000-0000-4000-8000-000000000009";
const LESSON = "b0000000-0000-4000-8000-000000000009";
const QUESTION = "b0000000-0000-4000-8000-000000000100"; // template 1, three options
const QUESTION_ORDER = "b0000000-0000-4000-8000-000000000104"; // template 5 (ordering)
const QUESTION_BLANK = "b0000000-0000-4000-8000-000000000107"; // template 8 (fill in the blank)
// An option id is a uuid on the real data (the subkey column is 36 characters; the sample's own demo option ids are longer).
const OPTION = "d0000000-0000-4000-8000-000000000002";
const ORDER_OPTION = "d0000000-0000-4000-8000-000000000011";
const BLANK_OPTION = "d0000000-0000-4000-8000-000000000021";

let n = 0;
const translation = (over: Row = {}): Row => ({
  translationid: `c0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  organisationid: ORG,
  tablename: "lessons",
  rowid: LESSON,
  field: "lessonname",
  subkey: "",
  language: "km",
  text: khmer(12),
  sourcehash: sourceHash("Counting to ten"),
  lastupdated: "2026-10-28T03:00:00.000Z",
  ...over,
});

const withRows = (rows: Row[], mutate: (body: Row) => void = () => undefined): Row => {
  const body = sample();
  body.contenttranslations = rows;
  mutate(body);
  return body;
};

/** The message the validator refuses with (a 400 naming the problem), or null when the payload is accepted. */
const refusal = (body: Row): string | null => {
  try {
    validateOrganisationContent(body);
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return (e as ApiError).message;
  }
  return null;
};

const setTemplate = (id: string, templatetypeid: number) => (body: Row) => {
  body.questions.find((q: Row) => q.questionid === id).templatetypeid = templatetypeid;
};

describe("contenttranslations in a content payload", () => {
  describe("what is accepted", () => {
    it("an empty array, and every kind of row at once (a plain field, an option text with its subkey, a feedback message)", () => {
      expect(refusal(withRows([]))).toBeNull();
      const rows = [
        translation(),
        translation({ tablename: "lessons", field: "lessondescription", sourcehash: sourceHash("Demo lesson") }),
        translation({ tablename: "questions", rowid: QUESTION, field: "questiontext", sourcehash: sourceHash("Which number is larger?") }),
        translation({ tablename: "questions", rowid: QUESTION, field: "headingtext", sourcehash: sourceHash("Which number is larger?") }),
        translation({ tablename: "questions", rowid: QUESTION, field: "questionoptiontext", subkey: OPTION, sourcehash: sourceHash("12") }),
        translation({ tablename: "questions", rowid: QUESTION, field: "feedback", subkey: "correctmessage", sourcehash: sourceHash("x") }),
        translation({ tablename: "curriculums", rowid: "b0000000-0000-4000-8000-000000000005", field: "curriculumname", sourcehash: sourceHash("Demo Curriculum") }),
      ];
      const body = withRows(rows);
      const content = validateOrganisationContent(body);
      expect(content.tables.contenttranslations).toEqual(rows);
    });

    it("an ordering template's option text is display text: it may be translated (the sequence is what is graded)", () => {
      const body = withRows([translation({ tablename: "questions", rowid: QUESTION_ORDER, field: "questionoptiontext", subkey: ORDER_OPTION, sourcehash: sourceHash("The") })]);
      expect(refusal(body)).toBeNull();
    });

    it("a fill-in-the-blank question's option and distractor text may be translated (tiles are graded by id and sequence)", () => {
      const body = withRows([translation({ tablename: "questions", rowid: QUESTION_BLANK, field: "questionoptiontext", subkey: BLANK_OPTION, sourcehash: sourceHash("mat") })]);
      expect(refusal(body)).toBeNull();
    });

    it("a language equal to the organisation's content language is refused, but any language is accepted when the organisation has none", () => {
      const body = withRows([translation({ language: "en" })], (b) => {
        delete b.organisations[0].contentlanguage;
      });
      expect(refusal(body)).toBeNull();
    });
  });

  describe("the key is required, like every other key (the learning-items precedent)", () => {
    it("a payload without contenttranslations (a main-shaped payload) is refused with the validator's own message", () => {
      const body = sample();
      delete body.contenttranslations;
      delete body.organisations[0].contentlanguage;
      expect(refusal(body)).toBe("contenttranslations must be an array (an empty one if the organisation has none).");
    });

    it("a payload with the key but without organisations[0].contentlanguage is accepted: the column is optional", () => {
      const body = sample();
      delete body.organisations[0].contentlanguage;
      body.contenttranslations = [];
      expect(refusal(body)).toBeNull();
    });
  });

  describe("refused, naming the table and how many rows", () => {
    it("a row whose parent is not a row of the payload (dangling rowid): refused, never dropped", () => {
      const message = refusal(withRows([translation(), translation({ rowid: "b0000000-0000-4000-8000-0000000fffff", field: "lessondescription" })]));
      expect(message).toBe("contenttranslations: 1 row names a lessons row (rowid) that is not in the payload.");
    });

    it("counts the dangling rows per table, and the message carries no id", () => {
      const message = refusal(
        withRows([
          translation({ rowid: "b0000000-0000-4000-8000-0000000fffff" }),
          translation({ rowid: "b0000000-0000-4000-8000-0000000ffffe", field: "lessondescription" }),
          translation({ tablename: "questions", rowid: "b0000000-0000-4000-8000-0000000ffffd", field: "questiontext" }),
        ]),
      );
      expect(message).toBe(
        "contenttranslations: 2 rows name a lessons row (rowid) that is not in the payload. contenttranslations: 1 row names a questions row (rowid) that is not in the payload.",
      );
      expect(message).not.toMatch(/fffff|ffffe|ffffd|-4000-/);
    });

    it("a parent of the wrong table is dangling (a question id named as a lesson)", () => {
      expect(refusal(withRows([translation({ tablename: "lessons", rowid: QUESTION })]))).toBe(
        "contenttranslations: 1 row names a lessons row (rowid) that is not in the payload.",
      );
    });

    it("a table that is not translatable (including ones that are content tables)", () => {
      for (const tablename of ["documents", "schools", "lessonlearningdocuments", "organisations", "__proto__", "constructor"]) {
        expect(refusal(withRows([translation({ tablename })]))).toMatch(/^contenttranslations: 1 row names a tablename that is not translatable \(it must be one of curriculums, grades,/);
      }
    });

    it("a field that its table does not have as translatable text (an ordering, a status, another table's field)", () => {
      for (const field of ["lessonorder", "lessonstatus", "levelname", "questiontext", "__proto__"]) {
        expect(refusal(withRows([translation({ field })]))).toBe("contenttranslations: 1 row names a field that its table does not have as translatable text.");
      }
    });

    it("an answer-bearing field: template 21's option text and questiontext, and fill-in-the-blank's questiontext", () => {
      const graded = "template 8: questiontext; template 21: questiontext, questionoptiontext";
      const expected = `contenttranslations: 1 row translates a field that an answer is graded by (${graded}).`;
      const blank = withRows([translation({ tablename: "questions", rowid: QUESTION_BLANK, field: "questiontext" })]);
      expect(refusal(blank)).toBe(expected);
      const typed = (field: string, subkey: string) => withRows([translation({ tablename: "questions", rowid: QUESTION, field, subkey })], setTemplate(QUESTION, 21));
      expect(refusal(typed("questionoptiontext", OPTION))).toBe(expected);
      expect(refusal(typed("questiontext", ""))).toBe(expected);
      // the same fields on a template that is graded by id are display text
      expect(refusal(withRows([translation({ tablename: "questions", rowid: QUESTION, field: "questionoptiontext", subkey: OPTION })]))).toBeNull();
    });

    it("a subkey that does not follow the field's rule", () => {
      const rule = /^contenttranslations: 1 row has a subkey that does not follow its field's rule/;
      const q = (field: string, subkey: unknown) => withRows([translation({ tablename: "questions", rowid: QUESTION, field, subkey })]);
      expect(refusal(q("questionoptiontext", ""))).toMatch(rule); // needs one
      expect(refusal(q("questiondistractortext", ""))).toMatch(rule);
      expect(refusal(q("questionassociatetext", ""))).toMatch(rule);
      expect(refusal(q("feedback", ""))).toMatch(rule);
      expect(refusal(q("feedback", "someothermessage"))).toMatch(rule); // only the two message keys
      expect(refusal(q("questiontext", OPTION))).toMatch(rule); // must be '' for a plain field
      expect(refusal(q("questiontext", null))).toMatch(rule); // NULL is never stored: '' is "none"
      expect(refusal(withRows([translation({ subkey: "x" })]))).toMatch(rule);
      expect(refusal(q("questionoptiontext", "x".repeat(37)))).toMatch(rule);
    });

    it("a language that is not 2 to 8 letters, digits or hyphens, or is the organisation's own", () => {
      for (const language of ["k", "khmerkhmer", "k m", "", null, 5]) {
        expect(refusal(withRows([translation({ language })]))).toBe("contenttranslations: 1 row has a language that is not 2 to 8 letters, digits or hyphens.");
      }
      const own = "contenttranslations: 1 row is in the organisation's own contentlanguage, which the table's own columns already hold.";
      expect(refusal(withRows([translation({ language: "en" })]))).toBe(own); // the sample's organisation is "en"
      expect(refusal(withRows([translation({ language: "EN" })]))).toBe(own); // compared without regard to case
      expect(refusal(withRows([translation({ language: "pt-BR" })]))).toBeNull();
    });

    it("a text that is empty, not a string, or over 65535 bytes (Khmer is 3 bytes a character)", () => {
      const rule = "contenttranslations: 1 row has a text that is not a string of 1 to 65535 bytes.";
      expect(refusal(withRows([translation({ text: "" })]))).toBe(rule);
      expect(refusal(withRows([translation({ text: null })]))).toBe(rule);
      expect(refusal(withRows([translation({ text: khmer(21846) })]))).toBe(rule); // 65538 bytes
      expect(refusal(withRows([translation({ text: khmer(21845) })]))).toBeNull(); // 65535 bytes
    });

    it("a sourcehash that is not 64 hexadecimal characters, and a lastupdated that is not a date", () => {
      for (const sourcehash of ["", "abc", "z".repeat(64), "a".repeat(65), null]) {
        expect(refusal(withRows([translation({ sourcehash })]))).toBe("contenttranslations: 1 row has a sourcehash that is not 64 hexadecimal characters.");
      }
      expect(refusal(withRows([translation({ sourcehash: "A".repeat(64) })]))).toBeNull();
      for (const lastupdated of [undefined, null, "yesterday", 5]) {
        expect(refusal(withRows([translation({ lastupdated })]))).toBe("contenttranslations: 1 row has a lastupdated that is not a date.");
      }
    });

    it("a row that carries another organisation's id, or none", () => {
      expect(refusal(withRows([translation({ organisationid: OTHER_ORG })]))).toBe("contenttranslations: 1 row belongs to another organisation than the one in the header.");
      expect(refusal(withRows([translation({ organisationid: null })]))).toBe(
        "contenttranslations: 1 row carries no organisationid, and this table's rows must carry the header's.",
      );
    });

    it("a repeated (table, row, field, subkey, language), even in another letter case, and a repeated translationid", () => {
      const again = "contenttranslations: 1 row repeats a table, row, field, subkey and language that is already in this table of the payload.";
      expect(refusal(withRows([translation(), translation()]))).toBe(again);
      expect(refusal(withRows([translation(), translation({ language: "KM" })]))).toBe(again);
      const one = translation();
      expect(refusal(withRows([one, translation({ translationid: one.translationid, field: "lessondescription" })]))).toBe(
        "contenttranslations: 1 row repeats an id that is already in this table of the payload.",
      );
      // the same text in two languages is two rows
      expect(refusal(withRows([translation(), translation({ language: "th" })]))).toBeNull();
    });

    it("reports every problem at once, and nothing is half-accepted", () => {
      const message = refusal(withRows([translation({ language: "k" }), translation({ sourcehash: "x", field: "lessondescription" })]));
      expect(message).toContain("a language that is not 2 to 8");
      expect(message).toContain("a sourcehash that is not 64");
    });
  });

  describe("organisations[0].contentlanguage", () => {
    it("is a language code or null, and anything else is refused by the organisation row's schema", () => {
      const body = (value: unknown) => withRows([], (b) => {
        b.organisations[0].contentlanguage = value;
      });
      expect(refusal(body("km"))).toBeNull();
      expect(refusal(body(null))).toBeNull();
      for (const bad of ["k", "x".repeat(9), "k m", 7, ""]) expect(refusal(body(bad))).toMatch(/contentlanguage/);
    });
  });
});
