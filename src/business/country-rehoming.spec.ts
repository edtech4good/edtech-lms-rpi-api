import { QueryTypes } from "sequelize";
import { countries } from "src/models/data-models/countries";
import { dbinstance } from "src/services/dbservice";
import { TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";
import { fakeCountryNames } from "src/test-support/country-names";
import {
  AmbiguousCountryName,
  CountryNameLookup,
  LocalCountry,
  matchCountriesByName,
  mysqlCountryNames,
  rehomeCountriesByName,
  rewriteCountryReferences,
} from "./country-rehoming";

/**
 * The one rule for a payload country whose name is a country here under another id, shared by the content
 * import and the provisioning tool. (Each caller has its own specs for what it does with the answer.) What is
 * "the same name" is the database's; these specs use an approximation of its collation
 * (src/test-support/country-names.ts), and the live run against MySQL is the proof of the real one.
 */
const local = (countryid: string, countryname: string, over: object = {}): LocalCountry => ({ countryid, countryname, expectedusage: 3, isdeleted: false, ...over });
const payloadRow = (countryid: string, countryname: string) => ({ countryid, countryname, expectedusage: 9, isdeleted: false });
const rehome = async (payload: Array<Record<string, unknown>>, here: LocalCountry[]) =>
  rehomeCountriesByName(payload, await matchCountriesByName(payload, fakeCountryNames(here)));

describe("rehomeCountriesByName", () => {
  it("a name here under another id: the local row replaces the payload's and the ids are mapped", async () => {
    const out = await rehome([payloadRow("p1", "កម្ពុជា")], [local("l1", "កម្ពុជា")]);
    expect(out.rows).toEqual([{ countryid: "l1", countryname: "កម្ពុជា", expectedusage: 3, isdeleted: false }]);
    expect([...out.idMap]).toEqual([["p1", "l1"]]);
    expect(out.revived).toBe(0);
    expect(out.collapsed).toBe(0);
  });

  it("the map is keyed by the lower-cased payload id and holds the local id as stored", async () => {
    const out = await rehome([payloadRow("P1-AA", "ថៃ")], [local("L1-BB", "ថៃ")]);
    expect([...out.idMap]).toEqual([["p1-aa", "L1-BB"]]);
  });

  it("the same id (even with another spelling of the id's case) is left alone; so is a name not here", async () => {
    const rows = [payloadRow("l1", "កម្ពុជា"), payloadRow("p2", "ថៃ")];
    const out = await rehome(rows, [local("L1", "កម្ពុជា")]);
    expect(out.rows).toEqual(rows);
    expect(out.idMap.size).toBe(0);
  });

  it("a deleted local row is written live and counted as brought back", async () => {
    const out = await rehome([payloadRow("p1", "ថៃ")], [local("l1", "ថៃ", { isdeleted: true })]);
    expect(out.rows[0]).toMatchObject({ countryid: "l1", isdeleted: false });
    expect(out.revived).toBe(1);
  });

  it("two payload countries of one name give one row and two mapped ids; an id twice gives one row", async () => {
    const out = await rehome([payloadRow("p1", "ថៃ"), payloadRow("p2", "ថៃ "), payloadRow("p3", "ឡាវ"), payloadRow("p3", "ឡាវ")], [local("l1", "ថៃ")]);
    expect(out.rows.map((r) => r.countryid)).toEqual(["l1", "p3"]);
    expect([...out.idMap].sort()).toEqual([["p1", "l1"], ["p2", "l1"]]);
  });

  it("two payload countries the database calls equal, with no local match, collapse onto the first; the second's id is mapped to the first's", async () => {
    const out = await rehome([payloadRow("p1", "Newland"), payloadRow("p2", "NEWLÄND "), payloadRow("p3", "Other")], []);
    expect(out.rows.map((r) => r.countryid)).toEqual(["p1", "p3"]);
    expect([...out.idMap]).toEqual([["p2", "p1"]]);
    expect(out.collapsed).toBe(1);
  });

  it("the kept row of a collapse is the first LIVE one of the payload, else the first", async () => {
    const dead = (id: string, name: string) => ({ ...payloadRow(id, name), isdeleted: true });
    const liveSecond = await rehome([dead("p1", "Newland"), payloadRow("p2", "NEWLAND"), payloadRow("p3", "newland ")], []);
    expect(liveSecond.rows.map((r) => r.countryid)).toEqual(["p2"]);
    expect([...liveSecond.idMap].sort()).toEqual([["p1", "p2"], ["p3", "p2"]]);
    const allDead = await rehome([dead("p1", "Newland"), dead("p2", "NEWLAND")], []);
    expect(allDead.rows.map((r) => r.countryid)).toEqual(["p1"]);
    expect([...allDead.idMap]).toEqual([["p2", "p1"]]);
  });

  it("more than one local country of that name is refused, not guessed; unless one of them IS the payload's id", async () => {
    const here = [local("l1", "ថៃ"), local("l2", "ថៃ")];
    await expect(rehome([payloadRow("p1", "ថៃ")], here)).rejects.toBeInstanceOf(AmbiguousCountryName);
    expect((await rehome([payloadRow("l2", "ថៃ")], here)).idMap.size).toBe(0);
  });

  it("asks the lookup once per distinct name, and decides nothing itself: what the lookup says equal is equal", async () => {
    const asked: string[] = [];
    const lookup: CountryNameLookup = {
      findByName: async (name) => {
        asked.push(name);
        return name === "alias" ? [local("l1", "Canonical")] : [];
      },
      sameName: async () => false,
    };
    const payload = [payloadRow("p1", "alias"), payloadRow("p2", "alias")];
    const out = rehomeCountriesByName(payload, await matchCountriesByName(payload, lookup));
    expect(asked).toEqual(["alias"]);
    expect(out.rows).toEqual([{ countryid: "l1", countryname: "Canonical", expectedusage: 3, isdeleted: false }]);
    expect([...out.idMap].sort()).toEqual([["p1", "l1"], ["p2", "l1"]]);
  });
});

describe("rewriteCountryReferences", () => {
  const tablesWith = (schools: object[]) => Object.fromEntries(TABLE_KEYS.map((k) => [k, k === "schools" ? schools : []])) as unknown as Record<TableKey, Record<string, unknown>[]>;

  it("rewrites every declared reference to a mapped id, and only those; a table not mapped is returned as it was", () => {
    const tables = tablesWith([{ schoolid: "s1", countryid: "P1" }, { schoolid: "s2", countryid: "other" }, { schoolid: "s3", countryid: null }]);
    const out = rewriteCountryReferences(tables, new Map([["p1", "l1"]]));
    expect(out.schools).toEqual([{ schoolid: "s1", countryid: "l1" }, { schoolid: "s2", countryid: "other" }, { schoolid: "s3", countryid: null }]);
    expect(out.grades).toBe(tables.grades);
    expect(tables.schools[0].countryid).toBe("P1"); // the input is not changed
  });

  it("a skipped table is left alone; an empty map changes nothing", () => {
    const tables = tablesWith([{ schoolid: "s1", countryid: "p1" }]);
    expect(rewriteCountryReferences(tables, new Map([["p1", "l1"]]), ["schools"]).schools).toEqual([{ schoolid: "s1", countryid: "p1" }]);
    expect(rewriteCountryReferences(tables, new Map())).toBe(tables);
  });
});

describe("mysqlCountryNames: the lookup asks the database", () => {
  afterEach(() => jest.restoreAllMocks());

  it("findByName is a `countryname = name` query with the name exactly as given (the column's collation compares, not this code), in the transaction", async () => {
    const tx = { id: "tx" } as never;
    const found = [local("l1", "Testland")];
    const spy = jest.spyOn(countries, "findAll").mockResolvedValue(found as never);
    await expect(mysqlCountryNames(tx).findByName("Téstland ")).resolves.toBe(found);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ where: { countryname: "Téstland " }, transaction: tx }));
  });

  it("sameName compares the two literals under the collation READ FROM THE COLUMN, once, in the transaction", async () => {
    const tx = { id: "tx" } as never;
    const sql: string[] = [];
    jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (text: string, opts: { type: unknown; transaction: unknown; replacements?: unknown }) => {
      sql.push(text);
      expect(opts.type).toBe(QueryTypes.SELECT);
      expect(opts.transaction).toBe(tx);
      return /INFORMATION_SCHEMA/i.test(text) ? [{ cs: "utf8mb4", coll: "utf8mb4_0900_ai_ci" }] : [{ same: 1 }];
    }) as never);
    const names = mysqlCountryNames(tx);
    await expect(names.sameName("a", "b")).resolves.toBe(true);
    await expect(names.sameName("c", "d")).resolves.toBe(true);
    expect(sql.filter((t) => /INFORMATION_SCHEMA/i.test(t))).toHaveLength(1);
    expect(sql[1]).toContain("COLLATE utf8mb4_0900_ai_ci");
    expect(sql[1]).toContain("CONVERT(:a USING utf8mb4)");
  });

  it("a collation name that is not a plain identifier is never put into SQL", async () => {
    jest.spyOn(dbinstance.getdbinstance(), "query").mockResolvedValue([{ cs: "utf8mb4", coll: "x; DROP TABLE countries" }] as never);
    await expect(mysqlCountryNames().sameName("a", "b")).rejects.toThrow("cannot read the collation of countries.countryname");
  });

  it("zero from the database is 'not the same'", async () => {
    jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (text: string) => (/INFORMATION_SCHEMA/i.test(text) ? [{ cs: "utf8mb4", coll: "utf8mb4_unicode_ci" }] : [{ same: 0 }])) as never);
    await expect(mysqlCountryNames().sameName("កម្ពុជ", "កម្ពុជា")).resolves.toBe(false);
  });
});
