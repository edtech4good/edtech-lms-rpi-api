import { AmbiguousCountryName, rehomeCountriesByName, rewriteCountryReferences } from "./country-rehoming";
import { TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";

/**
 * The one rule for a payload country whose name is a country here under another id, shared by the content
 * import and the provisioning tool. (Each caller has its own specs for what it does with the answer.)
 */
const local = (countryid: string, countryname: string, over: object = {}) => ({ countryid, countryname, expectedusage: 3, isdeleted: false, ...over });
const payloadRow = (countryid: string, countryname: string) => ({ countryid, countryname, expectedusage: 9, isdeleted: false });

describe("rehomeCountriesByName", () => {
  it("a name here under another id: the local row replaces the payload's and the ids are mapped", () => {
    const out = rehomeCountriesByName([payloadRow("p1", "កម្ពុជា")], [local("l1", "កម្ពុជា")]);
    expect(out.rows).toEqual([{ countryid: "l1", countryname: "កម្ពុជា", expectedusage: 3, isdeleted: false }]);
    expect([...out.idMap]).toEqual([["p1", "l1"]]);
    expect(out.revived).toBe(0);
  });

  it("the map is keyed by the lower-cased payload id and holds the local id as stored", () => {
    const out = rehomeCountriesByName([payloadRow("P1-AA", "ថៃ")], [local("L1-BB", "ថៃ")]);
    expect([...out.idMap]).toEqual([["p1-aa", "L1-BB"]]);
  });

  it("the same id (even with another spelling of the name's case) is left alone; so is a name not here", () => {
    const rows = [payloadRow("l1", "កម្ពុជា"), payloadRow("p2", "ថៃ")];
    const out = rehomeCountriesByName(rows, [local("L1", "កម្ពុជា")]);
    expect(out.rows).toEqual(rows);
    expect(out.idMap.size).toBe(0);
  });

  it("a deleted local row is written live and counted as brought back", () => {
    const out = rehomeCountriesByName([payloadRow("p1", "ថៃ")], [local("l1", "ថៃ", { isdeleted: true })]);
    expect(out.rows[0]).toMatchObject({ countryid: "l1", isdeleted: false });
    expect(out.revived).toBe(1);
  });

  it("two payload countries of one name give one row and two mapped ids; an id twice gives one row", () => {
    const out = rehomeCountriesByName([payloadRow("p1", "ថៃ"), payloadRow("p2", "ថៃ "), payloadRow("p3", "ឡាវ"), payloadRow("p3", "ឡាវ")], [local("l1", "ថៃ")]);
    expect(out.rows.map((r) => r.countryid)).toEqual(["l1", "p3"]);
    expect([...out.idMap].sort()).toEqual([["p1", "l1"], ["p2", "l1"]]);
  });

  it("the name rule is trim, NFC and lower-case, and nothing the column's collation ignores", () => {
    expect(rehomeCountriesByName([payloadRow("p1", " CAFÉ ")], [local("l1", "café")]).idMap.size).toBe(1);
    expect(rehomeCountriesByName([payloadRow("p1", "cafe")], [local("l1", "café")]).idMap.size).toBe(0);
    expect(rehomeCountriesByName([payloadRow("p1", "កម្ពុជ")], [local("l1", "កម្ពុជា")]).idMap.size).toBe(0);
  });

  it("more than one local country of that name is refused, not guessed; unless one of them IS the payload's id", () => {
    const here = [local("l1", "ថៃ"), local("l2", "ថៃ")];
    expect(() => rehomeCountriesByName([payloadRow("p1", "ថៃ")], here)).toThrow(AmbiguousCountryName);
    expect(rehomeCountriesByName([payloadRow("l2", "ថៃ")], here).idMap.size).toBe(0);
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
