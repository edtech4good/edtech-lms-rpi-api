import { Sequelize } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { initModels } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import {
  findSchoolIdByName,
  isSameSchoolName,
  normaliseSchoolName,
  resolveSchoolRef,
  resolveSchoolScope,
  schoolOfStudent,
  schoolPredicate,
  schoolScopeFromToken,
  schoolScopeOfLogin,
  studentsOfSchool,
  withImportSchoolIds,
} from "./school-identity";

/**
 * How a school named by a client (a name, an id, an old token with only a name, a
 * new token with an id) becomes the school id every reader works with. The
 * database is replaced by a list of schools; the fake narrowing returns every
 * school whose name is equal under a case-insensitive, Khmer-mark-blind compare
 * (what the real column collation does), so the text rule in `school-identity.ts`
 * is the thing that decides, as in production.
 */

const A = "5c000000-0000-4000-8000-0000000000a1";
const B = "5c000000-0000-4000-8000-0000000000b2";
const C = "5c000000-0000-4000-8000-0000000000c3";

type FakeSchool = { schoolid: string; schoolname: string; isdeleted?: boolean };

// Khmer bantoc (U+17CB), nikahit (U+17C6) and musikatoan (U+17C9) have no weight in the column collation.
const collate = (name: string) => name.trim().toLowerCase().replace(/[ំ៉់]/g, "");

let store: FakeSchool[];
let findAll: jest.SpyInstance;
let findOne: jest.SpyInstance;

const install = (rows: FakeSchool[]) => {
  store = rows;
  findAll = jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where: { logic: string } }) => {
    const given = collate(opts.where.logic);
    return store.filter((s) => collate(s.schoolname) === given).map((s) => ({ isdeleted: false, ...s }));
  }) as never);
  findOne = jest.spyOn(schools, "findOne").mockImplementation((async (opts: { where: { schoolid: string } }) => {
    const found = store.find((s) => s.schoolid === opts.where.schoolid);
    return found ? { ...found } : null;
  }) as never);
};

afterEach(() => jest.restoreAllMocks());

describe("the school name rule", () => {
  it("normalises by trimming, NFC and lower-casing", () => {
    expect(normaliseSchoolName("  Demo School  ")).toBe("demo school");
    expect(normaliseSchoolName("Café")).toBe(normaliseSchoolName("Café"));
  });

  it("two names are the same only when that text is equal, and never when either is not a string", () => {
    expect(isSameSchoolName("Demo School", " demo school ")).toBe(true);
    expect(isSameSchoolName("Demo School", "Demo Schoo1")).toBe(false);
    expect(isSameSchoolName(null, "x")).toBe(false);
    expect(isSameSchoolName("x", undefined)).toBe(false);
    expect(isSameSchoolName("", "")).toBe(false);
  });
});

