import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { attachmentDisposition } from "./content-disposition";

/**
 * A download named after a school must work for a school with a Khmer name.
 * Node refuses a header value holding a character above U+00FF, so the value
 * is built as an ASCII fallback plus an RFC 5987 `filename*` carrying the full
 * name.
 */

const KHMER_SCHOOL = "សាលាបឋមសិក្សា ភ្នំពេញ"; // coeng subscripts (ក្ស, ភ្ន), dependent vowels, a space

/** What Node does with a header value: throws on one it will not send. */
const setOnRealResponse = (value: string) => {
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  res.setHeader("Content-Disposition", value);
  return res.getHeader("Content-Disposition");
};

const extended = (header: string) => /; filename\*=UTF-8''(.*)$/.exec(header)?.[1];
const fallback = (header: string) => /^attachment; filename="([^"]*)"/.exec(header)?.[1];

describe("attachmentDisposition", () => {
  it("the raw Khmer name is a value Node refuses (the bug this fixes)", () => {
    expect(() => setOnRealResponse(`attachment; filename="students-${KHMER_SCHOOL}.csv"`)).toThrow(/Invalid character in header content/);
  });

  it("a Khmer name gives an ASCII-only value that Node accepts", () => {
    const header = attachmentDisposition(`students-${KHMER_SCHOOL}.csv`);
    expect(header).toMatch(/^[\x20-\x7e]*$/);
    expect(setOnRealResponse(header)).toBe(header);
  });

  it("a Khmer name carries the full name byte-exact in filename*, and a fallback that keeps the prefix and extension", () => {
    const header = attachmentDisposition(`students-${KHMER_SCHOOL}.csv`);
    expect(extended(header)).toBeDefined();
    expect(decodeURIComponent(extended(header) as string)).toBe(`students-${KHMER_SCHOOL}.csv`);
    expect(extended(header)).toContain("%E1%9E%9F"); // the first letter, as UTF-8 bytes
    expect(fallback(header)).toMatch(/^students-.*\.csv$/);
    expect(fallback(header)).toMatch(/^[\x20-\x7e]+$/);
  });

  it("an ASCII name is unchanged: the same value the controllers wrote before, with no filename*", () => {
    expect(attachmentDisposition("students-Riverside School.csv")).toBe('attachment; filename="students-Riverside School.csv"');
    expect(attachmentDisposition("log-10/3/2026-6:48:23 PM.zip")).toBe('attachment; filename="log-10/3/2026-6:48:23 PM.zip"');
  });

  it("a double quote cannot end the quoted string", () => {
    const header = attachmentDisposition('students-Say "Hello".csv');
    expect(header).toBe('attachment; filename="students-Say Hello.csv"');
    expect(setOnRealResponse(header)).toBe(header);
  });

  it("a quote in a non-ASCII name is stripped from both forms", () => {
    const header = attachmentDisposition(`students-"${KHMER_SCHOOL}".csv`);
    expect(fallback(header)).not.toContain('"');
    expect(header.match(/"/g)).toHaveLength(2);
    expect(decodeURIComponent(extended(header) as string)).toBe(`students-${KHMER_SCHOOL}.csv`);
  });

  it("a backslash is stripped", () => {
    const header = attachmentDisposition("students-A\\B.csv");
    expect(header).toBe('attachment; filename="students-AB.csv"');
  });

  it("a newline, carriage return, tab and other control characters are stripped, so the value stays on one line", () => {
    const header = attachmentDisposition("students-A\r\nB\tC\u0000\u001f\u007f.csv");
    expect(header).toBe('attachment; filename="students-ABC.csv"');
    expect(header).not.toMatch(/[\r\n]/);
    expect(setOnRealResponse(header)).toBe(header);
  });

  it("a 300-character name is bounded, keeps its extension and stays valid", () => {
    const ascii = attachmentDisposition(`students-${"a".repeat(291)}.csv`);
    expect(ascii.length).toBeLessThan(300);
    expect(ascii).toMatch(/\.csv"$/);
    expect(setOnRealResponse(ascii)).toBe(ascii);

    const khmer = attachmentDisposition(`students-${"ក្ស".repeat(100)}.csv`);
    expect(khmer).toMatch(/^[\x20-\x7e]*$/);
    expect(Array.from(decodeURIComponent(extended(khmer) as string)).length).toBeLessThanOrEqual(200);
    expect(decodeURIComponent(extended(khmer) as string)).toMatch(/\.csv$/);
    expect((fallback(khmer) as string).length).toBeLessThanOrEqual(200);
    expect(setOnRealResponse(khmer)).toBe(khmer);
  });

  it("bounding never splits a character in two (no stray half of a surrogate pair)", () => {
    const header = attachmentDisposition(`${"😀".repeat(250)}.zip`);
    const decoded = decodeURIComponent(extended(header) as string);
    expect(decoded).not.toContain("\ufffd");
    expect(decoded).toMatch(/^(😀)+\.zip$/u);
  });

  it("a lone surrogate (text damaged elsewhere) does not make the header throw", () => {
    const header = attachmentDisposition("students-A\ud800B.csv");
    expect(setOnRealResponse(header)).toBe(header);
    expect(decodeURIComponent(extended(header) as string)).toBe("students-A\ufffdB.csv");
  });

  it("an empty name falls back to a plain default", () => {
    expect(attachmentDisposition("")).toBe('attachment; filename="download"');
    expect(attachmentDisposition('""')).toBe('attachment; filename="download"');
    expect(attachmentDisposition(undefined as unknown as string)).toBe('attachment; filename="download"');
  });

  it("an accented Latin name falls back to its plain letters", () => {
    const header = attachmentDisposition("students-Écoleà.csv");
    expect(fallback(header)).toBe("students-Ecolea.csv");
    expect(decodeURIComponent(extended(header) as string)).toBe("students-Écoleà.csv");
  });

  it("a non-ASCII space (as some locales put in a time of day) is a space in the fallback", () => {
    const header = attachmentDisposition("log-6:48:23\u202fPM.zip");
    expect(fallback(header)).toBe("log-6:48:23 PM.zip");
    expect(setOnRealResponse(header)).toBe(header);
  });

  it("characters RFC 5987 reserves are percent-encoded in filename*", () => {
    const header = attachmentDisposition(`a'b(c)d*e${KHMER_SCHOOL}.csv`);
    expect(extended(header)).not.toMatch(/['()*]/);
    expect(decodeURIComponent(extended(header) as string)).toBe(`a'b(c)d*e${KHMER_SCHOOL}.csv`);
  });
});
