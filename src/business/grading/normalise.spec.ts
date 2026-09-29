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

  it("strips a zero-width joiner BEFORE composing, so a joiner sitting inside a base+combining-mark pair doesn't block composition", () => {
    // "e" + ZWJ (U+200D) + combining acute (U+0301): the joiner sits between
    // the base letter and its combining mark. Composing first (the old
    // order) leaves it as three separate code points forever, since NFC
    // never crosses a non-combining character; stripping the joiner first
    // lets "e" + combining-acute compose to "é" as intended.
    const zwjInsideCombiningSequence = "cafe‍́";
    expect(normaliseTyped(zwjInsideCombiningSequence)).toBe(normaliseTyped("café"));
  });

  it("strips word joiner, soft hyphen and Mongolian vowel separator", () => {
    expect(normaliseTyped("wo⁠rd")).toBe("word");
    expect(normaliseTyped("wo­rd")).toBe("word");
    expect(normaliseTyped("wo᠎rd")).toBe("word");
  });

  it("case-folds Greek and Cyrillic too, not just Latin", () => {
    expect(normaliseTyped("ΑΒΓ")).toBe("αβγ");
    expect(normaliseTyped("МОСКВА")).toBe("москва");
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

  it("compares long (20-digit) integers exactly, without float precision loss", () => {
    // 12345678901234567890 and ...891 differ only in the last digit but are
    // both well beyond Number.MAX_SAFE_INTEGER (2^53-1); parsed through
    // `Number(...)` they silently round to the same float and would
    // wrongly compare equal.
    const a = "12345678901234567890";
    const b = "12345678901234567891";
    expect(Number(a)).toBe(Number(b)); // sanity: float parsing really does lose this distinction
    expect(typedAnswerEquals(a, a)).toBe(true);
    expect(typedAnswerEquals(a, b)).toBe(false);
  });

  it("matches equal long integers written with different leading zeros/whitespace", () => {
    expect(typedAnswerEquals(" 012345678901234567890 ", "12345678901234567890")).toBe(true);
  });

  it("still compares ordinary small numbers numerically (07 matches 7)", () => {
    expect(typedAnswerEquals("07", "7")).toBe(true);
  });
});
