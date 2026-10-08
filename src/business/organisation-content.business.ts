import { chunk } from "lodash";
import { Op, Transaction, UniqueConstraintError } from "sequelize";
import { Logger } from "src/config";
import { ApiError } from "src/models/ApiError";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { countries } from "src/models/data-models/countries";
import {
  curriculumbaseline,
  curriculums,
  documents,
  grades,
  lessonlearnings,
  lessonpracticequestions,
  lessonpractices,
  lessonquizquestions,
  lessonquizzes,
  lessons,
  levelquizquestions,
  levels,
  organisations,
  questions,
} from "src/models/data-models/init-models";
import { lessonplans } from "src/models/data-models/lessonplan";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { subjects } from "src/models/data-models/subjects";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { dbinstance } from "src/services/dbservice";
import { CONTENT_TABLES, OrganisationContent, Row, TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";
import { SyncBusiness } from "./sync.business";

/**
 * Imports a format-3 content payload (see organisation-content.validator.ts for
 * the payload) as a scoped replace of ONE organisation's content, inside the
 * caller's transaction.
 *
 *  1. The organisation row is upserted by id.
 *  2. The payload's owned rows are checked against what is here: a row whose id is
 *     already owned by ANOTHER organisation refuses the whole file (400). (Every
 *     stored row has an owner, since S4.)
 *  3. This organisation's content is replaced: its questions, documents and
 *     subjects (by `organisationid`) are deleted, and so is everything under the
 *     curricula IN the payload (baselines, grades, levels, lessons, learnings,
 *     plans, practices, quizzes and their attach rows) and the standards of the
 *     schools in the payload; the payload re-creates them under the same ids, so
 *     learners' progress stays valid. A curriculum or school of this organisation
 *     that the payload no longer has is not deleted, and neither is anything under
 *     it: it is marked `isdeleted` (step 5) and what hangs from it stays, inert.
 *     Nothing owned by another organisation and nothing with no owner is deleted.
 *  4. The payload's rows are written with their owners. Schools, curricula and
 *     countries are upserted by id. A child row whose id is still here after step 3
 *     is replaced by id when it sits under an absent curriculum or school of this
 *     organisation; under anything else it refuses the file (400).
 *  5. This organisation's schools and curricula that the payload no longer has are
 *     marked `isdeleted` (learners hold ids into them), never destroyed.
 *  6. Learners and logins stored before S4 with no `schoolid` are given it (a repair
 *     step: since S4 a roster is refused until its school is here, so none are left).
 *
 * Countries are global: upserted, never deleted. Nothing else is touched. The
 * caller commits (or rolls back) the transaction.
 */

export interface TableCounts {
  /** Rows deleted from the table. */
  deleted: number;
  /** Rows sent to the database for this table: inserted, or updated where the id was already here. (Not a count of rows the database changed.) */
  written: number;
  /** Rows kept but marked `isdeleted` because the payload no longer has them. */
  markedDeleted: number;
}

export type ContentCounts = Record<"organisations" | TableKey, TableCounts>;

export interface OrganisationContentResult {
  error: false;
  data: true;
  organisationid: string;
  counts: ContentCounts;
}

type AnyModel = typeof schools;

/** Ids per query / per write. */
const CHUNK = 1000;
const WRITE_CHUNK: Partial<Record<TableKey, number>> = { questions: 2000, documents: 2000, lessonlearnings: 25 };

const MODELS: Record<TableKey, AnyModel> = {
  schools,
  standards,
  countries,
  curriculums,
  curriculumbaselines: curriculumbaseline,
  baselinequestion,
  grades,
  levels,
  lessons,
  lessonlearnings,
  lessonplans,
  lessonpractices,
  lessonquizzes,
  lessonpracticequestions,
  lessonquizquestions,
  levelquizquestions,
  questions,
  documents,
  subjects,
} as unknown as Record<TableKey, AnyModel>;

const PKS: Record<TableKey, string> = {
  schools: "schoolid",
  standards: "standardid",
  countries: "countryid",
  curriculums: "curriculumid",
  curriculumbaselines: "curriculumbaselineid",
  baselinequestion: "baselinequestionid",
  grades: "gradeid",
  levels: "levelid",
  lessons: "lessonid",
  lessonlearnings: "lessonlearningid",
  lessonplans: "lessonplanid",
  lessonpractices: "lessonpracticeid",
  lessonquizzes: "lessonquizid",
  lessonpracticequestions: "lessonpracticequestionid",
  lessonquizquestions: "lessonquizquestionid",
  levelquizquestions: "levelquizquestionid",
  questions: "questionid",
  documents: "documentid",
  subjects: "subjectid",
};

const ORGANISATION_UPDATE = ["organisationname", "organisationcode", "organisationstatus", "uitheme", "brandingconfig", "settingsconfig", "isdeleted"];

/** The columns an upsert of an owned table overwrites: what the old import overwrote, and the owner. */
const OWNED_UPDATE: Partial<Record<TableKey, string[]>> = {
  schools: ["schoolname", "countryid", "curriculums", "expectedcontribution", "expectedusage", "isdeleted", "uitheme", "brandingconfig", "organisationid"],
  curriculums: ["curriculumname", "curriculumstatus", "curriculumdescription", "isdeleted", "subjectid", "organisationid"],
  questions: [
    "questionheading",
    "questionoptions",
    "questiontext",
    "questiondistractors",
    "questionfile",
    "questionfeedback",
    "templatetypeid",
    "isdeleted",
    "questionstatus",
    "questionidentifier",
    "questiontags",
    "questioncorrectvalue",
    "lastupdated",
    "organisationid",
  ],
  documents: ["documenttypeid", "documentname", "documents3meta", "isdeleted", "documenttags", "lastupdated", "organisationid"],
  subjects: ["subjectname", "subjectdescription", "subjectstatus", "isdeleted", "organisationid"],
};

const OWNED: TableKey[] = ["schools", "curriculums", "questions", "documents", "subjects"];

const emptyCounts = (): TableCounts => ({ deleted: 0, written: 0, markedDeleted: 0 });
const lower = (value: string) => value.toLowerCase();
const rows = (n: number) => (n === 1 ? "1 row" : `${n} rows`);

export class OrganisationContentImport {
  private readonly counts = {} as ContentCounts;

  constructor(private readonly transaction: Transaction) {
    for (const key of ["organisations", ...TABLE_KEYS] as Array<"organisations" | TableKey>) {
      this.counts[key] = emptyCounts();
    }
  }

  run = async (content: OrganisationContent): Promise<ContentCounts> => {
    const sequelize = dbinstance.getdbinstance();
    // As in the old master import: the order of the deletes and inserts below is
    // not constrained by the foreign keys, and the session setting is put back on
    // every path before the transaction ends.
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0", { transaction: this.transaction });
    try {
      await this.apply(content);
    } catch (e) {
      if (e instanceof UniqueConstraintError) {
        throw new ApiError(ErrorCode.INVALID_INPUT, {
          message:
            "A row in the payload has a value that must be unique (a school's name, for one) which a different row here already has. Nothing was written.",
        });
      }
      throw e;
    } finally {
      await sequelize.query("SET FOREIGN_KEY_CHECKS = 1", { transaction: this.transaction });
    }
    Logger.info(`import contents for one organisation: ${JSON.stringify({ organisationid: content.organisationid, counts: this.counts })}`);
    return this.counts;
  };

  private apply = async (content: OrganisationContent): Promise<void> => {
    const { organisationid } = content;
    const t = this.transaction;
    // Every owned row is written with this id: a header that is not one refuses the file before anything is read or written.
    if (typeof organisationid !== "string" || organisationid.trim().length === 0) {
      throw new ApiError(ErrorCode.INVALID_INPUT, { message: "The payload names no organisation. Nothing was written." });
    }

    // What this organisation owns here now, before anything is changed.
    const ownedSchoolsBefore = await this.idsOwnedBy("schools", organisationid);
    const ownedCurriculaBefore = await this.idsOwnedBy("curriculums", organisationid);

    // Refused from reads alone, before the first write.
    await this.refuseRowsOfOtherOrganisations(content);
    const tables = await this.trimLists(content);

    await organisations.bulkCreate([{ ...content.organisation }] as never, { transaction: t, updateOnDuplicate: ORGANISATION_UPDATE as never });
    this.counts.organisations.written = 1;

    // ---- delete this organisation's content --------------------------------
    // Only what is replaced is deleted. A curriculum or school this organisation owned that the
    // payload no longer has keeps its grades, levels, lessons, standards and the rest, inert:
    // learners' progress and `students.gradeid` still point at them.
    const payloadCurricula = tables.curriculums.map((r) => String(r.curriculumid));
    const payloadSchools = tables.schools.map((r) => String(r.schoolid));
    const absent = await this.absentFromPayload(
      this.without(ownedCurriculaBefore, payloadCurricula),
      this.without(ownedSchoolsBefore, payloadSchools),
    );
    await this.deleteCurriculumChildren(payloadCurricula, tables);
    await this.deleteWhere("standards", "schoolid", payloadSchools);
    for (const key of ["questions", "documents", "subjects"] as const) {
      this.counts[key].deleted = await MODELS[key].destroy({ where: { organisationid }, transaction: t });
    }

    // A child row whose id is still here is not this organisation's: refuse the file.
    await this.refuseStrayChildren(content, absent);

    // ---- write the payload ---------------------------------------------------
    const owned = (key: TableKey): Row[] => tables[key].map((r) => ({ ...r, organisationid }));
    await this.write("documents", owned("documents"));
    await this.write("questions", owned("questions"));
    await this.write("subjects", owned("subjects"));
    await this.write("countries", tables.countries);
    await this.write("schools", owned("schools"));
    await this.write("standards", tables.standards);
    await this.write("curriculums", owned("curriculums"));
    for (const key of [
      "curriculumbaselines",
      "baselinequestion",
      "grades",
      "levels",
      "lessons",
      "lessonlearnings",
      "lessonplans",
      "lessonpractices",
      "lessonquizzes",
      "lessonpracticequestions",
      "lessonquizquestions",
      "levelquizquestions",
    ] as const) {
      await this.write(key, tables[key]);
    }

    // ---- what the payload no longer has ---------------------------------------
    await this.markMissing("schools", organisationid, ownedSchoolsBefore, tables.schools);
    await this.markMissing("curriculums", organisationid, ownedCurriculaBefore, tables.curriculums);

    await new SyncBusiness(t).linkRosterToSchools();
  };

  // ---------------------------------------------------------------------------

  /**
   * The payload's columns that hold a list of ids of rows of another table (a school's
   * curricula, the schools a baseline is for) keep only the entries that are rows of the
   * payload. An entry that names a row owned by ANOTHER organisation here refuses the file;
   * any other entry the payload does not carry (owned by no one here, or here nowhere) is
   * dropped from the list that is stored, and counted in the log (no ids).
   */
  private trimLists = async (content: OrganisationContent): Promise<Record<TableKey, Row[]>> => {
    const header = lower(content.organisationid);
    const tables = { ...content.tables };
    const dropped: string[] = [];
    const foreign: string[] = [];
    for (const key of TABLE_KEYS) {
      for (const { fk, to } of CONTENT_TABLES[key].lists ?? []) {
        const inPayload = new Set(content.tables[to].map((r) => lower(String(r[PKS[to]]))));
        const outside = new Set<string>();
        for (const row of content.tables[key]) {
          for (const id of (row[fk] as string[] | null | undefined) ?? []) {
            if (!inPayload.has(lower(id))) outside.add(id);
          }
        }
        if (outside.size === 0) continue;
        const owners = new Map<string, string | null>();
        for (const part of chunk([...outside], CHUNK)) {
          const found = (await MODELS[to].scope("withOwnership").findAll({
            attributes: [PKS[to], "organisationid"],
            where: { [PKS[to]]: { [Op.in]: part } },
            raw: true,
            transaction: this.transaction,
          })) as unknown as Array<Record<string, string | null>>;
          for (const r of found) owners.set(lower(String(r[PKS[to]])), r.organisationid ?? null);
        }
        const isForeign = (id: string) => {
          const owner = owners.get(lower(id));
          return owner !== undefined && owner !== null && owner !== "" && lower(owner) !== header;
        };
        const foreignEntries = [...outside].filter(isForeign).length;
        if (foreignEntries > 0) {
          foreign.push(`${key}.${fk}: ${foreignEntries} ${foreignEntries === 1 ? "entry names a row" : "entries name rows"} owned by another organisation here`);
          continue;
        }
        let drops = 0;
        tables[key] = content.tables[key].map((row) => {
          const list = row[fk] as string[] | null | undefined;
          if (!Array.isArray(list)) return row;
          const kept = list.filter((id) => inPayload.has(lower(id)));
          drops += list.length - kept.length;
          return kept.length === list.length ? row : { ...row, [fk]: kept };
        });
        dropped.push(`${key}.${fk} ${drops}`);
      }
    }
    if (foreign.length > 0) {
      throw new ApiError(ErrorCode.INVALID_INPUT, {
        message: `The payload lists rows that belong to another organisation here. Nothing was written. ${foreign.join("; ")}.`,
        fields: foreign.map((message) => ({ field: message.split(".")[0], message })),
      });
    }
    if (dropped.length > 0) {
      Logger.info(`import contents for one organisation: list entries not in the payload were dropped (${dropped.join(", ")})`);
    }
    return tables;
  };

  /** The ids of the rows of an owned table that `organisationid` owns here (as stored). */
  private idsOwnedBy = async (key: TableKey, organisationid: string): Promise<string[]> => {
    const pk = PKS[key];
    const found = (await MODELS[key].scope("withOwnership").findAll({
      attributes: [pk],
      where: { organisationid },
      raw: true,
      transaction: this.transaction,
    })) as unknown as Array<Record<string, string>>;
    return found.map((r) => String(r[pk]));
  };

  /** The ids in `ids` that `others` does not have (compared without regard to letter case). */
  private without = (ids: string[], others: string[]): string[] => {
    const drop = new Set(others.map(lower));
    return ids.filter((id) => !drop.has(lower(id)));
  };

  /**
   * A payload row of an owned table whose id is here under a DIFFERENT
   * organisation refuses the whole file, naming the table and how many rows.
   */
  private refuseRowsOfOtherOrganisations = async (content: OrganisationContent): Promise<void> => {
    const header = lower(content.organisationid);
    const refused: string[] = [];
    for (const key of OWNED) {
      const pk = PKS[key];
      let foreign = 0;
      for (const part of chunk(content.tables[key].map((r) => String(r[pk])), CHUNK)) {
        const found = (await MODELS[key].scope("withOwnership").findAll({
          attributes: [pk, "organisationid"],
          where: { [pk]: { [Op.in]: part } },
          raw: true,
          transaction: this.transaction,
        })) as unknown as Array<Record<string, string | null>>;
        for (const row of found) {
          const owner = row.organisationid;
          if (owner !== null && owner !== undefined && owner !== "" && lower(String(owner)) !== header) foreign += 1;
        }
      }
      if (foreign > 0) {
        refused.push(`${key}: ${rows(foreign)} already belong${foreign === 1 ? "s" : ""} to another organisation here`);
      }
    }
    if (refused.length > 0) {
      throw new ApiError(ErrorCode.INVALID_INPUT, {
        message: `The payload names content that belongs to another organisation here. Nothing was written. ${refused.join("; ")}.`,
        fields: refused.map((message) => ({ field: message.split(":")[0], message })),
      });
    }
  };

  /** The ids of the rows of `key` whose `column` is one of `parents`. */
  private idsWhere = async (key: TableKey, column: string, parents: string[]): Promise<string[]> => {
    const pk = PKS[key];
    const out: string[] = [];
    for (const part of chunk(parents, CHUNK)) {
      const found = (await MODELS[key].findAll({
        attributes: [pk],
        where: { [column]: { [Op.in]: part } },
        raw: true,
        transaction: this.transaction,
      })) as unknown as Array<Record<string, string>>;
      out.push(...found.map((r) => String(r[pk])));
    }
    return out;
  };

  /**
   * The ids of the rows that other rows hang from, down from the curricula: what a delete or
   * a stray check needs to know. `carried` adds the ids the payload itself carries for a
   * table, so everything that hangs from a parent the payload names is found, wherever that
   * parent sits here now.
   */
  private chainOf = async (curriculumIds: string[], carried: Partial<Record<TableKey, Row[]>> = {}) => {
    const plus = (key: TableKey, found: string[]): string[] => [...found, ...(carried[key] ?? []).map((r) => String(r[PKS[key]]))];
    const baselines = plus("curriculumbaselines", await this.idsWhere("curriculumbaselines", "curriculumid", curriculumIds));
    const grades = plus("grades", await this.idsWhere("grades", "curriculumid", curriculumIds));
    const levels = plus("levels", await this.idsWhere("levels", "gradeid", grades));
    const lessons = plus("lessons", await this.idsWhere("lessons", "levelid", levels));
    return {
      curriculumbaselines: baselines,
      grades,
      levels,
      lessons,
      lessonpractices: plus("lessonpractices", await this.idsWhere("lessonpractices", "lessonid", lessons)),
      lessonquizzes: plus("lessonquizzes", await this.idsWhere("lessonquizzes", "lessonid", lessons)),
    };
  };

  /**
   * What this organisation owns here that the payload no longer has: those curricula and
   * schools, and the ids under them (read now, before the deletes; nothing here is changed).
   */
  private absentFromPayload = async (curriculumIds: string[], schoolIds: string[]): Promise<Partial<Record<TableKey, Set<string>>>> => {
    const chain = await this.chainOf(curriculumIds);
    const sets: Partial<Record<TableKey, Set<string>>> = { curriculums: new Set(curriculumIds.map(lower)), schools: new Set(schoolIds.map(lower)) };
    for (const [key, ids] of Object.entries(chain)) {
      sets[key as TableKey] = new Set(ids.map(lower));
    }
    return sets;
  };

  /**
   * What is under the curricula of the payload, and under every parent row the payload
   * carries (a grade that moved over from another curriculum brings its levels, lessons and
   * the rest with it): all of it is replaced by the payload's own rows, children first.
   */
  private deleteCurriculumChildren = async (curriculumIds: string[], carried: Record<TableKey, Row[]>): Promise<void> => {
    const chain = await this.chainOf(curriculumIds, carried);
    const baselineIds = chain.curriculumbaselines;

    await this.deleteWhere("lessonquizquestions", "lessonquizid", chain.lessonquizzes);
    await this.deleteWhere("lessonpracticequestions", "lessonpracticeid", chain.lessonpractices);
    await this.deleteWhere("levelquizquestions", "levelid", chain.levels);
    await this.deleteWhere("lessonquizzes", "lessonid", chain.lessons);
    await this.deleteWhere("lessonpractices", "lessonid", chain.lessons);
    await this.deleteWhere("lessonlearnings", "lessonid", chain.lessons);
    await this.deleteWhere("lessonplans", "lessonid", chain.lessons);
    await this.deleteWhere("lessons", "levelid", chain.levels);
    await this.deleteWhere("levels", "gradeid", chain.grades);
    await this.deleteWhere("grades", "curriculumid", curriculumIds);
    await this.deleteWhere("baselinequestion", "curriculumbaselineid", baselineIds);
    await this.deleteWhere("curriculumbaselines", "curriculumid", curriculumIds);
  };

  private deleteWhere = async (key: TableKey, column: string, ids: string[]): Promise<void> => {
    for (const part of chunk(ids, CHUNK)) {
      this.counts[key].deleted += await MODELS[key].destroy({ where: { [column]: { [Op.in]: part } }, transaction: this.transaction });
    }
  };

  /**
   * After the deletes, a payload child row whose id is still here is replaced (upserted by
   * id) only when it sits under a curriculum or school of this organisation that the
   * payload no longer has: the payload takes the row over. Any other row with that id is
   * somebody else's (another organisation's, or no one's), and the file is refused.
   */
  private refuseStrayChildren = async (content: OrganisationContent, absent: Partial<Record<TableKey, Set<string>>>): Promise<void> => {
    const refused: string[] = [];
    for (const key of TABLE_KEYS) {
      const parent = CONTENT_TABLES[key].parent;
      if (!parent) continue; // countries and the owned tables are not children
      const takeover = absent[parent.to] ?? new Set<string>();
      let stray = 0;
      for (const part of chunk(content.tables[key].map((r) => String(r[PKS[key]])), CHUNK)) {
        const found = (await MODELS[key].findAll({
          attributes: [PKS[key], parent.fk],
          where: { [PKS[key]]: { [Op.in]: part } },
          raw: true,
          transaction: this.transaction,
        })) as unknown as Array<Record<string, string | null>>;
        stray += found.filter((r) => !takeover.has(lower(String(r[parent.fk] ?? "")))).length;
      }
      if (stray > 0) {
        refused.push(`${key}: ${rows(stray)} already exist${stray === 1 ? "s" : ""} here outside this organisation's content`);
      }
    }
    if (refused.length > 0) {
      throw new ApiError(ErrorCode.INVALID_INPUT, {
        message: `The payload carries rows whose ids are already used by content that is not this organisation's. Nothing was written. ${refused.join("; ")}.`,
        fields: refused.map((message) => ({ field: message.split(":")[0], message })),
      });
    }
  };

  private write = async (key: TableKey, list: Row[]): Promise<void> => {
    const update = OWNED_UPDATE[key];
    for (const part of chunk(list, WRITE_CHUNK[key] ?? CHUNK)) {
      await this.bulkWrite(key, part, update);
    }
    this.counts[key].written += list.length;
  };

  private bulkWrite = async (key: TableKey, part: Row[], update: string[] | undefined): Promise<void> => {
    const sync = new SyncBusiness(this.transaction);
    const model = MODELS[key];
    switch (key) {
      // The tables with an owner are written here (the old writers do not know the column).
      case "schools":
      case "curriculums":
      case "questions":
      case "documents":
      case "subjects":
        await model.bulkCreate(part as never, { transaction: this.transaction, updateOnDuplicate: update as never });
        return;
      case "countries":
        await sync.countries(part as never);
        return;
      case "standards":
        await sync.standards(part as never);
        return;
      case "curriculumbaselines":
        await sync.curriculumbaseline(part as never);
        return;
      case "baselinequestion":
        await sync.baselinequestion(part as never);
        return;
      case "grades":
        await sync.grade(part as never);
        return;
      case "levels":
        await sync.level(part as never);
        return;
      case "lessons":
        await sync.lesson(part as never);
        return;
      case "lessonlearnings":
        await sync.lessonlearnings(part as never);
        return;
      case "lessonplans":
        await sync.lessonplans(part as never);
        return;
      case "lessonpractices":
        await sync.lessonpractices(part as never);
        return;
      case "lessonquizzes":
        await sync.lessonquizzes(part as never);
        return;
      case "lessonpracticequestions":
        await sync.lessonpracticequestions(part as never);
        return;
      case "lessonquizquestions":
        await sync.lessonquizquestions(part as never);
        return;
      case "levelquizquestions":
        await sync.levelquizquestions(part as never);
        return;
      default:
        throw new Error(`no writer for ${key}`);
    }
  };

  /** Rows this organisation owned here that the payload no longer has are kept and marked `isdeleted`. */
  private markMissing = async (key: "schools" | "curriculums", organisationid: string, before: string[], payload: Row[]): Promise<void> => {
    const pk = PKS[key];
    const kept = new Set(payload.map((r) => lower(String(r[pk]))));
    const missing = before.filter((id) => !kept.has(lower(id)));
    for (const part of chunk(missing, CHUNK)) {
      const [changed] = await MODELS[key].update({ isdeleted: true } as never, {
        where: { [pk]: { [Op.in]: part }, organisationid, isdeleted: false },
        transaction: this.transaction,
      });
      this.counts[key].markedDeleted += changed;
    }
  };
}
