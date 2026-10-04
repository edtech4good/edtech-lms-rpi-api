import { cloneDeep } from "lodash";
import { Op, UniqueConstraintError } from "sequelize";
import {
  curriculumbaseline,
  curriculums,
  documents,
  grades,
  lessonlearnings,
  lessonpracticequestions,
  lessonpractices,
  lessonquizquestions,
  lessonquizzes,
  lessons,
  levelquizquestions,
  levels,
  organisations,
  questions,
  schoolusers,
  students,
} from "src/models/data-models/init-models";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { countries } from "src/models/data-models/countries";
import { lessonplans } from "src/models/data-models/lessonplan";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { subjects } from "src/models/data-models/subjects";
import { Config, Logger } from "src/config";
import { Token } from "src/models/token.model";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * Organisations package, step 5c: `PUT /import/master` with a format-3 payload is a
 * scoped replace of ONE organisation's content.
 *
 * The database is an in-memory store (no database here): each model's `findAll`,
 * `count`, `destroy`, `bulkCreate` and `update` do to its rows what the real ones
 * do (an upsert overwrites ONLY the columns `updateOnDuplicate` lists; a school
 * name is unique; a rolled-back transaction restores what it began with). The proof
 * against a real database is the live run on a copy, written up with the change.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const ORG_X = "a1000000-0000-4000-8000-00000000000a";
const ORG_Y = "b2000000-0000-4000-8000-00000000000b";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Store = Record<string, Row[]>;

// ---------------------------------------------------------------- the fake database

const TABLES: Array<[string, any, string]> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  ["organisations", organisations, "organisationid"],
  ["schools", schools, "schoolid"],
  ["standards", standards, "standardid"],
  ["countries", countries, "countryid"],
  ["curriculums", curriculums, "curriculumid"],
  ["curriculumbaselines", curriculumbaseline, "curriculumbaselineid"],
  ["baselinequestion", baselinequestion, "baselinequestionid"],
  ["grades", grades, "gradeid"],
  ["levels", levels, "levelid"],
  ["lessons", lessons, "lessonid"],
  ["lessonlearnings", lessonlearnings, "lessonlearningid"],
  ["lessonplans", lessonplans, "lessonplanid"],
  ["lessonpractices", lessonpractices, "lessonpracticeid"],
  ["lessonquizzes", lessonquizzes, "lessonquizid"],
  ["lessonpracticequestions", lessonpracticequestions, "lessonpracticequestionid"],
  ["lessonquizquestions", lessonquizquestions, "lessonquizquestionid"],
  ["levelquizquestions", levelquizquestions, "levelquizquestionid"],
  ["questions", questions, "questionid"],
  ["documents", documents, "documentid"],
  ["subjects", subjects, "subjectid"],
  ["students", students, "studentid"],
  ["schoolusers", schoolusers, "schooluserid"],
];
const OWNED_TABLES = ["schools", "curriculums", "questions", "documents", "subjects"];

let store: Store;
let began: Store;
let writes: string[];
let queries: string[];
let logged: string[];
const tnx = { commit: jest.fn(), rollback: jest.fn() };

// What the column collation calls equal: case, trailing spaces, and the Khmer marks that have no weight.
const collate = (name: string) => name.trim().toLowerCase().replace(/[ំ៉់]/g, "");
const isNameWhere = (cond: unknown): cond is { logic: string; attribute: { constructor: { name: string } } } => typeof (cond as { logic?: unknown })?.logic === "string";
const nameMatches = (row: Row, part: { logic: string; attribute: { constructor: { name: string } } }) =>
  part.attribute?.constructor?.name === "Cast" ? row.schoolname === part.logic : collate(String(row.schoolname)) === collate(part.logic);

const matchesColumns = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (cond === null) return row[key] === null || row[key] === undefined;
    if (cond && typeof cond === "object" && (cond as Record<symbol, unknown>)[Op.in as unknown as symbol]) {
      return (cond as Record<symbol, string[]>)[Op.in as unknown as symbol].includes(String(row[key]));
    }
    return row[key] === cond;
  });
const matches = (row: Row, where: Row = {}): boolean => {
  const and = (where as Record<symbol, unknown[]>)[Op.and as unknown as symbol];
  if (and) return and.every((part) => (isNameWhere(part) ? nameMatches(row, part) : matches(row, part as Row)));
  return matchesColumns(row, where);
};

