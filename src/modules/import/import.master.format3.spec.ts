import { cloneDeep } from "lodash";
import { Op, UniqueConstraintError } from "sequelize";
import {
  curriculumbaseline,
  curriculums,
  documents,
  grades,
  lessonlearnings,
  lessonlearningdocuments,
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
import { OrganisationContentImport } from "src/business/organisation-content.business";
import { collateCountryName } from "src/test-support/country-names";
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
  ["lessonlearningdocuments", lessonlearningdocuments, "lessonlearningdocumentid"],
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
      if (name === "countries" && typeof (opts.where as { countryname?: unknown } | undefined)?.countryname === "string") {
        // `WHERE countryname = ?` compares under the column collation (approximated in src/test-support/country-names.ts)
        const given = (opts.where as { countryname: string }).countryname;
        const hits = store.countries.filter((r) => collateCountryName(r.countryname) === collateCountryName(given));
        return cloneDeep(hits).map((r) => (Array.isArray(opts.attributes) ? Object.fromEntries((opts.attributes as string[]).map((a) => [a, r[a] ?? null])) : r));
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
        if (name === "countries") {
          // INSERT ... ON DUPLICATE KEY UPDATE with TWO unique keys (the id, and `countryname` under the column collation):
          // a row that collides on EITHER key updates the row it collides with (the listed columns only; the id never
          // changes); a row that would make an update collide with a different row's name is refused.
          const byName = store.countries.find((e) => collateCountryName(e.countryname) === collateCountryName(r.countryname));
          const target = existing ?? byName;
          if (target) {
            const updated = { ...target };
            for (const column of opts.updateOnDuplicate ?? []) if (column in r) updated[column] = r[column];
            const clash = store.countries.find((e) => e !== target && collateCountryName(e.countryname) === collateCountryName(updated.countryname));
            if (clash) throw new UniqueConstraintError({ message: "Duplicate entry for key countryname" });
            Object.assign(target, updated);
          } else {
            store.countries.push(cloneDeep(r));
          }
          continue;
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
  jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (sql: string, opts?: { replacements?: { a: string; b: string } }) => {
    queries.push(sql);
    // the two things the country lookup asks MySQL: the column's collation, and whether two literals are equal under it
    if (/INFORMATION_SCHEMA/i.test(sql)) return [{ cs: "utf8mb4", coll: "utf8mb4_unicode_ci" }];
    if (/AS same$/i.test(sql.trim()) && opts?.replacements) return [{ same: collateCountryName(opts.replacements.a) === collateCountryName(opts.replacements.b) ? 1 : 0 }];
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
    lessonlearnings: [{ lessonlearningid: k("ll"), lessonid: k("lesson"), documentid: k("doc"), lessonlearningtype: "video", lessonlearningbody: null }],
    lessonlearningdocuments: [],
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
      expect(result.counts.organisations.written).toBe(1);
      expect(result.counts.questions).toEqual({ deleted: 0, written: 2, markedDeleted: 0 });
      expect(result.counts.schools).toMatchObject({ written: 1, markedDeleted: 0 });
      expect(result.counts.countries.written).toBe(1);
      expect(result.counts.grades.written).toBe(1);
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

  describe("every owned row is written with an owner (S4)", () => {
    it("a header that names no organisation refuses before anything is read or written", async () => {
      install({});
      const tx = tnx as never;
      for (const organisationid of ["", "   ", undefined, null]) {
        queries.length = 0;
        const run = new OrganisationContentImport(tx).run({ organisationid, organisationcode: "xorg", organisation: organisationRow(ORG_X, "xorg"), tables: {} } as never);
        await expect(run).rejects.toMatchObject({ status: 400, message: "The payload names no organisation. Nothing was written." });
        expect(queries.filter((q) => !/FOREIGN_KEY_CHECKS/.test(q))).toEqual([]);
        expect(store.organisations).toEqual([]);
      }
    });

    it("every owned row stored carries the header's organisation, and the counts have no `adopted` field", async () => {
      install({});
      const payload = content("x", 1, ORG_X);
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const table of OWNED_TABLES) {
        expect(store[table].length).toBeGreaterThan(0);
        expect(store[table].every((r) => r.organisationid === ORG_X)).toBe(true);
      }
      for (const counts of Object.values(result.counts)) expect(Object.keys(counts as object).sort()).toEqual(["deleted", "markedDeleted", "written"]);
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
      expect(result.counts.standards).toMatchObject({ deleted: 1, written: 1 });
      expect(result.counts.schools).toMatchObject({ written: 1, markedDeleted: 1 });
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
      expect(result.counts.curriculums).toMatchObject({ written: 1, markedDeleted: 1 });
      // only the children of the curriculum that IS in the payload were deleted and re-created
      expect(result.counts.grades).toMatchObject({ deleted: 1, written: 1 });
      expect(result.counts.lessonquizquestions).toMatchObject({ deleted: 1, written: 1 });
      // the owner-scoped tables are still replaced whole
      expect(result.counts.questions).toMatchObject({ deleted: 4, written: 2 });
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

    describe("lists of ids (schools.curriculums, curriculumbaselines.schoolid)", () => {
      it("an entry that names a row owned by another organisation here refuses the whole file, nothing written", async () => {
        install(dbBefore());
        const p = content("x", 1, ORG_X);
        p.schools[0].curriculums = ["x-cur-1", "y-cur-1"];
        await expect(importIt(payloadOf(p))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/schools\.curriculums: 1 entry names a row owned by another organisation/) });
        const q = content("x", 1, ORG_X);
        q.curriculumbaselines[0].schoolid = ["x-school-1", "y-school-1"];
        await expect(importIt(payloadOf(q))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/curriculumbaselines\.schoolid: 1 entry names a row owned by another organisation/) });
        expect(writes).toEqual([]);
        expect(tnx.commit).not.toHaveBeenCalled();
      });

      it("every other entry the payload does not carry (unowned here, existing nowhere, this organisation's own absent row) is dropped from the stored list, and counted without ids", async () => {
        install(dbBefore());
        const p = content("x", 1, ORG_X);
        p.schools[0].curriculums = ["u-cur-1", "x-cur-1", "no-such-curriculum", "x-cur-3"];
        p.curriculumbaselines[0].schoolid = ["u-school-1", "x-school-1", "no-such-school"];
        await importIt(payloadOf(p));
        expect(store.schools.find((s) => s.schoolid === "x-school-1")?.curriculums).toEqual(["x-cur-1"]);
        expect(store.curriculumbaselines.find((b) => b.curriculumbaselineid === "x-bl-1")?.schoolid).toEqual(["x-school-1"]);
        const line = logged.find((l) => /list entries not in the payload were dropped/.test(l)) ?? "";
        expect(line).toContain("schools.curriculums 3");
        expect(line).toContain("curriculumbaselines.schoolid 2");
        expect(line).not.toMatch(/u-cur-1|no-such|x-cur-3/);
      });

      it("a list that is already the payload-only subset, empty, or absent is stored as it is, with nothing logged", async () => {
        install({});
        const p = content("x", 1, ORG_X);
        p.schools[0].curriculums = ["x-cur-1"];
        p.curriculumbaselines[0].schoolid = null;
        await importIt(payloadOf(p));
        expect(store.schools[0].curriculums).toEqual(["x-cur-1"]);
        expect(store.curriculumbaselines[0].schoolid).toBeNull();
        expect(logged.some((l) => /list entries not in the payload/.test(l))).toBe(false);
      });
    });

    describe("a row that moves over from a curriculum that left the payload brings what hangs from it (at every level)", () => {
      // x-cur-3 is absent; the payload (x1) takes one of its rows into x1 and carries nothing under it
      const canon = (st: Store) => Object.fromEntries(Object.entries(st).map(([t, rs]) => [t, rs.map((r) => JSON.stringify(r)).sort()]));
      const moves = async (change: (p: Store) => void, gone: Array<[string, string, string]>) => {
        install(dbBefore());
        const payload = content("x", 1, ORG_X);
        change(payload);
        await importIt(payloadOf(payload));
        for (const [table, pk, id] of gone) {
          expect(store[table].some((r) => r[pk] === id)).toBe(false);
        }
        // the rest of the absent curriculum is untouched
        expect(store.curriculums.find((c) => c.curriculumid === "x-cur-3")).toMatchObject({ isdeleted: true });
        expect(store.grades.some((g) => g.gradeid === "x-grade-3")).toBe(true);
        const once = canon(store);
        await importIt(payloadOf(payload));
        expect(canon(store)).toEqual(once);
      };

      it("a level: its lessons and everything under them, and its level quiz rows, are gone", () =>
        moves((p) => p.levels.push({ levelid: "x-level-3", gradeid: "x-grade-1" }), [
          ["lessons", "lessonid", "x-lesson-3"],
          ["lessonlearnings", "lessonlearningid", "x-ll-3"],
          ["lessonplans", "lessonplanid", "x-lp-3"],
          ["lessonpractices", "lessonpracticeid", "x-pr-3"],
          ["lessonquizzes", "lessonquizid", "x-qz-3"],
          ["lessonpracticequestions", "lessonpracticequestionid", "x-prq-3"],
          ["lessonquizquestions", "lessonquizquestionid", "x-qzq-3"],
          ["levelquizquestions", "levelquizquestionid", "x-lvq-3"],
        ]));

      it("a lesson: its learnings, plans, practices, quizzes and their attach rows are gone", () =>
        moves((p) => p.lessons.push({ lessonid: "x-lesson-3", levelid: "x-level-1" }), [
          ["lessonlearnings", "lessonlearningid", "x-ll-3"],
          ["lessonplans", "lessonplanid", "x-lp-3"],
          ["lessonpractices", "lessonpracticeid", "x-pr-3"],
          ["lessonquizzes", "lessonquizid", "x-qz-3"],
          ["lessonpracticequestions", "lessonpracticequestionid", "x-prq-3"],
          ["lessonquizquestions", "lessonquizquestionid", "x-qzq-3"],
        ]));

      it("a practice: its practice questions are gone", () =>
        moves((p) => p.lessonpractices.push({ lessonpracticeid: "x-pr-3", lessonid: "x-lesson-1" }), [["lessonpracticequestions", "lessonpracticequestionid", "x-prq-3"]]));

      it("a quiz: its quiz questions are gone", () =>
        moves((p) => p.lessonquizzes.push({ lessonquizid: "x-qz-3", lessonid: "x-lesson-1" }), [["lessonquizquestions", "lessonquizquestionid", "x-qzq-3"]]));

      it("a baseline: its baseline questions are gone", () =>
        moves((p) => p.curriculumbaselines.push({ curriculumbaselineid: "x-bl-3", curriculumid: "x-cur-1" }), [["baselinequestion", "baselinequestionid", "x-blq-3"]]));
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

    it("learners and logins stored before S4 with no school id get it once the school is here (the repair step; since S4 none can be stored)", async () => {
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

  describe("a payload country whose name is here under another id (a server set up apart)", () => {
    // The payload (content("x", 1)) carries country c-kh "កម្ពុជា" and its school points at c-kh. This server has the
    // same country under a DIFFERENT id.
    const local = (over: Row = {}): Row => ({ countryid: "c-local", countryname: "កម្ពុជា", expectedusage: 7, isdeleted: false, ...over });
    const countriesWritten = () => writes.filter((w) => w === "countries.bulkCreate").length;

    it("is replaced by this server's row: the local id wins, the payload's row is never written, the school follows, and the answer says how many", async () => {
      install({ countries: [local()] });
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result).toMatchObject({ error: false, data: true, organisationid: ORG_X, countriesRehomed: 1 });
      expect(store.countries).toEqual([local()]); // one row, the local one, byte-identical (its expectedusage kept)
      expect(store.schools.map((s) => [s.schoolid, s.countryid])).toEqual([["x-school-1", "c-local"]]);
      expect(tnx.commit).toHaveBeenCalledTimes(1);
      // the existing counts keep their shape: the school and the country are both written
      expect(result.counts.schools).toEqual({ deleted: 0, written: 1, markedDeleted: 0 });
      expect(result.counts.countries).toEqual({ deleted: 0, written: 1, markedDeleted: 0 });
      expect(logged.some((l) => l.includes("1 payload country was replaced by a country of the same name"))).toBe(true);
      expect(logged.join("\n")).not.toContain("c-local");
    });

    it("every reference to the payload's id follows, and a country that does not collide is untouched", async () => {
      const payload = content("x", 1, ORG_X);
      const second = content("x", 3, ORG_X);
      second.schools[0].countryid = "c-th";
      payload.schools.push(second.schools[0]);
      payload.countries.push({ countryid: "c-th", countryname: "ថៃ", expectedusage: 5, isdeleted: false });
      payload.standards.push(second.standards[0]);
      install({ countries: [local(), { countryid: "c-th", countryname: "ថៃ", expectedusage: 5, isdeleted: false }] });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(1);
      expect(store.countries.map((c) => c.countryid).sort()).toEqual(["c-local", "c-th"]);
      expect(Object.fromEntries(store.schools.map((s) => [s.schoolid, s.countryid]))).toEqual({ "x-school-1": "c-local", "x-school-3": "c-th" });
    });

    it("two payload countries of the same name collapse onto the one local row, and both ids are rewritten", async () => {
      const payload = content("x", 1, ORG_X);
      const second = content("x", 3, ORG_X);
      second.schools[0].countryid = "c-kh-2";
      payload.schools.push(second.schools[0]);
      payload.standards.push(second.standards[0]);
      payload.countries.push({ countryid: "c-kh-2", countryname: "កម្ពុជា", expectedusage: 1, isdeleted: false });
      install({ countries: [local()] });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(2);
      expect(store.countries).toEqual([local()]);
      expect(Object.fromEntries(store.schools.map((s) => [s.schoolid, s.countryid]))).toEqual({ "x-school-1": "c-local", "x-school-3": "c-local" });
    });

    // "The same name" is the DATABASE's: `countries.countryname` is unique under utf8mb4_unicode_ci, and a write of a name that
    // collation calls equal to another row's does not fail, it UPDATES that row. The fake database approximates the collation
    // (src/test-support/country-names.ts: case, accents, trailing spaces and the Khmer marks ំ ៉ ់ are ignored; a leading space
    // and a missing Khmer vowel sign are not), checked by hand against MySQL 8.
    it("an accent, a case or a trailing-space difference is the same name (as MySQL says): the payload country is re-homed and the local row keeps its own spelling", async () => {
      const payload = content("x", 1, ORG_X);
      payload.countries[0].countryname = "CÔTE D'IVOIRE  ".normalize("NFD");
      install({ countries: [local({ countryname: "Cote d'Ivoire" })] });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(1);
      expect(store.countries).toEqual([local({ countryname: "Cote d'Ivoire" })]); // not renamed, expectedusage kept
      expect(store.schools[0].countryid).toBe("c-local");
    });

    it("the accent case with NO school pointing at the payload's country: the local country is still not renamed or overwritten (a write by id would have updated it silently)", async () => {
      const payload = content("x", 1, ORG_X);
      payload.countries[0].countryname = "Téstland";
      payload.schools[0].countryid = null;
      install({ countries: [local({ countryname: "Testland", expectedusage: 7 })] });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(1);
      expect(store.countries).toEqual([local({ countryname: "Testland", expectedusage: 7 })]);
    });

    it("a Khmer mark the collation gives no weight (៉) is the same name; a missing vowel sign (ា) is a different one", async () => {
      const ignorable = content("x", 1, ORG_X);
      ignorable.countries[0].countryname = "កម្ពុជ៉ា";
      install({ countries: [local()] });
      expect(((await importIt(payloadOf(ignorable))) as any).countriesRehomed).toBe(1); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(store.countries).toEqual([local()]);

      const different = content("x", 1, ORG_X);
      different.countries[0].countryname = "កម្ពុជ"; // MySQL: "កម្ពុជ" <> "កម្ពុជា" under utf8mb4_unicode_ci (and under 0900_ai_ci)
      install({ countries: [local()] });
      const result: any = await importIt(payloadOf(different)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(0);
      expect(store.countries.map((c) => c.countryid).sort()).toEqual(["c-kh", "c-local"]);
      expect(store.schools[0].countryid).toBe("c-kh");
    });

    it("a leading space is part of the name for the database: a different country, written by id", async () => {
      const payload = content("x", 1, ORG_X);
      payload.countries[0].countryname = " កម្ពុជា";
      install({ countries: [local()] });
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(0);
      expect(store.countries.map((c) => c.countryid).sort()).toEqual(["c-kh", "c-local"]);
    });

    it("two payload countries whose names the database calls equal, with no local match, are collapsed onto the first before anything is written", async () => {
      const payload = content("x", 1, ORG_X);
      const second = content("x", 3, ORG_X);
      payload.countries[0].countryname = "Newland";
      second.schools[0].countryid = "c-kh-2";
      payload.schools.push(second.schools[0]);
      payload.standards.push(second.standards[0]);
      payload.countries.push({ countryid: "c-kh-2", countryname: "NEWLÄND ", expectedusage: 4, isdeleted: false });
      install({});
      const result: any = await importIt(payloadOf(payload)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(1); // the second payload country was replaced by the first
      expect(store.countries).toEqual([{ countryid: "c-kh", countryname: "Newland", expectedusage: 1, isdeleted: false }]);
      expect(Object.fromEntries(store.schools.map((s) => [s.schoolid, s.countryid]))).toEqual({ "x-school-1": "c-kh", "x-school-3": "c-kh" });
      expect(logged.some((l) => l.includes("(1 onto another country of the payload)"))).toBe(true);
    });

    it("the local row is deleted: it is brought back (as the provisioning tool does), and the school points at it", async () => {
      install({ countries: [local({ isdeleted: true })] });
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(1);
      expect(store.countries).toEqual([local({ isdeleted: false })]);
      expect(store.schools[0].countryid).toBe("c-local");
      expect(logged.some((l) => l.includes("(1 brought back from deleted)"))).toBe(true);
    });

    it("the same id is upserted as before: renamed, nothing re-homed", async () => {
      install({ countries: [local({ countryid: "c-kh", countryname: "Old name" })] });
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(0);
      expect(store.countries).toEqual([{ countryid: "c-kh", countryname: "កម្ពុជា", expectedusage: 1, isdeleted: false }]);
      expect(store.schools[0].countryid).toBe("c-kh");
    });

    it("a name this server does not have is a new country, written by id", async () => {
      install({ countries: [local({ countryname: "ថៃ" })] });
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result.countriesRehomed).toBe(0);
      expect(store.countries.map((c) => [c.countryid, c.countryname]).sort()).toEqual([["c-kh", "កម្ពុជា"], ["c-local", "ថៃ"]]);
      expect(store.schools[0].countryid).toBe("c-kh");
    });

    it("importing the same payload again changes nothing, and says the same", async () => {
      install({ countries: [local()] });
      const first: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      const once = cloneDeep(store);
      const second: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(store).toEqual(once);
      expect(second.countriesRehomed).toBe(1);
      // a replace deletes and re-creates the content, so only the rows written (not those deleted) repeat
      const written = (r: any) => Object.fromEntries(Object.entries(r.counts).map(([k, v]: [string, any]) => [k, v.written])); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(written(second)).toEqual(written(first));
      expect(second.counts.countries).toEqual(first.counts.countries);
    });

    it("more than one country here has that name: refused whole, nothing written (a guess could attach the school to the wrong one)", async () => {
      const state = { countries: [local(), local({ countryid: "c-local-2" })] };
      install(state);
      const snapshot = cloneDeep(store);
      await expect(importIt(payloadOf(content("x", 1, ORG_X)))).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/More than one country here has the name of one of the payload's countries\. Nothing was written/),
      });
      expect(store).toEqual(snapshot);
      expect(writes).toEqual([]); // refused from reads alone
      expect(tnx.commit).not.toHaveBeenCalled();
    });

    it("a school that points at a country this server does not have is refused after the write, and the whole import is rolled back (the check can see a dangling id the foreign-key switch hides)", async () => {
      install({});
      // a country write that does nothing and says nothing: the school is then written pointing at nothing
      jest.spyOn(countries, "bulkCreate").mockImplementation((async () => []) as never);
      const snapshot = cloneDeep(store);
      await expect(importIt(payloadOf(content("x", 1, ORG_X)))).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/would point at a country this server does not have\. Nothing was written\. schools: 1 row points at a country \(countryid\) that is not here\./),
      });
      expect(store).toEqual(snapshot);
      expect(tnx.commit).not.toHaveBeenCalled();
      expect(tnx.rollback).toHaveBeenCalledTimes(1);
      expect(queries[queries.length - 1]).toMatch(/FOREIGN_KEY_CHECKS = 1/); // the session setting is put back on this path too
    });

    it("the post-write check looks at the payload's own schools only: a dangling school elsewhere (another organisation's) does not block the import and is left as it was", async () => {
      const before = dbBefore();
      before.schools.find((s) => s.schoolid === "y-school-1")!.countryid = "c-gone"; // already dangling, and not in the payload
      install(before);
      const result: any = await importIt(payloadOf(content("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(result).toMatchObject({ error: false, data: true });
      expect(store.schools.find((s) => s.schoolid === "y-school-1")!.countryid).toBe("c-gone");
      expect(tnx.commit).toHaveBeenCalledTimes(1);
    });

    it("a school with no country at all is fine: nothing to point at", async () => {
      const payload = content("x", 1, ORG_X);
      payload.schools[0].countryid = null;
      payload.countries = [];
      install({});
      await expect(importIt(payloadOf(payload))).resolves.toMatchObject({ countriesRehomed: 0 });
      expect(store.schools[0].countryid).toBeNull();
      expect(countriesWritten()).toBe(0);
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
      await invalid({ ...base(), format: 4 }, /format must be 3/);
      await invalid({ ...base(), format: "3" }, /format must be 3/);
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
    it("a list column that is not a list of ids (a school's curricula, a baseline's schools)", async () => {
      const r = content("x", 1, ORG_X);
      r.schools[0].curriculums = "x-cur-1"; // not a list
      await invalid(payloadOf(r), /schools: 1 row has a curriculums that is not a list of curriculums ids/);
      const q = content("x", 1, ORG_X);
      q.curriculumbaselines[0].schoolid = ["x-school-1", 7];
      await invalid(payloadOf(q), /curriculumbaselines: 1 row has a schoolid that is not a list of schools ids/);
    });
    it("lists that are all in the payload, empty, or absent are accepted", async () => {
      install({});
      const p = content("x", 1, ORG_X);
      p.schools[0].curriculums = ["x-cur-1"];
      p.curriculumbaselines[0].schoolid = ["x-school-1"];
      await expect(importIt(payloadOf(p))).resolves.toMatchObject({ error: false });
      const q = content("x", 1, ORG_X);
      q.schools[0].curriculums = [];
      q.curriculumbaselines[0].schoolid = null;
      await expect(importIt(payloadOf(q))).resolves.toMatchObject({ error: false });
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

  describe("format 2 is retired: a payload that is not one organisation's content is refused whole", () => {
    const RETIRED = "This server accepts one organisation's content (format 3). Export it from the admin and send it again.";
    /** The whole body of the refusal, and nothing read, opened or written. */
    const retired = async (payload: unknown, user: Token = server) => {
      install(dbBefore());
      const snapshot = cloneDeep(store);
      const error: any = await importIt(payload, user).catch((e) => e); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(error.status).toBe(400);
      expect(error.message).toBe(RETIRED);
      expect(store).toEqual(snapshot);
      expect(writes).toEqual([]);
      expect(queries).toEqual([]);
      expect(dbinstance.getdbinstance().transaction).not.toHaveBeenCalled();
      expect(tnx.commit).not.toHaveBeenCalled();
    };
    const legacy = () => ({ schools: [], questions: [], documents: [], subjects: [], curriculums: [], grades: [], countries: [] });

    it("the old whole-content payload (no header, no owners) is refused, and every content table is untouched", async () => {
      await retired(legacy());
    });

    it("a payload that names format 2 is refused, with or without the other keys of a header", async () => {
      await retired({ format: 2, questions: [] });
      await retired({ ...payloadOf(content("x", 1, ORG_X)), format: 2 });
    });

    it("a body that is not an object at all is refused the same way", async () => {
      await retired([]);
      await retired([legacy()]);
      await retired(null);
      await retired("format 3");
    });

    it("a teacher token is refused the same way, with or without an organisation claim", async () => {
      await retired(legacy(), { schooluserid: "t1" } as Token);
      await retired(legacy(), { schooluserid: "t1", organisationid: ORG_X } as unknown as Token);
    });

    it("a payload that claims format 3 but is malformed is still refused for what is wrong with it, not as format 2", async () => {
      install(dbBefore());
      await expect(importIt({ format: 4, questions: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/format must be 3/) });
      await expect(importIt({ format: 3, questions: [] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/scope must be/) });
      expect(writes).toEqual([]);
    });

    it("a file that is not JSON is the same 'Invalid file' as before", async () => {
      install(dbBefore());
      (AdmZip as jest.Mock).mockImplementation(() => ({
        getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from("not json {") }],
      }));
      await expect(new ImportController().completesync(file, server)).rejects.toMatchObject({ status: 400, response: { errormessage: "Invalid file" } });
      expect(writes).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- who may send it

// ---------------------------------------------------------------- learning items (LI-2)

/** An item's second document and the link row that names it, for organisation `owner`'s content `tag`-`n`. */
const itemsOf = (tag: string, n: number, owner: string | null): Store => {
  const k = (kind: string) => `${tag}-${kind}-${n}`;
  const own = owner === null ? { organisationid: null } : { organisationid: owner };
  return {
    documents: [{ documentid: k("docb"), documentname: "វីដេអូទីពីរ", isdeleted: false, ...own }],
    lessonlearningdocuments: [
      { lessonlearningdocumentid: k("lld"), lessonlearningid: k("ll"), documentid: k("docb"), lessonlearningdocumentrole: "asset", lessonlearningdocumentorder: 1 },
    ],
  };
};
const withItems = (tag: string, n: number, owner: string | null): Store => merge(content(tag, n, owner), itemsOf(tag, n, owner));
const dbWithItems = (): Store => ({
  ...merge(withItems("x", 1, ORG_X), withItems("x", 3, ORG_X), withItems("y", 1, ORG_Y), withItems("u", 1, null)),
  countries: dbBefore().countries,
  organisations: [organisationRow(ORG_Y, "yorg")],
  students: [],
  schoolusers: [],
});
const calls = (model: unknown): number[] => (jest.mocked((model as { bulkCreate: never }).bulkCreate) as jest.Mock).mock.calls.map((c) => (c[0] as unknown[]).length);

describe("learning items: the type and body of a learning, and its link rows", () => {
  it("a payload with a link row round-trips: the learning keeps its type and body, the link row is written with its role and order, and the counts say so", async () => {
    install({});
    const result: any = await importIt(payloadOf(withItems("x", 1, ORG_X))); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(store.lessonlearnings).toEqual([
      { lessonlearningid: "x-ll-1", lessonid: "x-lesson-1", documentid: "x-doc-1", lessonlearningtype: "video", lessonlearningbody: null },
    ]);
    expect(store.lessonlearningdocuments).toEqual(itemsOf("x", 1, ORG_X).lessonlearningdocuments);
    expect(result.counts.lessonlearningdocuments).toEqual({ deleted: 0, written: 1, markedDeleted: 0 });
    expect(result.counts.lessonlearnings).toEqual({ deleted: 0, written: 1, markedDeleted: 0 });
    // the upsert lists carry the new columns (an upsert overwrites ONLY the columns listed)
    const learningUpdate = (lessonlearnings.bulkCreate as jest.Mock).mock.calls[0][1].updateOnDuplicate;
    expect(learningUpdate).toEqual(expect.arrayContaining(["lessonlearningtype", "lessonlearningbody", "documentid"]));
    expect((lessonlearningdocuments.bulkCreate as jest.Mock).mock.calls[0][1].updateOnDuplicate).toEqual([
      "lessonlearningid", "documentid", "lessonlearningdocumentrole", "lessonlearningdocumentorder",
    ]);
  });

  it("a second import replaces the link rows: none stale, none duplicated, and the same payload again changes nothing", async () => {
    install({});
    await importIt(payloadOf(withItems("x", 1, ORG_X)));
    const second = withItems("x", 1, ORG_X);
    second.lessonlearningdocuments = [
      { lessonlearningdocumentid: "x-lld-new", lessonlearningid: "x-ll-1", documentid: "x-docb-1", lessonlearningdocumentrole: "rendition", lessonlearningdocumentorder: 2 },
    ];
    const result: any = await importIt(payloadOf(second)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(store.lessonlearningdocuments.map((r) => r.lessonlearningdocumentid)).toEqual(["x-lld-new"]);
    expect(result.counts.lessonlearningdocuments).toEqual({ deleted: 1, written: 1, markedDeleted: 0 });
    const once = cloneDeep(store);
    await importIt(payloadOf(second));
    expect(store).toEqual(once);
  });

  it("an organisation that now has no link rows loses the ones it had", async () => {
    install(dbWithItems());
    await importIt(payloadOf(content("x", 1, ORG_X)));
    expect(store.lessonlearningdocuments.map((r) => r.lessonlearningdocumentid).sort()).toEqual(["u-lld-1", "x-lld-3", "y-lld-1"]);
  });

  it("deletes a lesson's link rows BEFORE its learnings (with foreign keys unchecked nothing cascades)", async () => {
    install(dbWithItems());
    await importIt(payloadOf(withItems("x", 1, ORG_X)));
    expect(writes.indexOf("lessonlearningdocuments.destroy")).toBeGreaterThanOrEqual(0);
    expect(writes.indexOf("lessonlearningdocuments.destroy")).toBeLessThan(writes.indexOf("lessonlearnings.destroy"));
    // and the link rows are written after the learnings they hang from
    expect(writes.indexOf("lessonlearnings.bulkCreate")).toBeLessThan(writes.indexOf("lessonlearningdocuments.bulkCreate"));
  });

  it("is scoped: another organisation's link rows and an unowned one are byte-identical afterwards, and the link rows of a curriculum that left the payload stay", async () => {
    install(dbWithItems());
    const snapshot = notX(store);
    await importIt(payloadOf(withItems("x", 2, ORG_X)));
    expect(notX(store)).toEqual(snapshot);
    expect(store.lessonlearningdocuments.map((r) => r.lessonlearningdocumentid).sort()).toEqual(["u-lld-1", "x-lld-1", "x-lld-2", "x-lld-3", "y-lld-1"]);
  });

  it("a link row whose id is under a curriculum of this organisation that left the payload is replaced, not refused", async () => {
    install(dbWithItems());
    const payload = withItems("x", 1, ORG_X);
    payload.lessonlearningdocuments[0].lessonlearningdocumentid = "x-lld-3"; // exists, under x-ll-3 of an absent curriculum
    await importIt(payloadOf(payload));
    expect(store.lessonlearningdocuments.find((r) => r.lessonlearningdocumentid === "x-lld-3")).toMatchObject({ lessonlearningid: "x-ll-1" });
  });

  it("a link row whose id is already used by another organisation's content refuses the whole file, nothing written", async () => {
    install(dbWithItems());
    const snapshot = cloneDeep(store);
    const payload = withItems("x", 1, ORG_X);
    payload.lessonlearningdocuments[0].lessonlearningdocumentid = "y-lld-1";
    await expect(importIt(payloadOf(payload))).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/lessonlearningdocuments: 1 row already exists here outside this organisation's content/),
    });
    expect(store).toEqual(snapshot);
    expect(tnx.commit).not.toHaveBeenCalled();
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
  });

  it("an unowned link row's id is refused the same way", async () => {
    install(dbWithItems());
    const payload = withItems("x", 1, ORG_X);
    payload.lessonlearningdocuments[0].lessonlearningdocumentid = "u-lld-1";
    await expect(importIt(payloadOf(payload))).rejects.toMatchObject({
      message: expect.stringMatching(/lessonlearningdocuments: 1 row already exists here outside this organisation's content/),
    });
  });

  it("writes learnings 25 at a time and link rows 1000 at a time", async () => {
    install({});
    const big = withItems("x", 1, ORG_X);
    big.lessonlearnings = Array.from({ length: 60 }, (_, i) => ({
      lessonlearningid: `x-ll-${i}`, lessonid: "x-lesson-1", documentid: "x-doc-1", lessonlearningorder: i + 1, lessonlearningtype: "video", lessonlearningbody: null,
    }));
    big.documents = [...big.documents, ...Array.from({ length: 2500 }, (_, i) => ({ documentid: `x-d-${i}`, documentname: `ឯកសារ ${i}`, isdeleted: false, organisationid: ORG_X }))];
    big.lessonlearningdocuments = Array.from({ length: 2500 }, (_, i) => ({
      lessonlearningdocumentid: `x-lld-${i}`, lessonlearningid: "x-ll-0", documentid: `x-d-${i}`, lessonlearningdocumentrole: "asset", lessonlearningdocumentorder: i,
    }));
    await importIt(payloadOf(big));
    expect(calls(lessonlearnings)).toEqual([25, 25, 10]);
    expect(calls(lessonlearningdocuments)).toEqual([1000, 1000, 500]);
    expect(store.lessonlearningdocuments).toHaveLength(2500);
    expect(store.lessonlearnings).toHaveLength(60);
  });

  describe("refused before anything is written", () => {
    const invalid = async (payload: Row, message: RegExp) => {
      install(dbWithItems());
      const snapshot = cloneDeep(store);
      await expect(importIt(payload)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
      expect(store).toEqual(snapshot);
      expect(writes).toEqual([]);
      expect(queries).toEqual([]);
      expect(tnx.commit).not.toHaveBeenCalled();
    };
    const base = () => withItems("x", 1, ORG_X);

    it("a payload WITHOUT lessonlearningdocuments (a pre-learning-items export): the validator's own message", async () => {
      const p = payloadOf(base());
      delete p.lessonlearningdocuments;
      await invalid(p, /^lessonlearningdocuments must be an array \(an empty one if the organisation has none\)\.$/);
    });

    it("a learning of a type this server does not know", async () => {
      const p = base();
      p.lessonlearnings[0].lessonlearningtype = "hologram";
      await invalid(payloadOf(p), /^lessonlearnings: 1 row has a lessonlearningtype this server does not know \(it knows: video\)\.$/);
    });

    it("a learning with no type at all", async () => {
      const p = base();
      delete p.lessonlearnings[0].lessonlearningtype;
      await invalid(payloadOf(p), /^lessonlearnings: 1 row has no lessonlearningtype \(a string\)\.$/);
    });

    it("a video with a body", async () => {
      const p = base();
      p.lessonlearnings[0].lessonlearningbody = { v: 1 };
      await invalid(payloadOf(p), /^lessonlearnings: 1 row of type video has a lessonlearningbody, which must be null for a video\.$/);
    });

    it("a video with no document", async () => {
      const p = base();
      p.lessonlearnings[0].documentid = null;
      await invalid(payloadOf(p), /^lessonlearnings: 1 row has no documentid, and the type of the item needs one\.$/);
    });

    it("a link row naming a document that is not in the payload", async () => {
      const p = base();
      p.lessonlearningdocuments[0].documentid = "y-doc-1"; // exists here, another organisation's
      await invalid(payloadOf(p), /^lessonlearningdocuments: 1 row points at a documents row \(documentid\) that is not in the payload\.$/);
    });

    it("a link row with no learning in the payload", async () => {
      const p = base();
      p.lessonlearningdocuments[0].lessonlearningid = "x-ll-gone";
      await invalid(payloadOf(p), /^lessonlearningdocuments: 1 row hangs from a lessonlearnings row \(lessonlearningid\) that is not in the payload\.$/);
    });

    it("a link row with an unknown role, a fractional order, or a repeated learning-and-document pair", async () => {
      const p = base();
      p.lessonlearningdocuments = [
        { ...p.lessonlearningdocuments[0], lessonlearningdocumentrole: "poster" },
        { ...p.lessonlearningdocuments[0], lessonlearningdocumentid: "x-lld-b", lessonlearningdocumentorder: 1.5 },
        { ...p.lessonlearningdocuments[0], lessonlearningdocumentid: "x-lld-c" },
      ];
      await invalid(
        payloadOf(p),
        /lessonlearningdocuments: 1 row has a lessonlearningdocumentrole that is not one of rendition, asset\. lessonlearningdocuments: 1 row has a lessonlearningdocumentorder that is not a whole number\. lessonlearningdocuments: 2 rows repeat a lessonlearningid and documentid pair/,
      );
    });
  });
});

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

  describe("a token with no organisation claim is refused on a classroom Pi as much as online (no bootstrap)", () => {
    const originalOffline = Config.fortyk.api.rpi.offline;
    afterEach(() => {
      Config.fortyk.api.rpi.offline = originalOffline;
    });
    const pi = (school: Record<string, unknown>, claim: unknown = null): Token => ({ schooluserid: "t1", schoolusername: "teacher", organisationid: claim, ...school } as unknown as Token);
    /** x-school-1 is here and has no owner (a database from before owners were required); everything else as dbBefore. */
    const unownedSchoolDb = (): Store => {
      const before = dbBefore();
      before.schools.find((s) => s.schoolid === "x-school-1")!.organisationid = null;
      return before;
    };
    const refusedWhole = async (payload: unknown, user: Token) => {
      const snapshot = cloneDeep(store);
      await expect(importIt(payload, user)).rejects.toMatchObject({ status: 403 });
      expect(store).toEqual(snapshot);
      expect(writes).toEqual([]);
      expect(queries).toEqual([]);
      expect(tnx.commit).not.toHaveBeenCalled();
    };

    it.each([[true], [false]])("a teacher with no claim whose own school is unowned here and in the payload is a 403, nothing written (RPI_OFFLINE=%p)", async (offline) => {
      Config.fortyk.api.rpi.offline = offline;
      install(unownedSchoolDb());
      await refusedWhole(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "x-school-1" }));
      expect(store.schools.find((s) => s.schoolid === "x-school-1")?.organisationid).toBeNull();
    });

    it("the same by school name only (an older token), and with no organisationid key at all", async () => {
      Config.fortyk.api.rpi.offline = true;
      install(unownedSchoolDb());
      await refusedWhole(payloadOf(content("x", 1, ORG_X)), pi({ schoolname: "សាលា x1" }));
      await refusedWhole(payloadOf(content("x", 1, ORG_X)), { schooluserid: "t1", schoolusername: "teacher", schoolid: "x-school-1" } as unknown as Token);
    });

    it("no claim and no school at all, a school that is not here, or one that belongs to the organisation or another one: 403", async () => {
      Config.fortyk.api.rpi.offline = true;
      install(dbBefore());
      for (const school of [{}, { schoolid: "x-school-9" }, { schoolname: "Not Here" }, { schoolid: "x-school-1" }, { schoolid: "y-school-1" }, { schoolid: "u-school-1" }]) {
        await refusedWhole(payloadOf(content("x", 1, ORG_X)), pi(school));
      }
    });

    it("is judged before the payload is read: a payload that is not even valid is a 403 too, so nothing about it is told", async () => {
      Config.fortyk.api.rpi.offline = true;
      install(unownedSchoolDb());
      await refusedWhole({ ...payloadOf(content("x", 1, ORG_X)), scope: "bad" }, pi({ schoolid: "x-school-1" }));
    });

    it("another organisation's claim is a 403 before the payload is read", async () => {
      Config.fortyk.api.rpi.offline = true;
      install(unownedSchoolDb());
      await refusedWhole({ ...payloadOf(content("x", 1, ORG_X)), scope: "bad" }, pi({ schoolid: "x-school-1" }, ORG_Y));
    });

    it("an empty-string claim, or any claim that is not an organisation id, is a 403 even when its school would qualify", async () => {
      Config.fortyk.api.rpi.offline = true;
      install(unownedSchoolDb());
      for (const claim of ["", "  ", "not-a-uuid", ORG_X.slice(1), 42]) {
        await refusedWhole(payloadOf(content("x", 1, ORG_X)), pi({ schoolid: "x-school-1" }, claim));
      }
    });

    it("a token whose claim is the organisation is still read on a Pi, whatever its school", async () => {
      Config.fortyk.api.rpi.offline = true;
      install(dbBefore());
      await expect(importIt(payloadOf(content("x", 1, ORG_X)), pi({}, ORG_X))).resolves.toMatchObject({ error: false, organisationid: ORG_X });
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

  it("an old payload is refused as format 2 for a teacher with no claim too: the payload is not read, the claim rule is not what answers", async () => {
    install({});
    await expect(importIt({ schools: [], questions: [] }, { schooluserid: "t1" } as Token)).rejects.toMatchObject({
      status: 400,
      message: "This server accepts one organisation's content (format 3). Export it from the admin and send it again.",
    });
    expect(writes).toEqual([]);
  });
});