describe("findSchoolIdByName", () => {
  it("finds a school by its name, ignoring case and surrounding spaces", async () => {
    install([{ schoolid: A, schoolname: "Demo School" }]);
    await expect(findSchoolIdByName("Demo School")).resolves.toBe(A);
    await expect(findSchoolIdByName("  DEMO school ")).resolves.toBe(A);
  });

  it("an unknown name, a blank one and a non-string all find nothing, without asking the database for the last two", async () => {
    install([{ schoolid: A, schoolname: "Demo School" }]);
    await expect(findSchoolIdByName("No Such School")).resolves.toBeNull();
    findAll.mockClear();
    await expect(findSchoolIdByName("   ")).resolves.toBeNull();
    await expect(findSchoolIdByName(undefined)).resolves.toBeNull();
    await expect(findSchoolIdByName(["Demo School"])).resolves.toBeNull();
    await expect(findSchoolIdByName({ gt: "a" })).resolves.toBeNull();
    expect(findAll).not.toHaveBeenCalled();
  });

  it("a name that differs by a Khmer mark is a different school, although the column collation calls it equal", async () => {
    const withMark = "សាលាគំរូ"; // contains nikahit
    const withoutMark = "សាលាគរូ";
    install([{ schoolid: A, schoolname: withMark }]);
    expect(collate(withMark)).toBe(collate(withoutMark)); // the fake narrowing WILL return it
    await expect(findSchoolIdByName(withMark)).resolves.toBe(A);
    await expect(findSchoolIdByName(withoutMark)).resolves.toBeNull();
  });

  it("two live schools of one name is a 400 naming the field", async () => {
    install([
      { schoolid: A, schoolname: "Twin" },
      { schoolid: B, schoolname: "Twin" },
    ]);
    const error = await findSchoolIdByName("twin", { field: "schoolname" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe(ErrorCode.INVALID_INPUT);
    expect(error.fields).toEqual([{ field: "schoolname", message: "That school name matches more than one school." }]);
  });

  it("a read prefers the one live school over a deleted namesake; a write (strict) does not guess", async () => {
    install([
      { schoolid: A, schoolname: "Twin", isdeleted: true },
      { schoolid: B, schoolname: "Twin" },
    ]);
    await expect(findSchoolIdByName("Twin")).resolves.toBe(B);
    await expect(findSchoolIdByName("Twin", { strict: true })).rejects.toBeInstanceOf(ApiError);
  });

  it("liveOnly ignores a soft-deleted school", async () => {
    install([{ schoolid: A, schoolname: "Gone", isdeleted: true }]);
    await expect(findSchoolIdByName("Gone")).resolves.toBe(A);
    await expect(findSchoolIdByName("Gone", { liveOnly: true })).resolves.toBeNull();
  });
});

describe("resolveSchoolRef", () => {
  beforeEach(() => install([{ schoolid: A, schoolname: "Demo School" }]));

  it("an id is used as it stands, and wins over a name", async () => {
    await expect(resolveSchoolRef({ schoolid: ` ${B} `, schoolname: "Demo School" })).resolves.toBe(B);
    expect(findAll).not.toHaveBeenCalled();
  });

  it("a name is resolved to an id once; an unknown name is null; nothing given is undefined", async () => {
    await expect(resolveSchoolRef({ schoolname: "demo school" })).resolves.toBe(A);
    expect(findAll).toHaveBeenCalledTimes(1);
    await expect(resolveSchoolRef({ schoolname: "Nobody" })).resolves.toBeNull();
    await expect(resolveSchoolRef({})).resolves.toBeUndefined();
    await expect(resolveSchoolRef({ schoolid: "", schoolname: "  " })).resolves.toBeUndefined();
    await expect(resolveSchoolRef({ schoolname: ["a", "b"] })).resolves.toBeUndefined();
  });
});

describe("the name fallback never reaches a row that has a school id", () => {
  // The predicate as a row test: every key must hold (null: the column is empty; a string: the name, under the column collation).
  const reads = (where: Record<string, unknown>, row: { schoolid: string | null; schoolname: string }) =>
    Object.entries(where).every(([key, want]) =>
      want === null ? row[key as "schoolid"] === null : collate(String(row[key as "schoolname"])) === collate(String(want)),
    );
  const rows = [
    { schoolid: null, schoolname: "Window School" },
    { schoolid: A, schoolname: "Window School" }, // the same name, but it has an id
    { schoolid: B, schoolname: "window school " }, // collation-equal name, has an id
    { schoolid: null, schoolname: "Other School" },
  ];

  it("a name scope reads only the rows with no id; an id scope reads by id alone", () => {
    const byName = schoolPredicate({ schoolname: "Window School" }) as Record<string, unknown>;
    expect(rows.filter((r) => reads(byName, r))).toEqual([rows[0]]);
    const byId = schoolPredicate({ schoolid: A }) as Record<string, unknown>;
    expect(rows.filter((r) => reads(byId, r))).toEqual([rows[1]]);
  });
});

describe("resolveSchoolScope", () => {
  beforeEach(() => install([{ schoolid: A, schoolname: "Demo School" }]));

  it("an id wins; a known name is its id alone; an unknown name is the name itself; nothing given is undefined", async () => {
    await expect(resolveSchoolScope({ schoolid: ` ${B} `, schoolname: "Demo School" })).resolves.toEqual({ schoolid: B });
    await expect(resolveSchoolScope({ schoolname: "demo school" })).resolves.toEqual({ schoolid: A });
    await expect(resolveSchoolScope({ schoolname: "Not Here Yet" })).resolves.toEqual({ schoolname: "Not Here Yet" });
    await expect(resolveSchoolScope({})).resolves.toBeUndefined();
    await expect(resolveSchoolScope({ schoolname: ["a"] })).resolves.toBeUndefined();
  });

  it("a name that matches two live schools is a 400, never the name predicate (which would merge them)", async () => {
    install([
      { schoolid: A, schoolname: "Twin" },
      { schoolid: B, schoolname: "Twin" },
    ]);
    await expect(resolveSchoolScope({ schoolname: "Twin" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("schoolScopeFromToken: an old token (name only) and a new one (id) give the same school", () => {
  beforeEach(() =>
    install([
      { schoolid: A, schoolname: "School A" },
      { schoolid: B, schoolname: "School B" },
    ]),
  );

  it("the id claim is used without a lookup", async () => {
    await expect(schoolScopeFromToken({ schoolid: A, schoolname: "School A" })).resolves.toEqual({ schoolid: A });
    await expect(schoolScopeFromToken({ schoolid: A })).resolves.toEqual({ schoolid: A });
    expect(findAll).not.toHaveBeenCalled();
  });

  it("an old token has only a name, which is resolved: the same id", async () => {
    await expect(schoolScopeFromToken({ schoolname: "School A" })).resolves.toEqual({ schoolid: A });
    await expect(schoolScopeFromToken({ schoolid: null, schoolname: "School B" })).resolves.toEqual({ schoolid: B });
  });

  it("the id claim wins over a name claim that names another school", async () => {
    await expect(schoolScopeFromToken({ schoolid: A, schoolname: "School B" })).resolves.toEqual({ schoolid: A });
  });

  it("a token naming no school is undefined; one whose school is not on this server yet is its name", async () => {
    await expect(schoolScopeFromToken({})).resolves.toBeUndefined();
    await expect(schoolScopeFromToken({ schoolid: null, schoolname: "" })).resolves.toBeUndefined();
    await expect(schoolScopeFromToken(undefined)).resolves.toBeUndefined();
    await expect(schoolScopeFromToken({ schoolname: "Unknown School" })).resolves.toEqual({ schoolname: "Unknown School" });
  });
});

describe("schoolScopeOfLogin", () => {
  const stubRows = (login: unknown, learner: unknown) => {
    jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: jest.fn().mockResolvedValue(login) } as never);
    jest.spyOn(students, "scope").mockReturnValue({ findOne: jest.fn().mockResolvedValue(learner) } as never);
  };

  it("takes the id stored on the login, then on the learner, then resolves the name, then is the name", async () => {
    install([{ schoolid: C, schoolname: "By Name" }]);
    stubRows({ schoolid: A }, { schoolid: B });
    await expect(schoolScopeOfLogin("u1", "By Name")).resolves.toEqual({ schoolid: A });
    stubRows({ schoolid: null }, { schoolid: B });
    await expect(schoolScopeOfLogin("u1", "By Name")).resolves.toEqual({ schoolid: B });
    stubRows(null, null);
    await expect(schoolScopeOfLogin("u1", "By Name")).resolves.toEqual({ schoolid: C });
    await expect(schoolScopeOfLogin("u1", "Unknown")).resolves.toEqual({ schoolname: "Unknown" });
    await expect(schoolScopeOfLogin("u1", null)).resolves.toEqual({ schoolname: null });
  });
});

describe("withImportSchoolIds: the id written with a roster row", () => {
  beforeEach(() =>
    install([
      { schoolid: A, schoolname: "School A" },
      { schoolid: B, schoolname: "School B" },
    ]),
  );

  it("an old payload (a name, no id) gets the id of the school the name resolves to, and the name is left as sent", async () => {
    const rows = await withImportSchoolIds([{ studentid: "1", schoolname: " school a " } as never]);
    expect(rows).toEqual([{ studentid: "1", schoolname: " school a ", schoolid: A }]);
  });

  it("a payload that carries an id and the name of the same school keeps the id (the name may differ in case or spaces)", async () => {
    const rows = await withImportSchoolIds([{ schoolname: " school b ", schoolid: B }]);
    expect(rows[0].schoolid).toBe(B);
  });

  it("a payload that carries only an id of a school that exists keeps it", async () => {
    const rows = await withImportSchoolIds([{ schoolid: B }]);
    expect(rows[0]).toEqual({ schoolid: B });
  });

  it("a payload whose id and name name different schools fails the write with a 400", async () => {
    const error = await withImportSchoolIds([{ schoolname: "School A", schoolid: B }]).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe(ErrorCode.INVALID_INPUT);
  });

  it("a name changed in the payload moves the id with it (the id is not left stale)", async () => {
    const rows = await withImportSchoolIds([{ schoolname: "School B" }]);
    expect(rows[0].schoolid).toBe(B);
  });

  it("an id of a school this server does not have falls back to the name; a name it does not know, or no school at all, is NULL", async () => {
    const rows = await withImportSchoolIds([
      { schoolname: "School A", schoolid: C }, // C is a school this server does not have
      { schoolname: "Not Here Yet" },
      { schoolid: C },
      {},
    ]);
    expect(rows.map((r) => r.schoolid)).toEqual([A, null, null, null]);
  });

  it("looks each distinct name and id up once", async () => {
    await withImportSchoolIds([
      { schoolname: "School A" },
      { schoolname: "School A" },
      { schoolid: B },
      { schoolid: B },
    ]);
    expect(findAll).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("a name that matches two schools fails the write, and the lookup runs in the given transaction", async () => {
    install([
      { schoolid: A, schoolname: "Twin" },
      { schoolid: B, schoolname: "Twin", isdeleted: true },
    ]);
    const transaction = { id: "t" } as never;
    await expect(withImportSchoolIds([{ schoolname: "Twin" }], transaction)).rejects.toBeInstanceOf(ApiError);
    expect(findAll.mock.calls[0][0].transaction).toBe(transaction);
  });
});

describe("the SQL of the id filters", () => {
  let sequelize: Sequelize;
  beforeEach(() => {
    sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
    initModels(sequelize);
    jest.spyOn(sequelize, "query").mockImplementation((sql: unknown) => {
      throw new Error(`__sql__${String(sql)}`);
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await sequelize.close();
  });
  const sqlOf = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (e) {
      return String((e as Error).message).replace(/^__sql__/, "");
    }
    throw new Error("no sql");
  };

  it("studentsOfSchool: an id is an equality on schoolid; a name (no school row yet) is the legacy equality on schoolname, never both", async () => {
    const byId = await sqlOf(() => students.findAll({ where: studentsOfSchool({ schoolid: A }) }));
    expect(byId).toMatch(new RegExp(`WHERE \`students\`\\.\`schoolid\` = '${A}';$`));
    expect(byId).not.toMatch(/WHERE.*schoolname/);
    const byName = await sqlOf(() => students.findAll({ where: studentsOfSchool({ schoolname: "Not Here Yet" }) }));
    // the name fallback reads only rows with NO school id: a learner that has an id is never reached through a name
    expect(byName).toMatch(/WHERE `students`\.`schoolid` IS NULL AND `students`\.`schoolname` = 'Not Here Yet';$/);
    expect(byName).not.toMatch(/`schoolid` = /);
    expect(await sqlOf(() => students.findAll({ where: studentsOfSchool({ schoolname: null }) }))).toMatch(/`schoolid` IS NULL AND `students`\.`schoolname` IS NULL/);
    expect(schoolPredicate({ schoolid: A })).toEqual({ schoolid: A });
    expect(schoolPredicate({ schoolname: "Foo" })).toEqual({ schoolid: null, schoolname: "Foo" });
  });

  it("schoolOfStudent reads the learner's school id inside the statement and escapes the id it is given", async () => {
    const sql = await sqlOf(() => schools.findAll({ where: schoolOfStudent("s1' OR '1'='1") }));
    expect(sql).toMatch(/`schools`\.`schoolid` = \(SELECT s\.schoolid FROM students AS s WHERE s\.studentid = 's1\\' OR \\'1\\'=\\'1' LIMIT 1\)/);
    expect(await sqlOf(() => schools.findAll({ where: schoolOfStudent(undefined) }))).toMatch(/`schoolid` IN \(NULL\)/);
  });
});