const install = (initial: Store) => {
  store = {};
  for (const [name] of TABLES) store[name] = cloneDeep(initial[name] ?? []);
  began = cloneDeep(store);
  writes = [];
  queries = [];
  for (const [name, model, pk] of TABLES) {
    jest.spyOn(model, "scope").mockReturnValue(model as never);
    jest.spyOn(model, "findAll").mockImplementation((async (opts: { where?: Row; attributes?: unknown } = {}) => {
      if (name === "students" || name === "schoolusers") {
        // the distinct school names of the rows that have no school id, as binary text (as the real query)
        const names = [...new Set(store[name].filter((r) => !r.schoolid && r.schoolname).map((r) => String(r.schoolname)))];
        return names.map((n) => ({ schoolname: Buffer.from(n, "utf8") }));
      }
      if (name === "schools" && typeof (opts.where as { logic?: string } | undefined)?.logic === "string") {
        const given = (opts.where as { logic: string }).logic;
        return cloneDeep(store.schools.filter((r) => collate(String(r.schoolname)) === collate(given))).map((r) => ({ isdeleted: false, ...r }));
      }
      const found = store[name].filter((r) => matches(r, opts.where));
      return cloneDeep(found).map((r) => (Array.isArray(opts.attributes) ? Object.fromEntries((opts.attributes as string[]).map((a) => [a, r[a] ?? null])) : r));
    }) as never);
    jest.spyOn(model, "findOne").mockImplementation((async (opts: { where?: Row } = {}) => {
      const found = store[name].find((r) => matches(r, opts.where));
      return found ? cloneDeep(found) : null;
    }) as never);
    jest.spyOn(model, "count").mockImplementation((async (opts: { where?: Row } = {}) => store[name].filter((r) => matches(r, opts.where)).length) as never);
    jest.spyOn(model, "destroy").mockImplementation((async (opts: { where?: Row } = {}) => {
      writes.push(`${name}.destroy`);
      const before = store[name].length;
      store[name] = store[name].filter((r) => !matches(r, opts.where));
      return before - store[name].length;
    }) as never);
    jest.spyOn(model, "update").mockImplementation((async (values: Row, opts: { where: Row }) => {
      writes.push(`${name}.update`);
      let n = 0;
      for (const r of store[name]) if (matches(r, opts.where)) { Object.assign(r, values); n += 1; }
      return [n];
    }) as never);
    jest.spyOn(model, "bulkCreate").mockImplementation((async (incoming: Row[], opts: { updateOnDuplicate?: string[] } = {}) => {
      writes.push(`${name}.bulkCreate`);
      for (const r of incoming ?? []) {
        const existing = store[name].find((e) => e[pk] === r[pk]);
        if (name === "schools") {
          const twin = store.schools.find((e) => e.schoolid !== r.schoolid && collate(e.schoolname) === collate(r.schoolname));
          if (twin) throw new UniqueConstraintError({ message: "Duplicate entry for key schoolname" });
        }
        if (existing) {
          // ON DUPLICATE KEY UPDATE: only the listed columns change
          for (const column of opts.updateOnDuplicate ?? []) if (column in r) existing[column] = r[column];
        } else {
          store[name].push({ ...cloneDeep(r), ...(OWNED_TABLES.includes(name) ? { organisationid: r.organisationid ?? null } : {}) });
        }
      }
      return [];
    }) as never);
  }
};

beforeEach(() => {
  logged = [];
  jest.spyOn(Logger, "info").mockImplementation(((m: unknown) => {
    logged.push(String(m));
    return Logger;
  }) as never);
  tnx.commit.mockResolvedValue(undefined);
  tnx.rollback.mockImplementation(async () => {
    store = cloneDeep(began); // a rolled-back transaction leaves what it began with
  });
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
  jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (sql: string) => {
    queries.push(sql);
    return [];
  }) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  (AdmZip as jest.Mock).mockReset();
});

// ---------------------------------------------------------------- fixtures

const server = { schooluserid: "server" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;
const mockZipContaining = (payload: unknown) =>
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from(JSON.stringify(payload)) }],
  }));

/** One organisation's whole chain of content, ids made from `tag` and `n`; Khmer names. */
const content = (tag: string, n: number, owner: string | null): Store => {
  const k = (kind: string) => `${tag}-${kind}-${n}`;
  const own = owner === null ? { organisationid: null } : { organisationid: owner };
  return {
    countries: [{ countryid: "c-kh", countryname: "កម្ពុជា", expectedusage: 1, isdeleted: false }],
    subjects: [{ subjectid: k("subject"), subjectname: "គណិតវិទ្យា", isdeleted: false, ...own }],
    curriculums: [{ curriculumid: k("cur"), curriculumname: "កម្មវិធីសិក្សា", subjectid: k("subject"), isdeleted: false, ...own }],
    questions: [
      { questionid: k("q1"), questiontext: "សំណួរ ១", isdeleted: false, ...own },
      { questionid: k("q2"), questiontext: "សំណួរ ២", isdeleted: false, ...own },
    ],
    documents: [{ documentid: k("doc"), documentname: "ឯកសារ", isdeleted: false, ...own }],
    schools: [{ schoolid: k("school"), schoolname: `សាលា ${tag}${n}`, countryid: "c-kh", isdeleted: false, ...own }],
    standards: [{ standardid: k("std"), standardname: "ថ្នាក់ទី១", schoolid: k("school") }],
    curriculumbaselines: [{ curriculumbaselineid: k("bl"), curriculumid: k("cur") }],
    baselinequestion: [{ baselinequestionid: k("blq"), curriculumbaselineid: k("bl"), questionid: k("q1") }],
    grades: [{ gradeid: k("grade"), curriculumid: k("cur") }],
    levels: [{ levelid: k("level"), gradeid: k("grade") }],
    lessons: [{ lessonid: k("lesson"), levelid: k("level") }],
    lessonlearnings: [{ lessonlearningid: k("ll"), lessonid: k("lesson"), documentid: k("doc") }],
    lessonplans: [{ lessonplanid: k("lp"), lessonid: k("lesson"), documentid: k("doc") }],
    lessonpractices: [{ lessonpracticeid: k("pr"), lessonid: k("lesson") }],
    lessonquizzes: [{ lessonquizid: k("qz"), lessonid: k("lesson") }],
    lessonpracticequestions: [{ lessonpracticequestionid: k("prq"), lessonpracticeid: k("pr"), questionid: k("q1") }],
    lessonquizquestions: [{ lessonquizquestionid: k("qzq"), lessonquizid: k("qz"), questionid: k("q2") }],
    levelquizquestions: [{ levelquizquestionid: k("lvq"), levelid: k("level"), questionid: k("q2"), lessonid: k("lesson") }],
  };
};

const merge = (...parts: Store[]): Store => {
  const out: Store = {};
  for (const part of parts) for (const [table, rows] of Object.entries(part)) out[table] = [...(out[table] ?? []), ...cloneDeep(rows)];
  return out;
};

const organisationRow = (organisationid: string, organisationcode: string, extra: Row = {}) => ({
  organisationid,
  organisationname: "អង្គការ",
  organisationcode,
  organisationstatus: true,
  uitheme: "kids",
  brandingconfig: null,
  settingsconfig: null,
  isdeleted: false,
  ...extra,
});

