/**
 * Media library, phase 0 (design note, sections 5 to 7): what a `documents` row may carry besides
 * the storage key (`documentname`, which stays the key) and its type.
 *
 * Every rule here is a pure function of a value. The format-3 import applies them to a row only when
 * the row carries the column (an export from before the media library has none of the three).
 */

/** `documents.documenttypeid` of a VIDEO document (src/models/enums/filetype.enum.ts). */
export const VIDEO_DOCUMENT_TYPE_ID = 2;

/** The one licence a document has until someone records another. The column is NOT NULL with this default. */
export const DEFAULT_DOCUMENT_LICENCE = "unspecified";

const CC_FAMILY = ["CC-BY", "CC-BY-SA", "CC-BY-NC", "CC-BY-NC-SA", "CC-BY-ND", "CC-BY-NC-ND"] as const;
const CC_VERSIONS = ["4.0", "3.0", "2.0"] as const;

/**
 * The closed list of licence ids (design note section 6): CC0, the CC BY family at 4.0, 3.0 and 2.0,
 * the SPDX local id for "all rights reserved", and `unspecified` (not recorded). Adding one is a code
 * change here, on the student API first (it refuses an id it does not know).
 */
export const DOCUMENT_LICENCES: readonly string[] = [
  "CC0-1.0",
  ...CC_FAMILY.flatMap((family) => CC_VERSIONS.map((version) => `${family}-${version}`)),
  "LicenseRef-all-rights-reserved",
  DEFAULT_DOCUMENT_LICENCE,
];

export const isDocumentLicence = (value: unknown): value is string => typeof value === "string" && DOCUMENT_LICENCES.includes(value);

export const DOCUMENT_TITLE_MAX = 255;
export const ATTRIBUTION_VERSION = 1;
export const ATTRIBUTION_AUTHOR_MAX = 255;
export const ATTRIBUTION_SOURCEURL_MAX = 2048;
export const ATTRIBUTION_ADAPTEDFROM_MAX = 1024;
export const ATTRIBUTION_MAX_BYTES = 4096;
const ATTRIBUTION_TEXT_KEYS = ["author", "sourceurl", "adaptedfrom"] as const;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * The title as it is stored: trimmed, and null when nothing is left; or `invalid` when it cannot be
 * stored at all (not a string, a control character, longer than 255 UTF-16 code units once trimmed).
 * A null title is "show `documentname`". It is stored as sent otherwise: no Unicode normalisation.
 */
export const normaliseDocumentTitle = (value: unknown): { ok: true; value: string | null } | { ok: false } => {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > DOCUMENT_TITLE_MAX || CONTROL_CHARACTER.test(trimmed)) return { ok: false };
  return { ok: true, value: trimmed };
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * The attribution as it is stored (design note section 6): `{ v: 1, author?, sourceurl?, adaptedfrom? }` or
 * null. An empty (or blank) string is an absent key; an object left with no key besides `v` is null. Refused
 * (`invalid`): anything that is not null or a plain object; a `v` other than 1; a key other than the four; a
 * value that is not a string; a string over its bound; a `sourceurl` that is not an http(s) URL; a whole
 * object over 4 KiB.
 */
export const normaliseDocumentAttribution = (value: unknown): { ok: true; value: Record<string, unknown> | null } | { ok: false } => {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false };
  const given = value as Record<string, unknown>;
  if (given.v !== ATTRIBUTION_VERSION) return { ok: false };
  const allowed = new Set<string>(["v", ...ATTRIBUTION_TEXT_KEYS]);
  if (Object.keys(given).some((key) => !allowed.has(key))) return { ok: false };
  const bounds = { author: ATTRIBUTION_AUTHOR_MAX, sourceurl: ATTRIBUTION_SOURCEURL_MAX, adaptedfrom: ATTRIBUTION_ADAPTEDFROM_MAX };
  const kept: Record<string, unknown> = { v: ATTRIBUTION_VERSION };
  for (const key of ATTRIBUTION_TEXT_KEYS) {
    const text = given[key];
    if (text === undefined) continue;
    if (typeof text !== "string") return { ok: false };
    const trimmed = text.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > bounds[key]) return { ok: false };
    if (key === "sourceurl" && !isHttpUrl(trimmed)) return { ok: false };
    kept[key] = trimmed;
  }
  if (Buffer.byteLength(JSON.stringify(kept), "utf8") > ATTRIBUTION_MAX_BYTES) return { ok: false };
  return { ok: true, value: Object.keys(kept).length === 1 ? null : kept };
};
