import { cloneDeep } from "lodash";
import { Op } from "sequelize";
import * as models from "src/models/data-models/init-models";
import { documents, questions, schoolusers, students } from "src/models/data-models/init-models";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { countries } from "src/models/data-models/countries";
import { lessonplans } from "src/models/data-models/lessonplan";
import { standards } from "src/models/data-models/standards";
import { subjects } from "src/models/data-models/subjects";
import { schools } from "src/models/data-models/school";
import { Token } from "src/models/token.model";
import { Logger } from "src/config";
import { dbinstance } from "src/services/dbservice";
import { ImportController } from "./import.controller";

/**
 * Organisations package, step 5b: what a master content import does to the owner
 * of each school, question, document and subject, and to the school each learner
 * and login points at.
 *
 * The import deletes every row of those four tables and re-creates them from the
 * payload. Before this step the new rows came back with no owner (the payload
 * carries none), so one sync erased every owner; and a school the payload carried
 * under a different id left its learners pointing at a school that no longer
 * existed. The six tables are an in-memory store here (no database): the fake
 * `destroy`, `bulkCreate` and `update` do exactly what the real ones do to the
 * columns involved, so the snapshot before and after shows what the sync changed.
 */
jest.mock("adm-zip");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

const ORG_A = "0a000000-0000-4000-8000-00000000000a";
const ORG_B = "0b000000-0000-4000-8000-00000000000b";
const ORG_C = "0c000000-0000-4000-8000-00000000000c";
const S = (n: number) => `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const Q = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const D = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;
type Store = Record<"schools" | "questions" | "documents" | "subjects" | "students" | "schoolusers", Row[]>;

const user = { schooluserid: "u1", schoolusername: "central" } as Token;
const file = { buffer: Buffer.from("mocked zip") } as Express.Multer.File;
const mockZipContaining = (payload: unknown) =>
  (AdmZip as jest.Mock).mockImplementation(() => ({
    getEntries: () => [{ header: { size: 10 }, getData: () => Buffer.from(JSON.stringify(payload)) }],
  }));

const TABLES = [
  { key: "schools", pk: "schoolid", model: schools },
  { key: "questions", pk: "questionid", model: questions },
  { key: "documents", pk: "documentid", model: documents },
  { key: "subjects", pk: "subjectid", model: subjects },
] as const;

let store: Store;
let events: string[];
const tnx = { commit: jest.fn(), rollback: jest.fn() };

// A `where(cast(col("schoolname"), "BINARY"), name)` carries the exact name as `logic`.
const isNameWhere = (cond: unknown): cond is { logic: string } => typeof (cond as { logic?: unknown })?.logic === "string";

const matches = (row: Row, where: Row): boolean => {
  const and = (where as Record<symbol, unknown[]>)[Op.and as unknown as symbol];
  if (and) {
    return and.every((part) => (isNameWhere(part) ? row.schoolname === part.logic : matches(row, part as Row)));
  }
  return matchesColumns(row, where);
};

const matchesColumns = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (cond === null) return row[key] === null || row[key] === undefined;
    if (cond && typeof cond === "object" && (cond as Record<symbol, unknown>)[Op.in as unknown as symbol]) {
      return ((cond as Record<symbol, string[]>)[Op.in as unknown as symbol]).includes(String(row[key]));
    }
    return row[key] === cond;
  });

const install = (initial: Store) => {
  store = cloneDeep(initial);
  events = [];
  // every model: deletes and inserts succeed and do nothing, unless it is one of the six below
  for (const model of [...Object.values(models), baselinequestion, countries, lessonplans, standards]) {
    const m = model as unknown as Record<string, unknown>;
    if (typeof m?.destroy === "function") jest.spyOn(model as never, "destroy").mockResolvedValue(0 as never);
    if (typeof m?.bulkCreate === "function") jest.spyOn(model as never, "bulkCreate").mockResolvedValue([] as never);
  }
  for (const t of TABLES) {
    const rows = () => store[t.key];
    jest.spyOn(t.model, "destroy").mockImplementation((async () => {
      events.push(`${t.key}.destroy`);
      const n = rows().length;
      store[t.key] = [];
      return n;
    }) as never);
    jest.spyOn(t.model, "bulkCreate").mockImplementation((async (incoming: Row[]) => {
      // a fresh INSERT: the columns the payload does not give are NULL
      for (const r of incoming) store[t.key].push({ ...r, organisationid: r.organisationid ?? null });
      return [];
    }) as never);
    jest.spyOn(t.model, "update").mockImplementation((async (values: Row, opts: { where: Row }) => {
      events.push(`${t.key}.update`);
      let n = 0;
      for (const r of rows()) if (matches(r, opts.where)) { Object.assign(r, values); n += 1; }
      return [n];
    }) as never);
    jest.spyOn(t.model, "scope").mockReturnValue({
      findAll: async () => cloneDeep(rows().filter((r) => r.organisationid !== null && r.organisationid !== undefined)),
    } as never);
  }
  // the school list the snapshot and the re-pointing read (plain, default scope); a by-name
  // narrowing (`TRIM(schoolname) = ?`) gets the schools the column collation calls equal.
  jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where?: { logic?: string } }) => {
    const given = opts?.where?.logic;
    const rows = typeof given === "string" ? store.schools.filter((r) => String(r.schoolname).trim().toLowerCase() === given.trim().toLowerCase()) : store.schools;
    return cloneDeep(rows).map((r) => ({ isdeleted: false, ...r }));
  }) as never);
  for (const model of [students, schoolusers]) {
    // the distinct school names of the rows that have no school id (as the binary text, like the real query)
    jest.spyOn(model, "findAll").mockImplementation((async () => {
      const names = [...new Set(store[model === students ? "students" : "schoolusers"].filter((r) => !r.schoolid && r.schoolname).map((r) => String(r.schoolname)))];
      return names.map((n) => ({ schoolname: Buffer.from(n, "utf8") }));
    }) as never);
    jest.spyOn(model, "update").mockImplementation((async (values: Row, opts: { where: Row }) => {
      let n = 0;
      for (const r of store[model === students ? "students" : "schoolusers"]) if (matches(r, opts.where)) { Object.assign(r, values); n += 1; }
      return [n];
    }) as never);
  }
};

let logged: string[];
beforeEach(() => {
  logged = [];
  jest.spyOn(Logger, "info").mockImplementation(((m: unknown) => {
    logged.push(String(m));
    return Logger;
  }) as never);
  tnx.commit.mockResolvedValue(undefined);
  tnx.rollback.mockResolvedValue(undefined);
  jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(tnx as never);
  jest.spyOn(dbinstance.getdbinstance(), "query").mockResolvedValue([] as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  (AdmZip as jest.Mock).mockReset();
});

const before = (): Store => ({
  schools: [
    { schoolid: S(1), schoolname: "School A", organisationid: ORG_A },
    { schoolid: S(2), schoolname: "School B", organisationid: ORG_B },
    { schoolid: S(3), schoolname: "School C", organisationid: null },
  ],
  questions: [
    { questionid: Q(1), organisationid: ORG_A },
    { questionid: Q(2), organisationid: ORG_B },
    { questionid: Q(3), organisationid: null },
  ],
  documents: [
    { documentid: D(1), organisationid: ORG_A },
    { documentid: D(2), organisationid: null },
  ],
  subjects: [{ subjectid: U(1), organisationid: ORG_B }],
  students: [
    { studentid: "s1", schoolname: "School A", schoolid: S(1) },
    { studentid: "s2", schoolname: "School B", schoolid: S(2) },
    { studentid: "s3", schoolname: "School C", schoolid: S(3) },
  ],
  schoolusers: [
    { schooluserid: "su1", schoolname: "School A", schoolid: S(1) },
    { schooluserid: "su2", schoolname: "School B", schoolid: S(2) },
  ],
});

// What central sends today: ids, names and content, and no `organisationid` on any row.
const payload = (over: Record<string, unknown[]> = {}) => ({
  schools: [
    { schoolid: S(1), schoolname: "School A" },
    { schoolid: S(2), schoolname: "School B" },
    { schoolid: S(3), schoolname: "School C" },
  ],
  questions: [{ questionid: Q(1) }, { questionid: Q(2) }, { questionid: Q(3) }],
  documents: [{ documentid: D(1) }, { documentid: D(2) }],
  subjects: [{ subjectid: U(1) }],
  ...over,
});

const owners = (rows: Row[], pk: string) => Object.fromEntries(rows.map((r) => [r[pk], r.organisationid]));

describe("PUT /import/master keeps the owner of every school and piece of content, and learners' school ids valid", () => {
  it("the four tables are deleted and re-created, and every owner is back on the row with its id", async () => {
    install(before());
    const snapshot = cloneDeep(store);
    mockZipContaining(payload());
    await expect(new ImportController().completesync(file, user)).resolves.toEqual({ error: false, data: true });

    // the four tables really were deleted and re-created
    expect(events.filter((e) => e.endsWith(".destroy")).sort()).toEqual(["documents.destroy", "questions.destroy", "schools.destroy", "subjects.destroy"]);
    for (const t of TABLES) {
      expect(owners(store[t.key], t.pk)).toEqual(owners(snapshot[t.key], t.pk));
    }
    // the learners and logins were not touched
    expect(store.students).toEqual(snapshot.students);
    expect(store.schoolusers).toEqual(snapshot.schoolusers);
    expect(tnx.commit).toHaveBeenCalledTimes(1);
  });

  it("an owner is never put on a row the payload did not carry, and a row that is new stays unowned", async () => {
    install(before());
    mockZipContaining(
      payload({
        schools: [{ schoolid: S(1), schoolname: "School A" }, { schoolid: S(9), schoolname: "School New" }],
        questions: [{ questionid: Q(1) }, { questionid: Q(8) }],
      }),
    );
    await new ImportController().completesync(file, user);
    expect(owners(store.schools, "schoolid")).toEqual({ [S(1)]: ORG_A, [S(9)]: null });
    expect(owners(store.questions, "questionid")).toEqual({ [Q(1)]: ORG_A, [Q(8)]: null });
  });

  it("an owner the payload itself carries wins over the one the row had", async () => {
    install(before());
    mockZipContaining(payload({ schools: [{ schoolid: S(1), schoolname: "School A", organisationid: ORG_C }, { schoolid: S(2), schoolname: "School B" }] }));
    await new ImportController().completesync(file, user);
    expect(owners(store.schools, "schoolid")).toEqual({ [S(1)]: ORG_C, [S(2)]: ORG_B });
  });

  it("an ownerless school stays ownerless, and a sync into an empty table creates rows with no owner", async () => {
    install({ ...before(), schools: [], questions: [] });
    mockZipContaining(payload());
    await new ImportController().completesync(file, user);
    expect(Object.values(owners(store.schools, "schoolid"))).toEqual([null, null, null]);
  });

  it("a school the payload carries under a new id takes over the learners, logins and owner of the old id, matched by name", async () => {
    install(before());
    const snapshot = cloneDeep(store);
    mockZipContaining(
      payload({
        schools: [
          { schoolid: S(1), schoolname: "School A" }, // unchanged id
          { schoolid: S(22), schoolname: "  school b " }, // School B under a new id
          // School C is no longer sent
        ],
      }),
    );
    await new ImportController().completesync(file, user);
    expect(store.students.map((r) => [r.studentid, r.schoolid])).toEqual([
      ["s1", S(1)],
      ["s2", S(22)],
      ["s3", S(3)], // its school is gone and nothing else has its name: left as it was
    ]);
    expect(store.schoolusers.map((r) => [r.schooluserid, r.schoolid])).toEqual([
      ["su1", S(1)],
      ["su2", S(22)],
    ]);
    // names are never rewritten
    expect(store.students.map((r) => r.schoolname)).toEqual(snapshot.students.map((r) => r.schoolname));
    // the school under its new id has the owner of the old one; School A is unchanged
    expect(owners(store.schools, "schoolid")).toEqual({ [S(1)]: ORG_A, [S(22)]: ORG_B });
  });

  it("a school under a new id keeps the owner the payload gave it, not the old one", async () => {
    install(before());
    mockZipContaining(payload({ schools: [{ schoolid: S(1), schoolname: "School A" }, { schoolid: S(22), schoolname: "School B", organisationid: ORG_C }] }));
    await new ImportController().completesync(file, user);
    expect(owners(store.schools, "schoolid")).toEqual({ [S(1)]: ORG_A, [S(22)]: ORG_C });
    expect(store.students.find((r) => r.studentid === "s2")?.schoolid).toBe(S(22));
  });

  describe("a roster that arrived before its school", () => {
    const early = (): Store => ({
      ...before(),
      students: [
        { studentid: "n1", schoolname: "School New", schoolid: null },
        { studentid: "n2", schoolname: "School New ", schoolid: null }, // same name with a trailing space
        { studentid: "n3", schoolname: "School Unknown", schoolid: null },
        { studentid: "n4", schoolname: "School Twin", schoolid: null },
        { studentid: "s1", schoolname: "School A", schoolid: S(1) },
      ],
      schoolusers: [
        { schooluserid: "nu1", schoolname: "School New", schoolid: null },
        { schooluserid: "nu3", schoolname: "School Unknown", schoolid: null },
        { schooluserid: "nu4", schoolname: "School Twin", schoolid: null },
      ],
    });
    const withNewSchool = () =>
      payload({
        schools: [
          { schoolid: S(1), schoolname: "School A" },
          { schoolid: S(9), schoolname: "School New" },
          { schoolid: S(11), schoolname: "School Twin" },
          { schoolid: S(12), schoolname: "school twin" },
        ],
      });

    it("learners and logins written with no school id get it when the master import brings their school", async () => {
      install(early());
      mockZipContaining(withNewSchool());
      await new ImportController().completesync(file, user);
      const ids = (rows: Row[], pk: string) => Object.fromEntries(rows.map((r) => [r[pk], r.schoolid]));
      expect(ids(store.students, "studentid")).toMatchObject({ n1: S(9), n2: S(9), s1: S(1) });
      expect(ids(store.schoolusers, "schooluserid")).toMatchObject({ nu1: S(9) });
    });

    it("a name that matches no school, or more than one, is left empty, counted, and not named in the log", async () => {
      install(early());
      mockZipContaining(withNewSchool());
      await new ImportController().completesync(file, user);
      const ids = (rows: Row[], pk: string) => Object.fromEntries(rows.map((r) => [r[pk], r.schoolid]));
      expect(ids(store.students, "studentid")).toMatchObject({ n3: null, n4: null });
      expect(ids(store.schoolusers, "schooluserid")).toMatchObject({ nu3: null, nu4: null });
      const studentsLog = logged.find((l) => l.includes("students with no school id")) ?? "";
      expect(studentsLog).toContain("2 filled");
      expect(studentsLog).toContain("1 names skipped (not unique)");
      expect(studentsLog).toContain("1 names skipped (no school of that name)");
      expect(logged.find((l) => l.includes("schoolusers with no school id"))).toContain("1 filled");
      expect(logged.join("\n")).not.toMatch(/School (New|Twin|Unknown)/);
    });

    it("rows that already have a school id are never touched by it", async () => {
      install(before());
      mockZipContaining(payload());
      await new ImportController().completesync(file, user);
      expect(students.update).not.toHaveBeenCalled();
      expect(logged.some((l) => l.includes("with no school id"))).toBe(false);
    });
  });

  it("a school id that did not change touches no learner at all", async () => {
    install(before());
    mockZipContaining(payload());
    await new ImportController().completesync(file, user);
    expect(students.update).not.toHaveBeenCalled();
    expect(schoolusers.update).not.toHaveBeenCalled();
  });

  it("the owners are restored inside the import's own transaction, and a failed commit rolls the whole sync back", async () => {
    install(before());
    mockZipContaining(payload());
    tnx.commit.mockRejectedValue(new Error("commit failed"));
    await expect(new ImportController().completesync(file, user)).rejects.toMatchObject({ status: 400 });
    expect(tnx.rollback).toHaveBeenCalledTimes(1);
    const restores = [schools, questions, documents, subjects].flatMap((m) => (m.update as jest.Mock).mock.calls);
    expect(restores.length).toBeGreaterThan(0);
    expect(restores.every((c) => c[1].transaction === tnx)).toBe(true);
  });
});