/** The format-3 payload for organisation X made of the given content. */
const payloadOf = (data: Store, over: Row = {}): Row => ({
  format: 3,
  organisationid: ORG_X,
  organisationcode: "xorg",
  scope: "organisation",
  organisations: [organisationRow(ORG_X, "xorg")],
  ...cloneDeep(data),
  ...over,
});

const dbBefore = (): Store => ({
  ...merge(content("x", 1, ORG_X), content("x", 3, ORG_X), content("y", 1, ORG_Y), content("u", 1, null)),
  // countries: the shared one (older name) and one the payload does not mention
  countries: [
    { countryid: "c-kh", countryname: "Old name", expectedusage: 0, isdeleted: false },
    { countryid: "c-th", countryname: "ថៃ", expectedusage: 5, isdeleted: false },
  ],
  organisations: [organisationRow(ORG_Y, "yorg")],
  students: [
    { studentid: "x-student-1", schoolname: "សាលា x1", schoolid: "x-school-1" },
    { studentid: "x-student-3", schoolname: "សាលា x3", schoolid: "x-school-3", curriculumid: "x-cur-3", gradeid: "x-grade-3" },
    { studentid: "y-student-1", schoolname: "សាលា y1", schoolid: "y-school-1" },
    { studentid: "u-student-1", schoolname: "សាលា u1", schoolid: "u-school-1" },
  ],
  schoolusers: [{ schooluserid: "y-login-1", schoolname: "សាលា y1", schoolid: "y-school-1" }],
});

/** Every row of every table that is not X's (countries, shared across organisations, are left out). */
const notX = (s: Store): Store => {
  const out: Store = {};
  for (const [table, rows] of Object.entries(s)) {
    if (table === "countries") continue;
    out[table] = rows.filter((r) => !String(Object.values(r)[0]).startsWith("x-") && r.organisationid !== ORG_X);
  }
  return cloneDeep(out);
};

const importIt = (payload: unknown, user: Token = server) => {
  mockZipContaining(payload);
  return new ImportController().completesync(file, user);
};

const owners = (table: string) => Object.fromEntries(store[table].map((r) => [Object.values(r)[0], r.organisationid]));
const ids = (table: string, pk: string) => store[table].map((r) => r[pk]).sort();

// ---------------------------------------------------------------- the import

