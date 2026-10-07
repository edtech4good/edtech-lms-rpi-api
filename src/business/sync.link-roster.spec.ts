import { cloneDeep } from "lodash";
import { Op } from "sequelize";
import { schoolusers, students } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { Logger } from "src/config";
import { SyncBusiness } from "./sync.business";

/**
 * Learners and logins are pushed before their school exists on a new classroom server, so they are written
 * with no `schoolid`. `linkRosterToSchools` (run at the end of every content import) gives each of them the
 * id of the school its `schoolname` names, once per distinct name, by the text rule every reader uses.
 *
 * The three tables are an in-memory store here (no database): the fake `findAll` and `update` do to the
 * columns involved what the real queries do, and the same import through the HTTP route is covered in
 * import.master.format3.spec.ts.
 */

const ORG_A = "0a000000-0000-4000-8000-00000000000a";
const ORG_B = "0b000000-0000-4000-8000-00000000000b";
const S = (n: number) => `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;
type Store = Record<"schools" | "students" | "schoolusers", Row[]>;

let store: Store;
let logged: string[];

// What the column collation calls equal: case, trailing spaces, and the Khmer marks that have no weight.
const collate = (name: string) => name.trim().toLowerCase().replace(/[ំ៉់]/g, "");

// A `where(cast(col("schoolname"), "BINARY"), name)` carries the exact name as `logic`: a BINARY compare is
// exact. The same where without the cast is a collation compare.
const isNameWhere = (cond: unknown): cond is { logic: string; attribute: { constructor: { name: string } } } =>
  typeof (cond as { logic?: unknown })?.logic === "string";
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
const matches = (row: Row, where: Row): boolean => {
  const and = (where as Record<symbol, unknown[]>)[Op.and as unknown as symbol];
  if (and) {
    return and.every((part) => (isNameWhere(part) ? nameMatches(row, part) : matches(row, part as Row)));
  }
  return matchesColumns(row, where);
};

const install = (initial: Store) => {
  store = cloneDeep(initial);
  // the school list `findSchoolIdByName` reads; a by-name narrowing gets the schools the column collation calls equal
  jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where?: { logic?: string } }) => {
    const given = opts?.where?.logic;
    const rows = typeof given === "string" ? store.schools.filter((r) => collate(String(r.schoolname)) === collate(given)) : store.schools;
    return cloneDeep(rows).map((r) => ({ isdeleted: false, ...r }));
  }) as never);
  for (const [model, key] of [[students, "students"], [schoolusers, "schoolusers"]] as const) {
    // the distinct school names of the rows that have no school id (as the binary text, like the real query)
    jest.spyOn(model, "findAll").mockImplementation((async () => {
      const names = [...new Set(store[key].filter((r) => !r.schoolid && r.schoolname).map((r) => String(r.schoolname)))];
      return names.map((n) => ({ schoolname: Buffer.from(n, "utf8") }));
    }) as never);
    jest.spyOn(model, "update").mockImplementation((async (values: Row, opts: { where: Row }) => {
      let n = 0;
      for (const r of store[key]) if (matches(r, opts.where)) { Object.assign(r, values); n += 1; }
      return [n];
    }) as never);
  }
};

beforeEach(() => {
  logged = [];
  jest.spyOn(Logger, "info").mockImplementation(((m: unknown) => {
    logged.push(String(m));
    return Logger;
  }) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
});

const link = () => new SyncBusiness({} as never).linkRosterToSchools();
const ids = (rows: Row[], pk: string) => Object.fromEntries(rows.map((r) => [r[pk], r.schoolid]));

const before = (): Store => ({
  schools: [
    { schoolid: S(1), schoolname: "School A", organisationid: ORG_A },
    { schoolid: S(2), schoolname: "School B", organisationid: ORG_B },
    { schoolid: S(9), schoolname: "School New", organisationid: ORG_A },
    { schoolid: S(11), schoolname: "School Twin", organisationid: ORG_A },
    { schoolid: S(12), schoolname: "school twin", organisationid: ORG_B },
  ],
  students: [
    { studentid: "n1", schoolname: "School New", schoolid: null },
    { studentid: "n2", schoolname: "School New ", schoolid: null }, // same name with a trailing space
    { studentid: "n3", schoolname: "School Unknown", schoolid: null },
    { studentid: "n4", schoolname: "School Twin", schoolid: null },
    { studentid: "n6", schoolname: "School Neំw", schoolid: null }, // the column collation calls it equal to "School New"; the text rule does not
    { studentid: "s1", schoolname: "School A", schoolid: S(1) },
  ],
  schoolusers: [
    { schooluserid: "nu1", schoolname: "School New", schoolid: null },
    { schooluserid: "nu3", schoolname: "School Unknown", schoolid: null },
    { schooluserid: "nu4", schoolname: "School Twin", schoolid: null },
  ],
});

describe("linkRosterToSchools: a roster that arrived before its school", () => {
  it("learners and logins written with no school id get it when their school is here", async () => {
    install(before());
    await link();
    expect(ids(store.students, "studentid")).toMatchObject({ n1: S(9), n2: S(9), s1: S(1) });
    // a different name that only the column collation calls the same is not given that school
    expect(ids(store.students, "studentid").n6).toBeNull();
    expect(ids(store.schoolusers, "schooluserid")).toMatchObject({ nu1: S(9) });
  });

  it("a name that matches no school, or more than one, is left empty, counted, and not named in the log", async () => {
    install(before());
    await link();
    expect(ids(store.students, "studentid")).toMatchObject({ n3: null, n4: null });
    expect(ids(store.schoolusers, "schooluserid")).toMatchObject({ nu3: null, nu4: null });
    const studentsLog = logged.find((l) => l.includes("students with no school id")) ?? "";
    expect(studentsLog).toContain("2 filled");
    expect(studentsLog).toContain("1 names skipped (not unique)");
    expect(studentsLog).toContain("2 names skipped (no school of that name)");
    expect(logged.find((l) => l.includes("schoolusers with no school id"))).toContain("1 filled");
    expect(logged.join("\n")).not.toMatch(/School (New|Twin|Unknown)/);
  });

  it("a row that already has a school id keeps it, even when a row with no id has the same school name", async () => {
    install({
      ...before(),
      students: [
        { studentid: "k1", schoolname: "School B", schoolid: S(1) }, // has an id (another school's: a stale name)
        { studentid: "k2", schoolname: "School B", schoolid: null }, // same name, no id
      ],
      schoolusers: [
        { schooluserid: "ku1", schoolname: "School B", schoolid: S(1) },
        { schooluserid: "ku2", schoolname: "School B", schoolid: null },
      ],
    });
    await link();
    expect(store.students.map((r) => [r.studentid, r.schoolid])).toEqual([["k1", S(1)], ["k2", S(2)]]);
    expect(store.schoolusers.map((r) => [r.schooluserid, r.schoolid])).toEqual([["ku1", S(1)], ["ku2", S(2)]]);
  });

  it("rows that already have a school id are never touched by it", async () => {
    install({
      ...before(),
      students: [{ studentid: "s1", schoolname: "School A", schoolid: S(1) }],
      schoolusers: [{ schooluserid: "su1", schoolname: "School A", schoolid: S(1) }],
    });
    await link();
    expect(students.update).not.toHaveBeenCalled();
    expect(schoolusers.update).not.toHaveBeenCalled();
    expect(logged.some((l) => l.includes("with no school id"))).toBe(false);
  });
});
