import { parseOptions } from "./option";

describe("parseOptions", () => {
  it("parses a real questionoptions array, reading a stringly-typed questionoptionvalue as a number", () => {
    // Observed in the local seed (edtech_lms_rpi.questions, template 1):
    // questionoptionvalue stored as the JSON string "7", not the number 7
    // the Sequelize model declares.
    const raw = [
      {
        questionoptionid: "a",
        questionoptiontext: "7",
        questionoptionvalue: "7",
        questionoptioniscorrect: false,
        questionoptionsequence: 1,
      },
    ];
    const parsed = parseOptions(raw);
    expect(parsed).toEqual([
      expect.objectContaining({ questionoptionid: "a", questionoptionvalue: 7 }),
    ]);
  });

  it("parses questionoptions given as a JSON string (as some callers store it)", () => {
    const raw = JSON.stringify([{ questionoptionid: "a", questionoptioniscorrect: true }]);
    expect(parseOptions(raw)).toEqual([expect.objectContaining({ questionoptionid: "a", questionoptioniscorrect: true })]);
  });

  it("returns undefined for unparseable JSON, never throws", () => {
    expect(parseOptions("{not json")).toBeUndefined();
  });

  it("returns undefined for a non-array value", () => {
    expect(parseOptions({ not: "an array" })).toBeUndefined();
    expect(parseOptions(42)).toBeUndefined();
    expect(parseOptions(null)).toBeUndefined();
    expect(parseOptions(undefined)).toBeUndefined();
  });

  it("returns undefined (malformed) when any entry has no usable id, rather than silently dropping it", () => {
    const raw = [{ questionoptiontext: "no id here" }, { questionoptionid: "b", questionoptioniscorrect: true }];
    expect(parseOptions(raw)).toBeUndefined();
  });

  it("returns undefined (malformed) for an empty options array", () => {
    expect(parseOptions([])).toBeUndefined();
    expect(parseOptions("[]")).toBeUndefined();
  });

  it("returns undefined when every entry in a non-empty array is unusable", () => {
    expect(parseOptions([{}, { foo: "bar" }])).toBeUndefined();
  });
});

describe("parseOptions: questionoptioniscorrect defence in depth", () => {
  it.each([true, 1, "true", "1"])("reads %p as correct", (v) => {
    const parsed = parseOptions([{ questionoptionid: "a", questionoptioniscorrect: v }]);
    expect(parsed).toEqual([expect.objectContaining({ questionoptioniscorrect: true })]);
  });

  it.each([false, 0, "false", "0", undefined, null, "yes", 2])("reads %p as not correct", (v) => {
    const parsed = parseOptions([{ questionoptionid: "a", questionoptioniscorrect: v }]);
    expect(parsed).toEqual([expect.objectContaining({ questionoptioniscorrect: false })]);
  });
});
