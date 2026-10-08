import AdmZip from "adm-zip";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Row, TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";
import { ProvisionError } from "./args";
import { matchCountriesByName } from "src/business/country-rehoming";
import { fakeCountryNames } from "src/test-support/country-names";
import { LocalIdentity, readContentFile, rehomeContent, validatePayload } from "./payload";

const SAMPLE = join(__dirname, "..", "..", "scripts", "provision", "sample-content.json");
const sample = (): Record<string, unknown> => JSON.parse(readFileSync(SAMPLE, "utf8"));

const LOCAL_ORG = "0c000000-0000-4000-8000-0000000000a1";
const LOCAL_SCHOOL = "0c000000-0000-4000-8000-0000000000b1";
const LOCAL_CLASS = "0c000000-0000-4000-8000-0000000000c1";
const CAMBODIA = "b0000000-0000-4000-8000-000000000001";

const identity = (extra: Partial<LocalIdentity> = {}): LocalIdentity => ({
  organisation: {
    organisationid: LOCAL_ORG,
    organisationname: "បណ្តាញសិក្សាមេគង្គ",
    organisationcode: "mekong",
    organisationstatus: true,
    uitheme: "kids",
    brandingconfig: null,
    settingsconfig: null,
    isdeleted: false,
  },
  school: {
    schoolid: LOCAL_SCHOOL,
    schoolname: "សាលាបឋមសិក្សា ទន្លេមេគង្គ",
    countryid: CAMBODIA,
    uitheme: "kids",
    brandingconfig: null,
    expectedcontribution: null,
    expectedusage: null,
  },
  standards: [{ standardid: LOCAL_CLASS, standardname: "ថ្នាក់ទី ៣ក", isdeleted: false }],
  country: null,
  ...extra,
});

/** What the database says about the payload's country names, given the countries this server has. */
const matchesFor = (body: Record<string, Row[]>, local: Array<Record<string, unknown>>) =>
  matchCountriesByName(body.countries, fakeCountryNames(local as never));

const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProvisionError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
};

const ids = (rows: unknown, key: string): string[] => (rows as Row[]).map((r) => String(r[key])).sort();

describe("the sample content payload", () => {
  it("is a valid format-3 payload of the demo organisation, with demo names only", () => {
    const content = validatePayload(sample());
    expect(content.organisationcode).toBe("edtech4good");
    expect(Object.fromEntries(TABLE_KEYS.map((k) => [k, content.tables[k].length]))).toEqual({
      schools: 1,
      standards: 1,
      countries: 1,
      curriculums: 1,
      curriculumbaselines: 0,
      baselinequestion: 0,
      grades: 1,
      levels: 1,
      lessons: 2,
      lessonlearnings: 2,
      lessonplans: 0,
      lessonpractices: 2,
      lessonquizzes: 2,
      lessonpracticequestions: 8,
      lessonquizquestions: 8,
      levelquizquestions: 0,
      questions: 8,
      documents: 2,
      subjects: 1,
    });
    const text = JSON.stringify(sample());
    // demo content only: no address, no link, and every named thing is a demo one
    expect(text).not.toMatch(/@|https?:/);
    expect(content.tables.curriculums.map((r) => r.curriculumname)).toEqual(["Demo Curriculum"]);
    expect(content.tables.schools.map((r) => r.schoolname)).toEqual(["Demo Primary School"]);
  });
});

describe("validatePayload", () => {
  it.each([
    ["format 2", { ...sample(), format: 2 }],
    ["no format", (() => { const { format, ...rest } = sample(); void format; return rest; })()],
    ["an array", []],
    ["a string", "payload"],
    ["null", null],
  ])("refuses %s as not a format-3 payload", (_name, body) => {
    expect(refusal(() => validatePayload(body))).toBe(
      "The content is not a format-3 payload (one organisation's content). Format 2 is retired. Export it again from the admin.",
    );
  });

  it("refuses a payload whose rows carry mixed owners, naming the table and the count", () => {
    const body = sample();
    const questions = body.questions as Row[];
    questions[0] = { ...questions[0], organisationid: "0d000000-0000-4000-8000-0000000000d1" };
    expect(refusal(() => validatePayload(body))).toBe(
      "The content payload is refused: questions: 1 row belongs to another organisation than the one in the header.",
    );
  });

  it("refuses a row of an owned table with no owner at all", () => {
    const body = sample();
    const documents = body.documents as Row[];
    const { organisationid, ...bare } = documents[1];
    void organisationid;
    documents[1] = bare;
    expect(refusal(() => validatePayload(body))).toMatch(/^The content payload is refused: documents: 1 row carries no organisationid/);
  });

  it("refuses a payload that carries learners or logins", () => {
    expect(refusal(() => validatePayload({ ...sample(), schoolusers: [] }))).toMatch(/learners and logins are not part of a content payload/);
  });
});

