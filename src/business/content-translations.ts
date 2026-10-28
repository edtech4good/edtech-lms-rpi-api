import { chunk } from "lodash";
import { Op } from "sequelize";
import {
  CONTENT_TRANSLATIONS_HEADER_VALUE,
  NO_SUBKEY,
  TRANSLATABLE_FIELDS,
  isAnswerBearing,
  sourceHash,
} from "src/constants/content-translations";
import { contenttranslations } from "src/models/data-models/contenttranslations";
import { organisations } from "src/models/data-models/organisations";
import { Token } from "src/models/token.model";

/**
 * The translations of the content rows a response carries (bilingual content, B-1), added ONLY when the request
 * names the capability header (`CONTENT_TRANSLATIONS_HEADER`, value "1"). Without the header a response is exactly
 * what it was before translations existed: a controller builds no `ContentTranslations` and no business method
 * reads a row from `contenttranslations`.
 *
 * With it, every row a route lists gains `translations: { "<language>": { "<field>": text, "<field>.<subkey>": text } }`
 * (`{}` when the row has none) and the response root gains the organisation's `contentlanguage` (`null` when it has
 * none). One query per table per request (per 1000 rows), never per row. Only the CALLER'S organisation's
 * translations are read (the token's `organisationid`); a translation of another organisation's row can never appear,
 * whatever the rows are.
 *
 * A translation is served only when it is still current: its `sourcehash` must equal the sha-256 of the row's base
 * text as the row carries it NOW. A mismatch (the base text changed after it was translated), a base text the row
 * does not carry (a field the route does not select, an option that no longer exists) and a field an answer is graded
 * by on that question's template are all left out: the learner sees the base text.
 */

type AnyRow = Record<string, unknown> & { get?: (key: string) => unknown; setDataValue?: (key: string, value: unknown) => void };

const PRIMARY_KEYS: Record<string, string> = {
  curriculums: "curriculumid",
  grades: "gradeid",
  levels: "levelid",
  lessons: "lessonid",
  lessonlearnings: "lessonlearningid",
  lessonpractices: "lessonpracticeid",
  lessonquizzes: "lessonquizid",
  lessonplans: "lessonplanid",
  questions: "questionid",
};

export type TranslatableTable = keyof typeof PRIMARY_KEYS;

/** Ids per query. */
const CHUNK = 1000;

/** A value off a row that is a Sequelize instance (an attribute or an included association) or a plain object. */
const read = (row: AnyRow, key: string): unknown => (typeof row.get === "function" ? row.get(key) : row[key]);

const asObject = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const entries = (value: unknown): Array<Record<string, unknown>> => {
  const list = asObject(value);
  return Array.isArray(list) ? list.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null) : [];
};

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** The base-language text a translation of `field` (and `subkey`) was made from, as the row carries it now. */
const baseText = (tablename: string, row: AnyRow, field: string, subkey: string): string | undefined => {
  if (tablename !== "questions") return text(read(row, field));
  switch (field) {
    case "questiontext":
      return text(read(row, "questiontext"));
    case "headingtext":
      return text((asObject(read(row, "questionheading")) as { headingtext?: unknown } | null | undefined)?.headingtext);
    case "questionoptiontext":
      return text(entries(read(row, "questionoptions")).find((o) => o.questionoptionid === subkey)?.questionoptiontext);
    case "questionassociatetext": {
      const associate = entries(read(row, "questionoptions")).find((o) => o.questionoptionid === subkey)?.questionassociate as { questionassociatetext?: unknown } | null | undefined;
      return text(associate?.questionassociatetext);
    }
    case "questiondistractortext":
      return text(entries(read(row, "questiondistractors")).find((d) => d.questiondistractorid === subkey)?.questiondistractortext);
    case "feedback": {
      const feedback = asObject(read(row, "questionfeedback")) as Record<string, unknown> | null | undefined;
      return feedback && typeof feedback === "object" && Object.prototype.hasOwnProperty.call(feedback, subkey) ? text(feedback[subkey]) : undefined;
    }
    default:
      return undefined;
  }
};

export class ContentTranslations {
  private language: Promise<string | null> | undefined;

