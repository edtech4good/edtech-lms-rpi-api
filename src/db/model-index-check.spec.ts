import { ActualIndex, covers, sameAsDeclared } from "./model-index-check";

const ix = (columns: string[], over: Partial<ActualIndex> = {}): ActualIndex => ({ columns, unique: false, subParts: columns.map(() => null), type: "BTREE", ...over });

describe("covers", () => {
  it("a BTREE index leading with the columns covers", () => {
    expect(covers(ix(["studentid", "gradeid"]), ["studentid"])).toBe(true);
    expect(covers(ix(["studentid"]), ["studentid"])).toBe(true);
  });
  it("an index that does not lead with them does not", () => {
    expect(covers(ix(["gradeid", "studentid"]), ["studentid"])).toBe(false);
    expect(covers(ix(["studentid"]), ["studentid", "gradeid"])).toBe(false);
  });
  it("a prefix-length entry on a matched column does not cover", () => {
    expect(covers(ix(["name", "x"], { subParts: [10, null] }), ["name"])).toBe(false);
  });
  it("a prefix on a later, unmatched column does not matter", () => {
    expect(covers(ix(["a", "b"], { subParts: [null, 10] }), ["a"])).toBe(true);
  });
  it("FULLTEXT, SPATIAL and HASH do not cover", () => {
    for (const type of ["FULLTEXT", "SPATIAL", "HASH"]) expect(covers(ix(["a"], { type }), ["a"])).toBe(false);
  });
});

describe("sameAsDeclared", () => {
  it("matches columns, uniqueness, BTREE and whole columns", () => {
    expect(sameAsDeclared(ix(["a", "b"]), ["a", "b"], false)).toBe(true);
    expect(sameAsDeclared(ix(["a"]), ["a"], true)).toBe(false);
    expect(sameAsDeclared(ix(["a"], { unique: true }), ["a"], true)).toBe(true);
    expect(sameAsDeclared(ix(["a"]), ["b"], false)).toBe(false);
  });
  it("a prefix-length or non-BTREE index of the same name is not the declared one", () => {
    expect(sameAsDeclared(ix(["a"], { subParts: [5] }), ["a"], false)).toBe(false);
    expect(sameAsDeclared(ix(["a"], { type: "FULLTEXT" }), ["a"], false)).toBe(false);
  });
});