describe("rehomeContent", () => {
  it("makes the payload the local organisation's, rewriting owners and the header and nothing of the content", () => {
    const original = validatePayload(sample());
    const { body, content, summary } = rehomeContent(original, identity());

    expect(body.format).toBe(3);
    expect(body.scope).toBe("organisation");
    expect(body.organisationid).toBe(LOCAL_ORG);
    expect(body.organisationcode).toBe("mekong");
    expect(body.organisations).toEqual([identity().organisation]);

    // every owned row, whatever its table, now has the local owner and no other
    for (const key of ["curriculums", "questions", "documents", "subjects", "schools"] as TableKey[]) {
      expect(content.tables[key].length).toBeGreaterThan(0);
      expect(content.tables[key].map((r) => r.organisationid)).toEqual(content.tables[key].map(() => LOCAL_ORG));
    }
    expect(JSON.stringify(body)).not.toContain("a0000000-0000-4000-8000-000000000001");
    expect(summary.ownersRewritten).toEqual({ curriculums: 1, questions: 8, documents: 2, subjects: 1 });

    // content ids are NOT changed: the same set of ids in every table that is not replaced
    const idKeys: Record<string, string> = {
      curriculums: "curriculumid", questions: "questionid", documents: "documentid", subjects: "subjectid", grades: "gradeid", levels: "levelid",
      lessons: "lessonid", lessonlearnings: "lessonlearningid", lessonpractices: "lessonpracticeid", lessonquizzes: "lessonquizid",
      lessonpracticequestions: "lessonpracticequestionid", lessonquizquestions: "lessonquizquestionid", countries: "countryid",
    };
    for (const [table, pk] of Object.entries(idKeys)) {
      expect(ids(content.tables[table as TableKey], pk)).toEqual(ids(original.tables[table as TableKey], pk));
    }
    // and the text of the content is untouched
    expect(content.tables.questions.map((r) => r.questiontext)).toEqual(original.tables.questions.map((r) => r.questiontext));
  });

  it("replaces the payload's schools and classes by the local ones, the school listing every curriculum", () => {
    const original = validatePayload(sample());
    const { content, summary } = rehomeContent(original, identity());
    expect(content.tables.schools).toEqual([
      {
        schoolid: LOCAL_SCHOOL,
        schoolname: "សាលាបឋមសិក្សា ទន្លេមេគង្គ",
        countryid: CAMBODIA,
        curriculums: ["b0000000-0000-4000-8000-000000000005"],
        expectedcontribution: null,
        expectedusage: null,
        isdeleted: false,
        uitheme: "kids",
        brandingconfig: null,
        organisationid: LOCAL_ORG,
      },
    ]);
    expect(content.tables.standards).toEqual([
      { standardid: LOCAL_CLASS, standardname: "ថ្នាក់ទី ៣ក", schoolid: LOCAL_SCHOOL, schoolname: "សាលាបឋមសិក្សា ទន្លេមេគង្គ", isdeleted: false },
    ]);
    expect(summary.schoolsInPayload).toBe(1);
    expect(summary.standardsInPayload).toBe(1);
    expect(summary.curricula).toBe(1);
  });

  it("has no class at all for a new school with none asked for (the payload's are dropped, not kept)", () => {
    const { content } = rehomeContent(validatePayload(sample()), identity({ standards: [] }));
    expect(content.tables.standards).toEqual([]);
  });

  it("carries every class the school already has, deleted ones and creation dates included, plus the new one", () => {
    const created = new Date("2026-09-01T03:00:00.000Z");
    const existing = [
      { standardid: "0c000000-0000-4000-8000-0000000000c2", standardname: "ថ្នាក់ទី ៤ខ", isdeleted: false, created_at: created },
      { standardid: "0c000000-0000-4000-8000-0000000000c3", standardname: "Old class", isdeleted: true, created_at: created },
      { standardid: LOCAL_CLASS, standardname: "ថ្នាក់ទី ៣ក", isdeleted: false },
    ];
    const { content } = rehomeContent(validatePayload(sample()), identity({ standards: existing }));
    expect(content.tables.standards).toEqual([
      { standardid: existing[0].standardid, standardname: "ថ្នាក់ទី ៤ខ", schoolid: LOCAL_SCHOOL, schoolname: "សាលាបឋមសិក្សា ទន្លេមេគង្គ", isdeleted: false, created_at: created },
      { standardid: existing[1].standardid, standardname: "Old class", schoolid: LOCAL_SCHOOL, schoolname: "សាលាបឋមសិក្សា ទន្លេមេគង្គ", isdeleted: true, created_at: created },
      { standardid: LOCAL_CLASS, standardname: "ថ្នាក់ទី ៣ក", schoolid: LOCAL_SCHOOL, schoolname: "សាលាបឋមសិក្សា ទន្លេមេគង្គ", isdeleted: false },
    ]);
  });

  it("gives a baseline that named schools the local school, and leaves a baseline that named none alone", () => {
    const body = sample() as Record<string, Row[]>;
    const question = body.questions[0].questionid;
    body.curriculumbaselines = [
      { curriculumbaselineid: "0e000000-0000-4000-8000-000000000001", curriculumid: body.curriculums[0].curriculumid, schoolid: [body.schools[0].schoolid] },
      { curriculumbaselineid: "0e000000-0000-4000-8000-000000000002", curriculumid: body.curriculums[0].curriculumid, schoolid: [] },
    ];
    body.baselinequestion = [{ baselinequestionid: "0e000000-0000-4000-8000-000000000003", curriculumbaselineid: "0e000000-0000-4000-8000-000000000001", questionid: question }];
    const { content, summary } = rehomeContent(validatePayload(body), identity());
    expect(content.tables.curriculumbaselines.map((r) => r.schoolid)).toEqual([[LOCAL_SCHOOL], []]);
    expect(summary.baselineListsRewritten).toBe(1);
  });

  it("adds the school's country to the payload when it does not carry it, and refuses when it has none to add", () => {
    const body = sample() as Record<string, Row[]>;
    body.countries = [];
    body.schools = body.schools.map((s) => ({ ...s, countryid: null }));
    const original = validatePayload(body);
    expect(refusal(() => rehomeContent(original, identity()))).toBe("The school's country is neither in the payload nor in this database.");
    const country = { countryid: CAMBODIA, countryname: "Cambodia", expectedusage: null, isdeleted: false };
    const { content, summary } = rehomeContent(original, identity({ country }));
    expect(content.tables.countries).toEqual([country]);
    expect(summary.countryAdded).toBe(true);
  });

  it("re-homes a payload country onto this server's country of the same name (the database's equality: a trailing space does not matter), and every reference follows", async () => {
    const body = sample() as Record<string, Row[]>;
    body.countries = [{ ...body.countries[0], countryname: "កម្ពុជា" }];
    const localCountry = { countryid: "0c000000-0000-4000-8000-0000000000e1", countryname: "កម្ពុជា ", expectedusage: 5, isdeleted: false };
    const { content, summary } = rehomeContent(
      validatePayload(body),
      identity({ school: { ...identity().school, countryid: localCountry.countryid }, countryMatches: await matchesFor(body, [localCountry]) }),
    );
    expect(content.tables.countries).toEqual([{ countryid: localCountry.countryid, countryname: "កម្ពុជា ", expectedusage: 5, isdeleted: false }]);
    expect(content.tables.schools.map((r) => r.countryid)).toEqual([localCountry.countryid]);
    expect(JSON.stringify(content.tables)).not.toContain(CAMBODIA);
    expect(summary.countriesRemapped).toBe(1);
  });

  it("the school's country is the one that is kept when the payload carries two countries the database calls equal and the school was given the second", async () => {
    const SECOND = "0c000000-0000-4000-8000-0000000000e5";
    const body = sample() as Record<string, Row[]>;
    body.countries = [{ ...body.countries[0], countryname: "Cambodia" }, { ...body.countries[0], countryid: SECOND, countryname: "CAMBODIA " }];
    const { content, summary } = rehomeContent(
      validatePayload(body),
      identity({ school: { ...identity().school, countryid: SECOND }, countryMatches: await matchesFor(body, []) }),
    );
    expect(ids(content.tables.countries, "countryid")).toEqual([CAMBODIA]);
    expect(content.tables.schools.map((r) => r.countryid)).toEqual([CAMBODIA]);
    expect(summary.countriesRemapped).toBe(1);
  });

  it("re-homes onto a country that is deleted here as a live row (it is brought back, the one rule for a deleted country)", async () => {
    const deletedLocal = { countryid: "0c000000-0000-4000-8000-0000000000e3", countryname: "Cambodia", expectedusage: null, isdeleted: true };
    const { content } = rehomeContent(
      validatePayload(sample()),
      identity({ school: { ...identity().school, countryid: deletedLocal.countryid }, countryMatches: await matchesFor(sample() as Record<string, Row[]>, [deletedLocal]) }),
    );
    expect(content.tables.countries).toEqual([{ countryid: deletedLocal.countryid, countryname: "Cambodia", expectedusage: null, isdeleted: false }]);
  });

  it("leaves a payload country alone when this server has it under the same id, or does not have the name", async () => {
    const payload = sample() as Record<string, Row[]>;
    const sameId = rehomeContent(
      validatePayload(sample()),
      identity({ countryMatches: await matchesFor(payload, [{ countryid: CAMBODIA, countryname: "Cambodia", expectedusage: null, isdeleted: false }]) }),
    );
    expect(sameId.summary.countriesRemapped).toBe(0);
    expect(ids(sameId.content.tables.countries, "countryid")).toEqual([CAMBODIA]);
    const other = rehomeContent(
      validatePayload(sample()),
      identity({ countryMatches: await matchesFor(payload, [{ countryid: "0c000000-0000-4000-8000-0000000000e2", countryname: "Elsewhere", expectedusage: null, isdeleted: false }]) }),
    );
    expect(other.summary.countriesRemapped).toBe(0);
    expect(ids(other.content.tables.countries, "countryid")).toEqual([CAMBODIA]);
  });

  it("does not mutate the payload it was given", () => {
    const original = validatePayload(sample());
    const before = JSON.stringify(original);
    rehomeContent(original, identity());
    expect(JSON.stringify(original)).toBe(before);
  });
});