describe("PUT /import/master with a format-3 payload", () => {
  describe("a new organisation", () => {
    it("is written in one transaction with every owner stored, FK checks off while it runs and back on after, and answers with the counts", async () => {
      install({});
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result).toMatchObject({ error: false, data: true, organisationid: ORG_X });
      expect(store.organisations.map((r) => [r.organisationid, r.organisationcode])).toEqual([[ORG_X, "xorg"]]);
      for (const table of OWNED_TABLES) {
        expect(new Set(Object.values(owners(table)))).toEqual(new Set([ORG_X]));
      }
      expect(store.grades.map((r) => r.gradeid)).toEqual(["x-grade-1"]);
      expect(store.lessonquizquestions).toHaveLength(1);
      expect(store.standards).toHaveLength(1);
      expect(result.counts.organisations.upserted).toBe(1);
      expect(result.counts.questions).toMatchObject({ deleted: 0, inserted: 2, adopted: 0 });
      expect(result.counts.schools).toMatchObject({ upserted: 1, markedDeleted: 0 });
      expect(result.counts.countries.upserted).toBe(1);
      expect(result.counts.grades.inserted).toBe(1);
      expect(queries[0]).toMatch(/FOREIGN_KEY_CHECKS = 0/);
      expect(queries[queries.length - 1]).toMatch(/FOREIGN_KEY_CHECKS = 1/);
      expect(tnx.commit).toHaveBeenCalledTimes(1);
      expect(tnx.rollback).not.toHaveBeenCalled();
    });

    it("an organisation row that is already here is updated, all its columns", async () => {
      install({ organisations: [organisationRow(ORG_X, "old", { organisationname: "Old", uitheme: "corporate", brandingconfig: { displayname: "Old" } })] });
      await importIt(payloadOf(content("x", 1, ORG_X), { organisations: [organisationRow(ORG_X, "xorg", { uitheme: "kids", brandingconfig: { displayname: "ថ្មី" } })] }));
      expect(store.organisations).toHaveLength(1);
      expect(store.organisations[0]).toMatchObject({ organisationcode: "xorg", organisationname: "អង្គការ", uitheme: "kids", brandingconfig: { displayname: "ថ្មី" } });
    });
  });

  describe("the replace is scoped to the organisation", () => {
    it("another organisation's content and unowned legacy content are byte-identical afterwards, in every table", async () => {
      install(dbBefore());
      const snapshot = notX(store);
      // X's payload now has only x2: owner-scoped rows are replaced by it ...
      await importIt(payloadOf(content("x", 2, ORG_X)));
      expect(notX(store)).toEqual(snapshot);
      expect(ids("questions", "questionid").filter((id) => id.startsWith("x-"))).toEqual(["x-q1-2", "x-q2-2"]);
      expect(ids("documents", "documentid").filter((id) => id.startsWith("x-"))).toEqual(["x-doc-2"]);
      expect(ids("subjects", "subjectid").filter((id) => id.startsWith("x-"))).toEqual(["x-subject-2"]);
      // ... and what hangs from the curricula that left the payload (x1, x3) stays where it is, next to x2's
      for (const [table, pk] of [["grades", "gradeid"], ["levels", "levelid"], ["lessons", "lessonid"], ["lessonlearnings", "lessonlearningid"], ["lessonplans", "lessonplanid"], ["lessonpractices", "lessonpracticeid"], ["lessonquizzes", "lessonquizid"], ["lessonpracticequestions", "lessonpracticequestionid"], ["lessonquizquestions", "lessonquizquestionid"], ["levelquizquestions", "levelquizquestionid"], ["curriculumbaselines", "curriculumbaselineid"], ["baselinequestion", "baselinequestionid"], ["standards", "standardid"]]) {
        expect(ids(table, pk).filter((id) => id.startsWith("x-")).map((id) => id.slice(-1))).toEqual(["1", "2", "3"]);
      }
      // Y's and the legacy rows are all still there (counted, not only compared)
      expect(ids("questions", "questionid").filter((id) => /^[yu]-/.test(id))).toEqual(["u-q1-1", "u-q2-1", "y-q1-1", "y-q2-1"]);
      expect(ids("grades", "gradeid").filter((id) => /^[yu]-/.test(id))).toEqual(["u-grade-1", "y-grade-1"]);
    });

    it("never destroys schools or countries, and never touches another organisation's row or an unowned one by a delete", async () => {
      install(dbBefore());
      await importIt(payloadOf(content("x", 2, ORG_X)));
      expect(writes).not.toContain("schools.destroy");
      expect(writes).not.toContain("countries.destroy");
      expect(writes).not.toContain("curriculums.destroy");
      expect(writes).not.toContain("organisations.destroy");
      expect(writes).not.toContain("students.destroy");
    });

    it("a school of the organisation that the payload no longer has is marked isdeleted, not destroyed, and its learners keep their school id", async () => {
      install(dbBefore());
      const learners = cloneDeep(store.students);
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      const x3 = store.schools.find((s) => s.schoolid === "x-school-3");
      expect(x3).toMatchObject({ isdeleted: true, organisationid: ORG_X });
      expect(store.schools.find((s) => s.schoolid === "x-school-1")).toMatchObject({ isdeleted: false });
      expect(store.students).toEqual(learners);
      // its standards stay with it: only the standards of schools IN the payload are replaced
      expect(store.standards.find((s) => s.standardid === "x-std-3")).toMatchObject({ schoolid: "x-school-3" });
      expect(result.counts.standards).toMatchObject({ deleted: 1, inserted: 1 });
      expect(result.counts.schools).toMatchObject({ upserted: 1, markedDeleted: 1 });
      // a school of another organisation, and an unowned one, are not marked
      expect(store.schools.find((s) => s.schoolid === "y-school-1")?.isdeleted).toBe(false);
      expect(store.schools.find((s) => s.schoolid === "u-school-1")?.isdeleted).toBe(false);
    });

    it("a school is upserted by id: the same id is the same school, with its new name and owner, never a second row", async () => {
      install(dbBefore());
      const renamed = content("x", 1, ORG_X);
      renamed.schools[0].schoolname = "សាលា ថ្មី";
      await importIt(payloadOf(renamed));
      expect(store.schools.filter((s) => s.schoolid === "x-school-1")).toHaveLength(1);
      expect(store.schools.find((s) => s.schoolid === "x-school-1")).toMatchObject({ schoolname: "សាលា ថ្មី", organisationid: ORG_X });
    });

    it("a curriculum missing from the payload is marked isdeleted and nothing under it is deleted: a learner's grade still resolves", async () => {
      install(dbBefore());
      const learners = cloneDeep(store.students);
      const below = ["grades", "levels", "lessons", "lessonlearnings", "lessonplans", "lessonpractices", "lessonquizzes", "lessonpracticequestions", "lessonquizquestions", "levelquizquestions", "curriculumbaselines", "baselinequestion"];
      const absentRows = Object.fromEntries(below.map((t) => [t, cloneDeep(store[t].filter((r) => String(Object.values(r)[0]).endsWith("-3")))]));
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(store.curriculums.find((c) => c.curriculumid === "x-cur-3")).toMatchObject({ isdeleted: true, organisationid: ORG_X });
      expect(store.curriculums.find((c) => c.curriculumid === "x-cur-1")).toMatchObject({ isdeleted: false });
      for (const t of below) {
        expect(store[t].filter((r) => String(Object.values(r)[0]).endsWith("-3"))).toEqual(absentRows[t]);
        expect(absentRows[t]).toHaveLength(1);
      }
      // the learner's grade and curriculum still name rows that exist
      const learner = store.students.find((s) => s.studentid === "x-student-3");
      expect(learner).toEqual(learners.find((s) => s.studentid === "x-student-3"));
      expect(store.grades.some((g) => g.gradeid === learner?.gradeid)).toBe(true);
      expect(store.curriculums.some((c) => c.curriculumid === learner?.curriculumid)).toBe(true);
      expect(store.curriculums.find((c) => c.curriculumid === "y-cur-1")?.isdeleted).toBe(false);
      expect(result.counts.curriculums).toMatchObject({ upserted: 1, markedDeleted: 1 });
      // only the children of the curriculum that IS in the payload were deleted and re-created
      expect(result.counts.grades).toMatchObject({ deleted: 1, inserted: 1 });
      expect(result.counts.lessonquizquestions).toMatchObject({ deleted: 1, inserted: 1 });
      // the owner-scoped tables are still replaced whole
      expect(result.counts.questions).toMatchObject({ deleted: 4, inserted: 2 });
    });

    it("an attach row of the absent curriculum keeps naming its question: the question is re-created by id, and if it left the payload the row is left dangling (package 7's export decides what is sent)", async () => {
      install(dbBefore());
      await importIt(payloadOf(content("x", 1, ORG_X)));
      // x-q2-3 is not in the payload, so it is gone; the absent curriculum's attach rows still point at it
      expect(store.questions.some((q) => q.questionid === "x-q2-3")).toBe(false);
      expect(store.lessonquizquestions.find((r) => r.lessonquizquestionid === "x-qzq-3")).toMatchObject({ questionid: "x-q2-3" });
      // a question that IS still in the payload keeps resolving
      install(dbBefore());
      const keep = content("x", 1, ORG_X);
      keep.questions.push({ questionid: "x-q2-3", questiontext: "kept", isdeleted: false, organisationid: ORG_X });
      await importIt(payloadOf(keep));
      expect(store.questions.some((q) => q.questionid === "x-q2-3")).toBe(true);
    });

    it("a payload child whose id is under a curriculum or school of this organisation that left the payload is replaced, not refused", async () => {
      install(dbBefore());
      const payload = content("x", 1, ORG_X);
      payload.grades.push({ gradeid: "x-grade-3", curriculumid: "x-cur-1" }); // was under the absent x-cur-3
      payload.standards.push({ standardid: "x-std-3", standardname: "ថ្នាក់ទី៣", schoolid: "x-school-1" }); // was under the absent x-school-3
      await expect(importIt(payloadOf(payload))).resolves.toMatchObject({ error: false });
      expect(store.grades.filter((g) => g.gradeid === "x-grade-3")).toEqual([{ gradeid: "x-grade-3", curriculumid: "x-cur-1" }]);
      expect(store.standards.find((s) => s.standardid === "x-std-3")).toMatchObject({ schoolid: "x-school-1" });
    });

    it("a grade that moves over from an absent curriculum brings its levels, lessons and the rest: they are replaced by the payload's, and a second identical import changes nothing", async () => {
      install(dbBefore());
      const payload = content("x", 1, ORG_X);
      payload.grades.push({ gradeid: "x-grade-3", curriculumid: "x-cur-1" }); // under the absent x-cur-3 now
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      // the payload carries no level, lesson, learning, plan, practice, quiz or attach row for it, so none is left hanging from it
      expect(store.grades.find((g) => g.gradeid === "x-grade-3")).toMatchObject({ curriculumid: "x-cur-1" });
      for (const [table, pk] of [["levels", "levelid"], ["lessons", "lessonid"], ["lessonlearnings", "lessonlearningid"], ["lessonplans", "lessonplanid"], ["lessonpractices", "lessonpracticeid"], ["lessonquizzes", "lessonquizid"], ["lessonpracticequestions", "lessonpracticequestionid"], ["lessonquizquestions", "lessonquizquestionid"], ["levelquizquestions", "levelquizquestionid"]]) {
        const xs = ids(table, pk).filter((id) => id.startsWith("x-"));
        expect(xs).toHaveLength(1);
        expect(xs[0]).toMatch(/-1$/);
      }
      expect(result.counts.levels.deleted).toBe(2);
      // (row order is not content: a row deleted and re-created moves to the end of the table)
      const canon = (st: Store) => Object.fromEntries(Object.entries(st).map(([t, rs]) => [t, rs.map((r) => JSON.stringify(r)).sort()]));
      const once = canon(store);
      await importIt(payloadOf(payload));
      expect(canon(store)).toEqual(once);
    });

    it("a school or curriculum that was already marked deleted is not counted as marked again", async () => {
      const before = dbBefore();
      before.schools.find((s) => s.schoolid === "x-school-3")!.isdeleted = true;
      install(before);
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.counts.schools.markedDeleted).toBe(0);
    });

    it("countries are upserted by id and never deleted: one the payload does not carry stays", async () => {
      install(dbBefore());
      await importIt(payloadOf(content("x", 1, ORG_X)));
      expect(store.countries.map((c) => [c.countryid, c.countryname]).sort()).toEqual([["c-kh", "កម្ពុជា"], ["c-th", "ថៃ"]]);
    });

    it("rows of an owned table with the same id and no owner are the organisation's: they take its owner, and are counted", async () => {
      install(dbBefore());
      const payload = content("x", 1, ORG_X);
      payload.questions.push({ questionid: "u-q1-1", questiontext: "adopted", isdeleted: false, organisationid: ORG_X });
      payload.questions.push({ questionid: "x-q9", questiontext: "សំណួរ ៩", isdeleted: false, organisationid: ORG_X });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(store.questions.find((q) => q.questionid === "u-q1-1")).toMatchObject({ organisationid: ORG_X, questiontext: "adopted" });
      expect(store.questions.find((q) => q.questionid === "u-q2-1")?.organisationid).toBeNull();
      expect(result.counts.questions.adopted).toBe(1);
    });

    it("a school or curriculum with the same id and no owner is the organisation's: it takes the owner and is counted", async () => {
      install(dbBefore());
      const payload = content("x", 1, ORG_X);
      payload.schools.push({ schoolid: "u-school-1", schoolname: "សាលា u 1 (renamed)", countryid: "c-kh", isdeleted: false, organisationid: ORG_X });
      payload.curriculums.push({ curriculumid: "u-cur-1", curriculumname: "adopted", isdeleted: false, organisationid: ORG_X });
      payload.standards.push({ standardid: "x-std-9", standardname: "ថ្នាក់ទី២", schoolid: "u-school-1" });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(store.schools.find((s) => s.schoolid === "u-school-1")).toMatchObject({ organisationid: ORG_X, schoolname: "សាលា u 1 (renamed)" });
      expect(store.curriculums.find((c) => c.curriculumid === "u-cur-1")).toMatchObject({ organisationid: ORG_X, curriculumname: "adopted" });
      expect(result.counts.schools.adopted).toBe(1);
      expect(result.counts.curriculums.adopted).toBe(1);
    });

    it("learners and logins pushed before their school get its id, the same fill the old import runs", async () => {
      const before = dbBefore();
      before.students.push({ studentid: "x-student-early", schoolname: "សាលា x1", schoolid: null });
      before.schoolusers.push({ schooluserid: "x-login-early", schoolname: "សាលា x1", schoolid: null });
      install(before);
      await importIt(payloadOf(content("x", 1, ORG_X)));
      expect(store.students.find((s) => s.studentid === "x-student-early")?.schoolid).toBe("x-school-1");
      expect(store.schoolusers.find((s) => s.schooluserid === "x-login-early")?.schoolid).toBe("x-school-1");
      expect(logged.some((l) => l.includes("students with no school id"))).toBe(true);
    });

    it("importing the same payload again changes nothing", async () => {
      install(dbBefore());
      await importIt(payloadOf(content("x", 1, ORG_X)));
      const once = cloneDeep(store);
      await importIt(payloadOf(content("x", 1, ORG_X)));
      expect(store).toEqual(once);
    });
  });

  describe("a file that cannot be applied is refused whole, with nothing written", () => {
    const refused = async (payload: Row, message: RegExp, state: Store = dbBefore()) => {
      install(state);
      const snapshot = cloneDeep(store);
      await expect(importIt(payload)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
      expect(store).toEqual(snapshot);
      expect(tnx.commit).not.toHaveBeenCalled();
      expect(tnx.rollback).toHaveBeenCalledTimes(1);
    };

    it("content that is already here under another organisation (a question, a curriculum)", async () => {
      const payload = content("x", 1, ORG_X);
      payload.questions.push({ questionid: "y-q1-1", isdeleted: false, organisationid: ORG_X });
      payload.curriculums.push({ curriculumid: "y-cur-1", curriculumname: "x", isdeleted: false, organisationid: ORG_X });
      await refused(payloadOf(payload), /another organisation here.*curriculums: 1 row already belongs.*questions: 1 row already belongs/);
      // refused from reads alone: not one write happened, so nothing needed undoing
      expect(writes).toEqual([]);
    });

    it("a school name that another school already has (the database says it is unique)", async () => {
      const taken = content("x", 1, ORG_X);
      taken.schools[0].schoolname = "សាលា y1";
      await refused(payloadOf(taken), /must be unique/);
    });

    it("a school of another organisation", async () => {
      const stolen = content("x", 1, ORG_X);
      stolen.schools.push({ schoolid: "y-school-1", schoolname: "other", countryid: "c-kh", isdeleted: false, organisationid: ORG_X });
      await refused(payloadOf(stolen), /schools: 1 row already belongs/);
    });

    it("a child row whose id is already used by another organisation's content (a grade under its curriculum)", async () => {
      const payload = content("x", 1, ORG_X);
      payload.grades[0].gradeid = "y-grade-1"; // exists, under Y's curriculum
      payload.levels[0].gradeid = "y-grade-1";
      await refused(payloadOf(payload), /grades: 1 row already exists here outside this organisation's content/);
    });

    it("a child row whose id is already used by unowned legacy content", async () => {
      const payload = content("x", 1, ORG_X);
      payload.lessons[0].lessonid = "u-lesson-1";
      payload.lessonlearnings[0].lessonid = "u-lesson-1";
      payload.lessonplans[0].lessonid = "u-lesson-1";
      payload.lessonpractices[0].lessonid = "u-lesson-1";
      payload.lessonquizzes[0].lessonid = "u-lesson-1";
      payload.levelquizquestions[0].lessonid = "u-lesson-1";
      await refused(payloadOf(payload), /lessons: 1 row already exists/);
    });
  });

  describe("a payload that does not hold together is refused before anything is written", () => {
    const invalid = async (payload: Row, message: RegExp) => {
      install(dbBefore());
      const snapshot = cloneDeep(store);
      await expect(importIt(payload)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
      expect(store).toEqual(snapshot);
      expect(writes).toEqual([]);
      expect(queries).toEqual([]);
      expect(tnx.commit).not.toHaveBeenCalled();
    };
    const base = () => payloadOf(content("x", 1, ORG_X));

    it("a scope other than organisation", async () => invalid({ ...base(), scope: "curriculum" }, /scope must be "organisation"/));
    it("no scope", async () => {
      const p = base();
      delete p.scope;
      await invalid(p, /scope must be/);
    });
    it("a bad organisation code", async () => {
      await invalid({ ...base(), organisationcode: "X Org!" }, /organisationcode must be 2 to 16/);
      await invalid({ ...base(), organisationcode: "x" }, /organisationcode must be 2 to 16/);
    });
    it("a header that is not a format-3 header", async () => {
      await invalid({ ...base(), format: 2 }, /format must be 3/);
      await invalid({ ...base(), organisationid: "not-a-uuid" }, /organisationid must be/);
      const p = base();
      delete p.organisationid;
      await invalid(p, /organisationid must be/);
    });
    it("an organisation row that is not the header's, or that is missing, or has a bad column", async () => {
      await invalid({ ...base(), organisations: [organisationRow(ORG_Y, "yorg")] }, /not the organisation named in the header/);
      await invalid({ ...base(), organisations: [organisationRow(ORG_X, "other")] }, /code is not the organisationcode/);
      await invalid({ ...base(), organisations: [] }, /exactly one row/);
      await invalid({ ...base(), organisations: [organisationRow(ORG_X, "xorg", { uitheme: "neon" })] }, /uitheme/);
    });
    it("a row that belongs to another organisation: the table and the number of rows are named", async () => {
      const p = content("x", 1, ORG_X);
      p.questions[0].organisationid = ORG_Y;
      p.questions[1].organisationid = ORG_Y;
      p.schools[0].organisationid = ORG_Y;
      await invalid(payloadOf(p), /questions: 2 rows belong to another organisation/);
      await expect(importIt(payloadOf(p))).rejects.toMatchObject({ fields: expect.arrayContaining([expect.objectContaining({ field: "schools" })]) });
    });
    it("an owned row with no owner", async () => {
      const p = content("x", 1, ORG_X);
      delete p.documents[0].organisationid;
      await invalid(payloadOf(p), /documents: 1 row carries no organisationid/);
    });
    it("an inherited row that carries another organisation's id", async () => {
      const p = content("x", 1, ORG_X);
      p.grades[0].organisationid = ORG_Y;
      await invalid(payloadOf(p), /grades: 1 row belongs to another organisation/);
    });
    it("an inherited row whose parent is not in the payload (a grade without its curriculum, a level without its grade, a standard without its school)", async () => {
      const p = content("x", 1, ORG_X);
      p.curriculums = [];
      await invalid(payloadOf(p), /grades: 1 row hangs from a curriculums row \(curriculumid\) that is not in the payload/);
      const q = content("x", 1, ORG_X);
      q.grades = [];
      await invalid(payloadOf(q), /levels: 1 row hangs from a grades row/);
      const r = content("x", 1, ORG_X);
      r.schools = [];
      await invalid(payloadOf(r), /standards: 1 row hangs from a schools row/);
      const s = content("x", 1, ORG_X);
      s.grades[0].curriculumid = "y-cur-1"; // another organisation's curriculum
      await invalid(payloadOf(s), /grades: 1 row hangs from a curriculums row/);
    });
    it("a row that points at a question, document, subject or country that is not in the payload", async () => {
      const p = content("x", 1, ORG_X);
      p.lessonquizquestions[0].questionid = "y-q1-1";
      await invalid(payloadOf(p), /lessonquizquestions: 1 row points at a questions row/);
      const q = content("x", 1, ORG_X);
      q.lessonlearnings[0].documentid = "y-doc-1";
      await invalid(payloadOf(q), /lessonlearnings: 1 row points at a documents row/);
      const r = content("x", 1, ORG_X);
      r.curriculums[0].subjectid = "y-subject-1";
      await invalid(payloadOf(r), /curriculums: 1 row points at a subjects row/);
      const s = content("x", 1, ORG_X);
      s.schools[0].countryid = "c-zz";
      await invalid(payloadOf(s), /schools: 1 row points at a countries row/);
    });
    it("learners or logins in the payload", async () => {
      await invalid({ ...base(), studentusers: [{ schooluserid: "u1" }] }, /studentusers: learners and logins are not part of a content payload/);
      await invalid({ ...base(), schoolusers: [] }, /schoolusers: learners and logins/);
      await invalid({ ...base(), students: [] }, /students: learners and logins/);
    });
    it("a table that is missing, not an array, or a key that does not belong", async () => {
      const p = base();
      delete p.questions;
      await invalid(p, /questions must be an array/);
      await invalid({ ...base(), documents: {} }, /documents must be an array/);
      await invalid({ ...base(), bonus: [] }, /bonus is not part of a content payload/);
    });
    it("a row without an id, or an id twice", async () => {
      const p = content("x", 1, ORG_X);
      delete p.levels[0].levelid;
      await invalid(payloadOf(p), /levels: 1 row has no valid levelid/);
      const q = content("x", 1, ORG_X);
      q.questions.push({ ...q.questions[0] });
      await invalid(payloadOf(q), /questions: 1 row repeats an id/);
      const r = content("x", 1, ORG_X);
      r.questions.push({ ...r.questions[0], questionid: r.questions[0].questionid.toUpperCase() });
      await invalid(payloadOf(r), /questions: 1 row repeats an id/);
    });
    it("reports every problem, not only the first", async () => {
      install({});
      const p = content("x", 1, ORG_X);
      p.questions[0].organisationid = ORG_Y;
      p.grades = [];
      const error = await importIt(payloadOf(p, { scope: "x" })).catch((e) => e);
      expect(error.status).toBe(400);
      expect(error.fields.map((f: { field: string }) => f.field).sort()).toEqual(["levels", "questions", "scope"]);
    });
  });

  describe("an old payload (no header, no owners) is still the old import", () => {
    it("is not read as format 3: it wipes every content table and rebuilds it", async () => {
      install(dbBefore());
      const legacy = { schools: [], questions: [], documents: [], subjects: [], curriculums: [], grades: [], countries: [] };
      await expect(importIt(legacy)).resolves.toEqual({ error: false, data: true });
      // the old import's whole-table deletes ran (it destroys other organisations' rows too: that is the old behaviour)
      expect(writes).toContain("questions.destroy");
      expect(store.questions).toEqual([]);
    });

    it("a payload that says format 2 and has no header is the old import too; any other format is refused, not guessed at", async () => {
      install(dbBefore());
      await expect(importIt({ format: 2, questions: [] })).resolves.toEqual({ error: false, data: true });
      install(dbBefore());
      await expect(importIt({ format: 4, questions: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/format must be 3/) });
      expect(writes).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- who may send it

describe("who may import one organisation's content", () => {
  const teacher = (claim: unknown): Token => ({ schooluserid: "t1", schoolusername: "teacher", organisationid: claim } as unknown as Token);

  it("a classroom teacher whose token names the organisation may; the content is applied", async () => {
    install({});
    await expect(importIt(payloadOf(content("x", 1, ORG_X)), teacher(ORG_X))).resolves.toMatchObject({ error: false, data: true, organisationid: ORG_X });
    expect(store.questions).toHaveLength(2);
  });

  it("the claim is compared without regard to letter case", async () => {
    install({});
    await expect(importIt(payloadOf(content("x", 1, ORG_X)), teacher(ORG_X.toUpperCase()))).resolves.toMatchObject({ error: false });
  });

  it("a teacher of another organisation is refused with a 403 and nothing is written, before the payload is even checked", async () => {
    install(dbBefore());
    const snapshot = cloneDeep(store);
    await expect(importIt(payloadOf(content("x", 1, ORG_X)), teacher(ORG_Y))).rejects.toMatchObject({ status: 403 });
    await expect(importIt({ ...payloadOf(content("x", 1, ORG_X)), scope: "bad" }, teacher(ORG_Y))).rejects.toMatchObject({ status: 403 });
    expect(store).toEqual(snapshot);
    expect(writes).toEqual([]);
    expect(tnx.commit).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], [""], [42]])("a token with no usable organisation claim (%p) is refused with a 403", async (claim) => {
    install({});
    await expect(importIt(payloadOf(content("x", 1, ORG_X)), teacher(claim))).rejects.toMatchObject({ status: 403 });
    expect(writes).toEqual([]);
  });

  describe("a classroom Pi whose schools have no organisation yet (a token with no claim)", () => {
    const originalOffline = Config.fortyk.api.rpi.offline;
    beforeEach(() => {
      Config.fortyk.api.rpi.offline = true;
    });
    afterEach(() => {
      Config.fortyk.api.rpi.offline = originalOffline;
    });
    const pi = (school: Record<string, unknown>, claim: unknown = null): Token => ({ schooluserid: "t1", schoolusername: "teacher", organisationid: claim, ...school } as unknown as Token);
    /** x-school-1 is here and has no owner yet; everything else as dbBefore. */
    const unownedSchoolDb = (): Store => {
      const before = dbBefore();
      before.schools.find((s) => s.schoolid === "x-school-1")!.organisationid = null;
      return before;
    };

    it("is allowed when its own school is unowned here and is a school of the payload: the school gains the owner", async () => {
      install(unownedSchoolDb());
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "x-school-1" })); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result).toMatchObject({ error: false, data: true, organisationid: ORG_X });
      expect(store.schools.find((s) => s.schoolid === "x-school-1")?.organisationid).toBe(ORG_X);
      expect(result.counts.schools.adopted).toBe(1);
      expect(logged.some((l) => /classroom bootstrap/.test(l))).toBe(true);
      expect(logged.filter((l) => /classroom bootstrap/.test(l)).join("")).not.toMatch(/សាលា|x-school-1/);
    });

    it("finds its school by name when the token has only a name (an older token)", async () => {
      install(unownedSchoolDb());
      await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi({ schoolname: "សាលា x1" }))).resolves.toMatchObject({ error: false });
      expect(store.schools.find((s) => s.schoolid === "x-school-1")?.organisationid).toBe(ORG_X);
    });

    it("is refused (403, nothing written) when its school already belongs to another organisation", async () => {
      install(dbBefore());
      const payload = content("x", 1, ORG_X);
      payload.schools.push({ schoolid: "y-school-1", schoolname: "សាលា y 1", countryid: "c-kh", isdeleted: false, organisationid: ORG_X });
      await expect(importIt(payloadOf(payload), pi({ schoolid: "y-school-1" }))).rejects.toMatchObject({ status: 403 });
      expect(writes).toEqual([]);
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("is refused when its school already belongs to the organisation (it should have the claim)", async () => {
      install(dbBefore());
      await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "x-school-1" }))).rejects.toMatchObject({ status: 403 });
      expect(writes).toEqual([]);
    });

    it("is refused when its school is not a school of the payload", async () => {
      install(dbBefore());
      await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "u-school-1" }))).rejects.toMatchObject({ status: 403 });
      expect(writes).toEqual([]);
    });

    it("is refused when it has no school, or its school is not here, or its name matches none", async () => {
      install(unownedSchoolDb());
      for (const school of [{}, { schoolid: "x-school-9" }, { schoolname: "Not Here" }]) {
        await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi(school))).rejects.toMatchObject({ status: 403 });
      }
      expect(writes).toEqual([]);
    });

    it("is judged AFTER the payload is validated: an invalid payload is a 400, not a 403", async () => {
      install(unownedSchoolDb());
      await expect(importIt({ ...payloadOf(content("x", 1, ORG_X)), scope: "bad" }, pi({ schoolid: "x-school-1" }))).rejects.toMatchObject({ status: 400 });
    });

    it("a token WITH a claim is still checked before the payload is read, and another organisation's claim is a 403", async () => {
      install(unownedSchoolDb());
      await expect(importIt({ ...payloadOf(content("x", 1, ORG_X)), scope: "bad" }, pi({ schoolid: "x-school-1" }, ORG_Y))).rejects.toMatchObject({ status: 403 });
    });

    it("a claim that is not an id is a 403 even when its school would qualify", async () => {
      install(unownedSchoolDb());
      await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "x-school-1" }, 42))).rejects.toMatchObject({ status: 403 });
    });

    it("online (not RPI_OFFLINE) a token with no claim is a 403 whatever its school", async () => {
      Config.fortyk.api.rpi.offline = false;
      install(unownedSchoolDb());
      await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "x-school-1" }))).rejects.toMatchObject({ status: 403 });
      await expect(importIt({ ...payloadOf(content("x", 1, ORG_X)), scope: "bad" }, pi({ schoolid: "x-school-1" }))).rejects.toMatchObject({ status: 403 });
      expect(writes).toEqual([]);
    });
  });

  it("a payload whose header names no organisation is a 403 for a teacher, and a 400 for central", async () => {
    install({});
    const noId = { ...payloadOf(content("x", 1, ORG_X)), organisationid: undefined };
    await expect(importIt(noId, teacher(ORG_X))).rejects.toMatchObject({ status: 403 });
    await expect(importIt(noId, server)).rejects.toMatchObject({ status: 400 });
  });

  it("central's server key may import any organisation's content", async () => {
    install(dbBefore());
    await expect(importIt(payloadOf(content("x", 2, ORG_X)), server)).resolves.toMatchObject({ organisationid: ORG_X });
  });

  it("an old payload is not subject to the claim: a teacher token with none still imports it (unchanged)", async () => {
    install({});
    await expect(importIt({ schools: [], questions: [] }, { schooluserid: "t1" } as Token)).resolves.toEqual({ error: false, data: true });
  });
});
