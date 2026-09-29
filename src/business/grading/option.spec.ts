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

  it("drops entries with no usable id instead of failing the whole list", () => {
    const raw = [{ questionoptiontext: "no id here" }, { questionoptionid: "b", questionoptioniscorrect: true }];
    expect(parseOptions(raw)).toEqual([expect.objectContaining({ questionoptionid: "b" })]);
  });
});
