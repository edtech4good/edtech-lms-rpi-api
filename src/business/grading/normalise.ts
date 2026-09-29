/**
 * Forgiving-match normalisation for typed answers (workspace#79, decision 4).
 *
 * Applies, in order:
 *  1. Strip zero-width/invisible characters: U+200B ZERO WIDTH SPACE,
 *     U+200C ZERO WIDTH NON-JOINER, U+200D ZERO WIDTH JOINER,
 *     U+FEFF ZERO WIDTH NO-BREAK SPACE/BOM, U+2060 WORD JOINER,
 *     U+00AD SOFT HYPHEN and U+180E MONGOLIAN VOWEL SEPARATOR — keyboards
 *     and copy-paste commonly leave these behind in Khmer text without
 *     them being visible. This runs *before* NFC normalisation: a zero-
 *     width joiner sitting inside what should be a base+combining-mark
 *     sequence blocks Unicode's canonical composition (e.g. "e" +
 *     ZWJ + combining acute never composes to "é"), so stripping first is
 *     required for step 2 to actually fold such a sequence to its
 *     precomposed form.
 *  2. Unicode NFC normalisation (so a precomposed and a decomposed form of
 *     the same glyph compare equal).
 *  3. Trim leading/trailing whitespace.
 *  4. Collapse runs of internal whitespace to a single space.
 *  5. Lower-case letters via String.prototype.toLowerCase(). This is not
 *     Latin-specific — it also case-folds Greek and Cyrillic — but is a
 *     no-op on Khmer, which has no letter case.
 *  6. Map Khmer digits ០–៩ (U+17E0–U+17E9) to ASCII 0–9.
 */

const ZERO_WIDTH_RE = /[​-‍⁠­᠎﻿]/g;
const KHMER_DIGIT_RE = /[០-៩]/g;
const KHMER_DIGIT_BASE = 0x17e0;

export function normaliseTyped(s: string): string {
  if (typeof s !== "string") return "";
  let out = s.replace(ZERO_WIDTH_RE, "");
  out = out.normalize("NFC");
  out = out.trim().replace(/\s+/g, " ");
  out = out.toLowerCase();
  out = out.replace(KHMER_DIGIT_RE, (d) => String(d.charCodeAt(0) - KHMER_DIGIT_BASE));
  return out;
}

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;
const PLAIN_INTEGER_RE = /^-?\d+$/;

/**
 * Compares two normalised, purely-numeric strings for numeric equality
 * without floating-point precision loss.
 *
 *  - Integers (any number of digits) are compared exactly via BigInt, so a
 *    20-digit typed answer is never silently rounded the way
 *    `Number(...)` would round it.
 *  - Decimals within Number.MAX_SAFE_INTEGER magnitude are compared as
 *    numbers (matches ordinary float behaviour learners expect, e.g.
 *    "1.50" === "1.5").
 *  - Decimals beyond that magnitude fall back to a normalised-digit-string
 *    comparison (strip leading zeros from the integer part, trailing
 *    zeros from the fractional part) rather than an imprecise float
 *    comparison.
 */
function numericStringsEqual(a: string, b: string): boolean {
  if (PLAIN_INTEGER_RE.test(a) && PLAIN_INTEGER_RE.test(b)) {
    try {
      return BigInt(a) === BigInt(b);
    } catch {
      return a === b;
    }
  }
  const numA = Number(a);
  const numB = Number(b);
  const inSafeRange = (n: number) => Math.abs(n) <= Number.MAX_SAFE_INTEGER;
  if (inSafeRange(numA) && inSafeRange(numB)) return numA === numB;
  return normaliseDecimalDigits(a) === normaliseDecimalDigits(b);
}

function normaliseDecimalDigits(s: string): string {
  let sign = "";
  let rest = s;
  if (rest.startsWith("-")) {
    sign = "-";
    rest = rest.slice(1);
  }
  const [intPartRaw, fracPartRaw = ""] = rest.split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = fracPartRaw.replace(/0+$/, "");
  if (intPart === "0" && fracPart === "") sign = ""; // no "-0"
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

/**
 * Forgiving equality for a typed answer against an expected value. Both
 * sides are run through normaliseTyped; if both normalise to a plain
 * number they are compared numerically (exactly, including for very long
 * digit strings — see numericStringsEqual), otherwise as normalised
 * strings.
 */
export function typedAnswerEquals(typed: unknown, expected: unknown): boolean {
  if (typeof typed !== "string" || typeof expected !== "string") return false;
  const a = normaliseTyped(typed);
  const b = normaliseTyped(expected);
  if (a !== "" && b !== "" && PLAIN_NUMBER_RE.test(a) && PLAIN_NUMBER_RE.test(b)) {
    return numericStringsEqual(a, b);
  }
  return a === b;
}
