import joi from "joi";
import { ValidationException } from "src/models/ValidationException";
import { fieldForJoiDetail, humanizeJoiMessage } from "src/utils/joi-message";

/**
 * The body of `PUT /import/ownership` (see ownership.business.ts for what it
 * does). Strict on purpose: every key is named here and an unknown key is
 * refused, so a payload built for another format or another route cannot be
 * half-understood.
 *
 * It is checked by `validateOwnershipBody`, called from the handler, rather
 * than by the interceptor the other routes use: the handler must run for
 * the guard sweep to prove the sync key reaches it, and an empty body is
 * refused here with the same 400 either way.
 */

export const OWNERSHIP_FORMAT = 3;

/** The id shape every id in the body has: a uuid. It also keeps keys like `__proto__` out of the maps. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Organisation codes: 2 to 16 lower-case ASCII letters and digits (central's rule). */
export const ORGANISATION_CODE = /^[a-z0-9]{2,16}$/;

export const UI_THEMES = ["kids", "corporate"];

/** The most entries one call may carry per map. Generous for real data; stops a body that is only meant to exhaust memory. */
export const MAX_ORGANISATIONS = 1000;
export const MAX_SCHOOLS = 10000;
export const MAX_CONTENT_ROWS = 200000;

/** Control characters, and the bidirectional controls that reorder displayed text. Zero-width joiners stay: Khmer text uses them. */
const FORBIDDEN_IN_NAME = /[\p{Cc}‪-‮⁦-⁩]/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** The serialised settings JSON may be at most this many BYTES (not characters: Khmer text is 3 bytes a character). */
const MAX_SETTINGS_BYTES = 64 * 1024;

const id = joi.string().pattern(UUID);

/** The same uuid in two letter cases is one id to the database, so a map carrying both is ambiguous: refused, not resolved by taking the last. */
const noCaseDuplicates = (value: Record<string, unknown>, helpers: joi.CustomHelpers) => {
  const keys = Object.keys(value);
  return new Set(keys.map((k) => k.toLowerCase())).size === keys.length
    ? value
    : helpers.message({ custom: "{{#label}} names the same id more than once (ids are compared without regard to letter case)." });
};

const idMap = (max: number) =>
  joi
    .object()
    .pattern(UUID, id.required())
    .max(max)
    .custom(noCaseDuplicates)
    .required();

const displayText = (value: string, helpers: joi.CustomHelpers) =>
  !FORBIDDEN_IN_NAME.test(value) && HAS_LETTER_OR_DIGIT.test(value)
    ? value
    : helpers.error("string.pattern.base");

/** An https URL with no user info, at most 2048 characters. */
const logourl = joi
  .string()
  .max(2048)
  .uri({ scheme: ["https"] })
  .custom((value, helpers) => {
    const authority = /^https:\/\/([^/?#]*)/i.exec(value)?.[1] ?? "";
    return authority.includes("@") ? helpers.error("string.uri") : value;
  });

const brandingconfig = joi
  .object({
    logourl,
    displayname: joi.string().min(1).max(250).custom(displayText),
    tilecolour: joi.string().pattern(/^#[0-9a-fA-F]{6}$/),
  })
  .allow(null)
  .required();

/** Opaque to this API (it only stores it), so any object, but of bounded size. */
const settingsconfig = joi
  .object()
  .unknown(true)
  .custom((value, helpers) =>
    Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_SETTINGS_BYTES
      ? helpers.message({ custom: "{{#label}} is too large: at most 64 KB once written as JSON." })
      : value,
  )
  .allow(null)
  .required();

/** One `organisations` row, as `PUT /import/ownership` and a format-3 content payload both carry it. */
export const organisation = joi.object({
  organisationid: id.required(),
  organisationname: joi.string().min(1).max(250).custom(displayText).required(),
  organisationcode: joi.string().pattern(ORGANISATION_CODE).required(),
  organisationstatus: joi.boolean().strict().required(),
  uitheme: joi
    .string()
    .valid(...UI_THEMES)
    .required(),
  brandingconfig,
  settingsconfig,
  isdeleted: joi.boolean().strict().required(),
});

export const ownershipBody = joi.object({
  format: joi.number().valid(OWNERSHIP_FORMAT).strict().required(),
  organisations: joi
    .array()
    .items(organisation)
    .unique((a, b) => String(a.organisationid).toLowerCase() === String(b.organisationid).toLowerCase())
    .max(MAX_ORGANISATIONS)
    .required(),
  schools: idMap(MAX_SCHOOLS),
  content: joi
    .object({
      curriculums: idMap(MAX_CONTENT_ROWS),
      questions: idMap(MAX_CONTENT_ROWS),
      documents: idMap(MAX_CONTENT_ROWS),
      subjects: idMap(MAX_CONTENT_ROWS),
    })
    .required(),
});

export interface OwnershipOrganisation {
  organisationid: string;
  organisationname: string;
  organisationcode: string;
  organisationstatus: boolean;
  uitheme: string;
  brandingconfig: object | null;
  settingsconfig: object | null;
  isdeleted: boolean;
}

export interface OwnershipBody {
  format: 3;
  organisations: OwnershipOrganisation[];
  schools: Record<string, string>;
  content: {
    curriculums: Record<string, string>;
    questions: Record<string, string>;
    documents: Record<string, string>;
    subjects: Record<string, string>;
  };
}

/** Throws a 400 (INVALID_INPUT, with `fields`) unless the body is exactly the shape above. */
export function validateOwnershipBody(body: unknown): OwnershipBody {
  const { error } = ownershipBody.validate(body, { abortEarly: true, convert: false });
  if (error) {
    throw new ValidationException(
      error.details.map((details) => {
        const field = fieldForJoiDetail(["body", ...details.path], details.type);
        return { field, message: humanizeJoiMessage(field, details.type, details.message) };
      }),
    );
  }
  return body as OwnershipBody;
}
