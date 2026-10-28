import { createHash } from "node:crypto";

/**
 * Translations of learner-visible content text (`contenttranslations`, design note
 * docs/bilingual-content-design.md in the workspace repository).
 *
 * The existing columns keep the text in the organisation's base language (`organisations.contentlanguage`); a
 * translation row carries the same field in another language, the sha-256 of the base text it translated
 * (`sourcehash`), and is hard-deleted, never soft.
 */

/**
 * The request header a client sends to ask for `translations` on every content row it reads (and the
 * organisation's `contentlanguage` at the root of the response). Only the exact value "1" turns it on; without
 * it a response is exactly what it was before translations existed. It is listed in `src/cors-options.ts`.
 */
export const CONTENT_TRANSLATIONS_HEADER = "X-Content-Translations";
export const CONTENT_TRANSLATIONS_HEADER_VALUE = "1";

/** `contenttranslations.subkey` for a field that has none. The column is NOT NULL: MySQL treats NULLs in a unique key as distinct. */
export const NO_SUBKEY = "";

/** A language code: 2 to 8 letters, digits and hyphens (`km`, `en`, `pt-BR`). */
export const LANGUAGE_CODE = /^[A-Za-z0-9-]{2,8}$/;

/** A language code as it is stored: its primary subtag (everything before the first hyphen) in lower case (`KM` is `km`, `PT-BR` is `pt-BR`). */
export const normaliseLanguage = (code: string): string => {
  const dash = code.indexOf("-");
  return dash === -1 ? code.toLowerCase() : code.slice(0, dash).toLowerCase() + code.slice(dash);
};

/** The longest `contenttranslations.subkey`: an option id of the seed (`<uuid>-opt-1`, 42 characters) fits. */
export const SUBKEY_MAX_LENGTH = 64;

/** The most bytes of one translated text (the column is TEXT). */
export const TRANSLATION_TEXT_MAX_BYTES = 65535;

/** The tables whose rows can be translated, and for each the fields (Phase 1: display text only). */
export const TRANSLATABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  curriculums: ["curriculumname", "curriculumdescription"],
  grades: ["gradename", "gradedescription"],
  levels: ["levelname", "leveldescription"],
  lessons: ["lessonname", "lessondescription"],
  lessonlearnings: ["lessonlearningname", "lessonlearningdescription"],
  lessonpractices: ["lessonpracticename", "lessonpracticedescription"],
  lessonquizzes: ["lessonquizname", "lessonquizdescription"],
  lessonplans: ["lessonplanname", "lessonplandescription"],
  // Text inside the JSON of a question: the heading (`questionheading.headingtext`), the option, matching-partner and
  // distractor texts (subkey = the option / distractor id) and the two feedback messages (subkey = the message key).
  questions: ["questiontext", "headingtext", "questionoptiontext", "questionassociatetext", "questiondistractortext", "feedback"],
};

export const TRANSLATION_TABLES = Object.keys(TRANSLATABLE_FIELDS);

/** Fields whose translation needs a subkey (`''` for every other field). */
export const SUBKEYED_FIELDS: readonly string[] = ["questionoptiontext", "questionassociatetext", "questiondistractortext", "feedback"];

/** The subkeys of `feedback`: the keys of `questions.questionfeedback`. */
export const FEEDBACK_KEYS: readonly string[] = ["correctmessage", "incorrectmessage"];

/**
 * The fields of a question that an answer is graded by, per template id (decision 8: never translated). Derived from
 * `src/business/grading` and the app's renderers:
 *  - 21 (FOption1): the learner types each option's text and it is compared with `questionoptiontext`
 *    (`gradeFOption1`); `questiontext` holds the blank markers (one input per option).
 *  - 8 (FillInBlank): `questiontext` holds the blank markers that the tiles are placed against.
 *  - 23 (FOption4): `questiontext` is split on the `-----` markers and blank i is placed against option i, as in 21;
 *    the option text is graded by `questionoptionvalue`, so it stays translatable.
 * Every other template is graded by option id, flag, sequence or numeric value (`gradeChoice`, `gradeOrder`,
 * `gradeMatch`, `gradeBlanks` by id and sequence; templates 19, 20, 22, 23, 24 by `questionoptionvalue`,
 * `questioncorrectvalue` and the numerator/denominator values), none of which is a translatable field, so their option
 * text is display text and may be translated.
 */
export const ANSWER_BEARING_FIELDS: Readonly<Record<number, readonly string[]>> = {
  8: ["questiontext"],
  21: ["questiontext", "questionoptiontext"],
  23: ["questiontext"],
};

export const isAnswerBearing = (templatetypeid: unknown, field: string): boolean => {
  const template = typeof templatetypeid === "string" && templatetypeid.trim() !== "" ? Number(templatetypeid) : templatetypeid;
  return typeof template === "number" && (ANSWER_BEARING_FIELDS[template] ?? []).includes(field);
};

/** The `sourcehash` of a base text: the lower-case hex sha-256 of its UTF-8 bytes, with no normalisation. */
export const sourceHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
