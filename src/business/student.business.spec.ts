import { QueryTypes } from "sequelize";
import { dbinstance } from "src/services/dbservice";
import { students } from "../models/data-models/init-models";
import { StudentBusiness } from "./student.business";

/**
 * Guards #16 (parameterize all SQLi sites, student API) for every raw
 * `dbinstance.getdbinstance().query(...)` call in this file: the four
 * UUID-gated stats queries and /student/logintime's IN(...) lookup. Each
 * test drives a hostile value through the real business method and asserts
 * the mocked `query` call received it as a bind replacement, never
 * concatenated into the SQL string — the exact distinction #16 fixed.
 *
 * A single injection-shaped string doubles as the hostile input:
 * `1 OR 1=1; --`. If any of these sites regressed to string interpolation,
 * this literal text would appear inside the first (SQL) argument.
 */
const HOSTILE = "1 OR 1=1; --";

describe("StudentBusiness SQL parameterization (#16)", () => {
  let querySpy: jest.SpyInstance;

  beforeEach(() => {
    querySpy = jest
      .spyOn(dbinstance.getdbinstance(), "query")
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    querySpy.mockRestore();
  });

  const assertParameterized = (hostileValueLocation: "single" | "list") => {
    expect(querySpy).toHaveBeenCalledTimes(1);
    const [sql, options] = querySpy.mock.calls[0];

    // The hostile value must never be baked into the SQL text.
    expect(sql).not.toContain(HOSTILE);
    expect(options.type).toBe(QueryTypes.SELECT);

    if (hostileValueLocation === "single") {
      expect(options.replacements).toContain(HOSTILE);
    } else {
      expect(options.replacements).toEqual(
        expect.arrayContaining([HOSTILE])
      );
    }
  };

  it("getstudentstats binds studentid as a replacement, not string concatenation", async () => {
    await new StudentBusiness().getstudentstats(HOSTILE);
    assertParameterized("single");
  });

  it("getstudentquizstats binds studentid as a replacement, not string concatenation", async () => {
    await new StudentBusiness().getstudentquizstats(HOSTILE);
    assertParameterized("single");
  });

  it("getstudentpracticestats binds studentid as a replacement, not string concatenation", async () => {
    await new StudentBusiness().getstudentpracticestats(HOSTILE);
    assertParameterized("single");
  });

  it("getstudentlevelstats binds studentid as a replacement, not string concatenation", async () => {
    await new StudentBusiness().getstudentlevelstats(HOSTILE);
    assertParameterized("single");
  });

  it("getlogintime binds every schooluserid as a replacement behind `?` placeholders, not a joined IN(...) string", async () => {
    await new StudentBusiness().getlogintime(["u1", HOSTILE, "u3"]);

    expect(querySpy).toHaveBeenCalledTimes(1);
    const [sql, options] = querySpy.mock.calls[0];

    expect(sql).not.toContain(HOSTILE);
    // Three ids -> three placeholders, however many appear in the IN(...) list.
    expect((sql.match(/\?/g) ?? []).length).toBe(3);
    expect(options.replacements).toEqual(["u1", HOSTILE, "u3"]);
  });

  it("getlogintime is a no-op (no query at all) for an empty id list", async () => {
    const result = await new StudentBusiness().getlogintime([]);
    expect(result).toEqual([]);
    expect(querySpy).not.toHaveBeenCalled();
  });
});

/**
 * Guards the sixth "search endpoint" from #16 that isn't a raw `.query()`
 * call: getStudentsWithFilter builds a Sequelize `where` using `Op.like`
 * with the search term as its VALUE, which Sequelize parameterizes when it
 * generates SQL. Before #16 this table's twin sites used `sequelize.literal`
 * with the search term interpolated directly into raw SQL text. Mocking
 * `findAll` and reading the `where` clause the business method actually
 * built proves it's a bound value, not a literal.
 */
describe("StudentBusiness.getStudentsWithFilter SQL parameterization (#16)", () => {
  it("passes the search term as an Op.like VALUE, never as sequelize.literal", async () => {
    const findAllSpy = jest
      .spyOn(students, "findAll")
      .mockResolvedValue([] as never);

    try {
      await new StudentBusiness().getStudentsWithFilter(HOSTILE, "");

      expect(findAllSpy).toHaveBeenCalledTimes(1);
      const options: any = findAllSpy.mock.calls[0][0];
      const likeClause = options.where["$schooluser.schoolusername$"];

      // An Op.like clause is a plain object keyed by the Symbol(like); the
      // hostile string sits under that key as data, not inside a
      // sequelize.literal(...) call (which would put a Literal instance —
      // an object with its own `.val` holding the raw SQL text — under
      // that same symbol key instead of a plain string).
      const likeSymbol = Object.getOwnPropertySymbols(likeClause)[0];
      expect(likeClause[likeSymbol]).toBe(`%${HOSTILE}%`);
      expect(typeof likeClause[likeSymbol]).toBe("string");
    } finally {
      findAllSpy.mockRestore();
    }
  });
});
