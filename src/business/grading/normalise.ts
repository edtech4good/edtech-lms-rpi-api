/**
 * Forgiving-match normalisation for typed answers (workspace#79, decision 4).
 *
 * Applies, in order:
 *  1. Unicode NFC normalisation (so a precomposed and a decomposed form of
 *     the same Khmer or Latin glyph compare equal).
 *  2. Strip zero-width characters (U+200B ZERO WIDTH SPACE through
 *     U+200D ZERO WIDTH JOINER, and U+FEFF ZERO WIDTH NO-BREAK
 *     SPACE/BOM) that keyboards and copy-paste commonly leave behind in
 *     Khmer text without being visible.
 *  3. Trim leading/trailing whitespace.
 *  4. Collapse runs of internal whitespace to a single space.
 *  5. Lower-case Latin letters (Khmer has no case, so this is a no-op on
 *     Khmer text and only affects Latin/ASCII content).
 *  6. Map Khmer digits ០–៩ (U+17E0–U+17E9) to ASCII 0–9.
 */

const ZERO_WIDTH_RE = /[​-‍﻿]/g;
const KHMER_DIGIT_RE = /[០-៩]/g;
const KHMER_DIGIT_BASE = 0x17e0;

export function normaliseTyped(s: string): string {
  if (typeof s !== "string") return "";
  let out = s.normalize("NFC");
  out = out.replace(ZERO_WIDTH_RE, "");
  out = out.trim().replace(/\s+/g, " ");
  out = out.toLowerCase();
  out = out.replace(KHMER_DIGIT_RE, (d) => String(d.charCodeAt(0) - KHMER_DIGIT_BASE));
  return out;
}

/**
 * Parses a normalised string as a number when it looks purely numeric
 * (optionally signed, optionally decimal). Returns undefined otherwise so
 * callers can fall back to a plain string comparison.
 */
function asFiniteNumber(normalised: string): number | undefined {
  if (normalised === "") return undefined;
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return undefined;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Forgiving equality for a typed answer against an expected value.
 * Both sides are run through normaliseTyped; if both normalise to a plain
 * number they are compared numerically (so "០៧" matches "7" and "07"),
 * otherwise they are compared as normalised strings.
 */
export function typedAnswerEquals(typed: unknown, expected: unknown): boolean {
  if (typeof typed !== "string" || typeof expected !== "string") return false;
  const a = normaliseTyped(typed);
  const b = normaliseTyped(expected);
  const numA = asFiniteNumber(a);
  const numB = asFiniteNumber(b);
  if (numA !== undefined && numB !== undefined) return numA === numB;
  return a === b;
}
