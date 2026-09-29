import { normaliseTyped, typedAnswerEquals } from "./normalise";

describe("normaliseTyped", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normaliseTyped("  hello   world  ")).toBe("hello world");
  });

  it("lower-cases Latin letters", () => {
    expect(normaliseTyped("HeLLo")).toBe("hello");
  });

  it("maps each Khmer digit to its ASCII equivalent", () => {
    expect(normaliseTyped("០១២៣៤៥៦៧៨៩")).toBe("0123456789");
  });

  it("strips zero-width characters", () => {
    const withZeroWidth = "សួស​តី‌‍﻿";
    expect(normaliseTyped(withZeroWidth)).toBe("សួសតី");
  });

  it("normalises to NFC so a decomposed form matches its precomposed form", () => {
    // "é" as base letter + combining acute accent (U+0065 U+0301) vs the
    // single precomposed code point (U+00E9): two different byte sequences
    // for the same rendered glyph, exactly what NFC normalisation collapses.
    const decomposed = "café";
    const precomposed = "café";
    expect(decomposed).not.toBe(precomposed); // sanity: the fixture is genuinely two different byte sequences
    expect(normaliseTyped(decomposed)).toBe(normaliseTyped(precomposed));
  });

  it("non-string input never throws", () => {
    expect(normaliseTyped(undefined as unknown as string)).toBe("");
    expect(normaliseTyped(null as unknown as string)).toBe("");
  });
});

describe("typedAnswerEquals (forgiving match)", () => {
  it("matches after trim, case-fold and whitespace collapse", () => {
    expect(typedAnswerEquals("  Dog  ", "dog")).toBe(true);
    expect(typedAnswerEquals("dog", "cat")).toBe(false);
  });

  it("matches Khmer digits against ASCII digits numerically", () => {
    expect(typedAnswerEquals("១២", "12")).toBe(true);
    expect(typedAnswerEquals("០៧", "7")).toBe(true); // leading Khmer zero, numeric compare
  });

  it("matches across normalisation forms and zero-width noise", () => {
    const decomposed = "café";
    const precomposed = "café";
    expect(typedAnswerEquals(decomposed, precomposed)).toBe(true);
    expect(typedAnswerEquals(`${precomposed}​`, precomposed)).toBe(true);
  });

  it("matches Khmer text with zero-width noise stripped", () => {
    const clean = "សួស្តី";
    expect(typedAnswerEquals(`${clean}​‌`, clean)).toBe(true);
  });

  it("rejects non-string input without throwing", () => {
    expect(typedAnswerEquals(undefined, "7")).toBe(false);
    expect(typedAnswerEquals(7 as unknown as string, "7")).toBe(false);
  });
});