describe("readContentFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "provision-spec-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads raw JSON, a JSON file with a byte-order mark, and the first file of a zip, the same payload each time", () => {
    const text = readFileSync(SAMPLE, "utf8");
    const raw = join(dir, "raw.json");
    writeFileSync(raw, text);
    const bom = join(dir, "bom.json");
    writeFileSync(bom, "﻿" + text);
    const zip = new AdmZip();
    zip.addFile("syncfile.ini", Buffer.from(text, "utf8"));
    const zipped = join(dir, "content.zip");
    writeFileSync(zipped, zip.toBuffer());
    const expected = sample();
    expect(readContentFile(raw)).toEqual(expected);
    expect(readContentFile(bom)).toEqual(expected);
    expect(readContentFile(zipped)).toEqual(expected);
  });

  it("refuses a missing file, a non-JSON file, an empty zip and a zip of something that is not JSON", () => {
    expect(refusal(() => readContentFile(join(dir, "nope.json")))).toMatch(/^Cannot read the content file:/);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(refusal(() => readContentFile(bad))).toBe("The content file is neither a zip holding JSON nor a JSON file.");
    const empty = join(dir, "empty.zip");
    writeFileSync(empty, new AdmZip().toBuffer());
    expect(refusal(() => readContentFile(empty))).toBeTruthy();
    const notJson = new AdmZip();
    notJson.addFile("x.txt", Buffer.from("hello"));
    const zipped = join(dir, "text.zip");
    writeFileSync(zipped, notJson.toBuffer());
    expect(refusal(() => readContentFile(zipped))).toBe("The content file is neither a zip holding JSON nor a JSON file.");
  });
});
