/**
 * Builds the value of a `Content-Disposition: attachment` header for a download
 * whose file name contains text from the database or the request, such as a
 * school's name.
 *
 * Node refuses a header value holding any character above U+00FF
 * ("Invalid character in header content"), so a school with a Khmer name used
 * to answer 500 on every download whose name included it. The value built here
 * is always plain ASCII and carries the name twice, as browsers expect
 * (RFC 6266, RFC 5987):
 *
 *   attachment; filename="students-_.csv"; filename*=UTF-8''students-%E1%9E%9F.csv
 *
 * - `filename="..."` is an ASCII fallback for clients that ignore `filename*`.
 * - `filename*=UTF-8''...` is the full name, percent-encoded.
 *
 * A name that is already plain ASCII produces `attachment; filename="<name>"`
 * and nothing else, exactly what the controllers wrote before.
 */

const MAX_NAME_CODE_POINTS = 200;
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
const FALLBACK_NAME = "download";

/** Control characters, double quotes and backslashes never belong in a file name. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f"\\]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Keeps at most `max` code points, never splitting a character, and keeps a trailing extension. */
function bound(name: string, max: number): string {
  const points = Array.from(name);
  if (points.length <= max) return name;
  const extension = (EXTENSION.exec(name) ?? [""])[0];
  const room = Math.max(max - Array.from(extension).length, 1);
  return points.slice(0, room).join("") + extension;
}

/** RFC 5987 `attr-char`: everything else is percent-encoded as UTF-8. */
function encodeExtended(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** The name for clients that read only `filename=`: printable ASCII, no quotes, no backslashes. */
function asciiFallback(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/\p{Z}+/gu, " ")
    .replace(/[^\x20-\x7e]+/g, "_");
  return ascii.trim() === "" ? FALLBACK_NAME : ascii;
}

/**
 * @param fileName the full name the download should have, extension included,
 *   assembled by the caller exactly as before (prefix, school name, extension).
 */
export function attachmentDisposition(fileName: string): string {
  const clean = bound(
    String(fileName ?? "")
      .replace(LONE_SURROGATE, "\ufffd")
      .replace(UNSAFE, ""),
    MAX_NAME_CODE_POINTS
  );
  if (clean.trim() === "") return `attachment; filename="${FALLBACK_NAME}"`;
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return `attachment; filename="${clean}"`;
  return `attachment; filename="${asciiFallback(clean)}"; filename*=UTF-8''${encodeExtended(clean)}`;
}