  private constructor(private readonly organisationid: string) {}

  /**
   * The translations of this request, or undefined (do nothing, change nothing) unless the header is exactly "1" and
   * the caller belongs to an organisation.
   */
  static from(header: unknown, user?: Pick<Token, "organisationid">): ContentTranslations | undefined {
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== "string" || value.trim() !== CONTENT_TRANSLATIONS_HEADER_VALUE) return undefined;
    const organisationid = user?.organisationid;
    return typeof organisationid === "string" && organisationid.trim() !== "" ? new ContentTranslations(organisationid.trim()) : undefined;
  }

  /** The caller's organisation's `contentlanguage`, null when it has none (or no row). Asked once per request. */
  contentLanguage = (): Promise<string | null> => {
    this.language ??= organisations
      .scope("withContentLanguage")
      .findOne({ where: { organisationid: this.organisationid }, attributes: ["contentlanguage"], raw: true })
      .then((row) => (row as { contentlanguage?: string | null } | null)?.contentlanguage ?? null);
    return this.language;
  };

  /** A response body with the organisation's `contentlanguage` added at its root. */
  root = async <T extends object>(body: T): Promise<T & { contentlanguage: string | null }> => ({ ...body, contentlanguage: await this.contentLanguage() });

  /**
   * Adds `translations` to each row (a list, one row, or nothing). The rows are updated in place; a row that is a
   * Sequelize instance is given the value with `setDataValue`, so it is serialised with the rest.
   */
  decorate = async (tablename: TranslatableTable, rows: unknown): Promise<void> => {
    const list = (Array.isArray(rows) ? rows : [rows]).filter((r): r is AnyRow => typeof r === "object" && r !== null);
    if (list.length === 0) return;
    const pk = PRIMARY_KEYS[tablename];
    const allowed = TRANSLATABLE_FIELDS[tablename];
    const byId = new Map<string, AnyRow[]>();
    for (const row of list) {
      const id = text(read(row, pk));
      if (id === undefined) continue;
      byId.set(id.toLowerCase(), [...(byId.get(id.toLowerCase()) ?? []), row]);
    }
    const found: Array<{ rowid: string; field: string; subkey: string; language: string; text: string; sourcehash: string }> = [];
    for (const part of chunk([...new Set(list.map((r) => text(read(r, pk))).filter((id): id is string => id !== undefined))], CHUNK)) {
      found.push(
        ...((await contenttranslations.findAll({
          where: { organisationid: this.organisationid, tablename, rowid: { [Op.in]: part } },
          attributes: ["rowid", "field", "subkey", "language", "text", "sourcehash"],
          order: [["language", "ASC"], ["field", "ASC"], ["subkey", "ASC"]],
          raw: true,
        })) as unknown as typeof found),
      );
    }
    const translations = new Map<AnyRow, Record<string, Record<string, string>>>();
    for (const row of list) translations.set(row, {});
    for (const t of found) {
      if (!allowed.includes(t.field)) continue;
      for (const row of byId.get(String(t.rowid).toLowerCase()) ?? []) {
        const subkey = t.subkey ?? NO_SUBKEY;
        const base = baseText(tablename, row, t.field, subkey);
        if (base === undefined || sourceHash(base) !== String(t.sourcehash).toLowerCase()) continue; // stale or not on this row: untranslated
        if (tablename === "questions" && isAnswerBearing(read(row, "templatetypeid"), t.field)) continue;
        const forLanguage = (translations.get(row)![t.language] ??= {});
        forLanguage[subkey === NO_SUBKEY ? t.field : `${t.field}.${subkey}`] = t.text;
      }
    }
    for (const row of list) {
      const value = translations.get(row)!;
      if (typeof row.setDataValue === "function") row.setDataValue("translations", value);
      else row.translations = value;
    }
  };
}

/** The response body, with the organisation's `contentlanguage` at its root when translations were asked for, untouched otherwise. */
export const withContentLanguage = async <T extends object>(translations: ContentTranslations | undefined, body: T): Promise<T | (T & { contentlanguage: string | null })> =>
  translations ? translations.root(body) : body;
