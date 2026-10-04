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
import { OrganisationContent, Row, TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";
import { SyncBusiness } from "./sync.business";

/**
 * Imports a format-3 content payload (see organisation-content.validator.ts for
 * the payload) as a scoped replace of ONE organisation's content, inside the
 * caller's transaction.
 *
 *  1. The organisation row is upserted by id.
 *  2. The payload's owned rows are checked against what is here: a row whose id is
 *     already owned by ANOTHER organisation refuses the whole file (400). A row
 *     whose id is here with no owner is the same row (ids are central's) and takes
 *     the header's organisation when it is written; those are counted as `adopted`.
 *  3. This organisation's content is deleted: its questions, documents and
 *     subjects (by `organisationid`), and everything under its curricula (the
 *     ones it owns here plus the ones in the payload): baselines, grades, levels,
 *     lessons, learnings, plans, practices, quizzes and their attach rows; and the
 *     standards of its schools. Nothing owned by another organisation and nothing
 *     with no owner is deleted. Schools are NOT deleted (learners hold ids into
 *     them).
 *  4. The payload's rows are written with their owners. Schools, curricula and
 *     countries are upserted by id; a child row whose id is still here after step 3
 *     belongs to something else, and refuses the file (400).
 *  5. This organisation's schools and curricula that the payload no longer has are
 *     marked `isdeleted` (learners hold ids into them), never destroyed.
 *  6. Learners and logins that were pushed before their school are given their
 *     `schoolid` (the same fill the old master import runs).
 *
 * Countries are global: upserted, never deleted. Nothing else is touched. The
 * caller commits (or rolls back) the transaction.
 */

export interface TableCounts {
  /** Rows deleted from the table. */
  deleted: number;
  /** Rows written after the delete. */
  inserted: number;
  /** Rows written by upsert (the table's rows are never all deleted first). */
  upserted: number;
  /** Rows kept but marked `isdeleted` because the payload no longer has them. */
  markedDeleted: number;
  /** Rows written over an existing row with no owner, which now has the organisation. */
  adopted: number;
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

const emptyCounts = (): TableCounts => ({ deleted: 0, inserted: 0, upserted: 0, markedDeleted: 0, adopted: 0 });
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
    const { organisationid, tables } = content;
    const t = this.transaction;

    // What this organisation owns here now, before anything is changed.
    const ownedSchoolsBefore = await this.idsOwnedBy("schools", organisationid);
    const ownedCurriculaBefore = await this.idsOwnedBy("curriculums", organisationid);

    // Refused from reads alone, before the first write.
    await this.refuseRowsOfOtherOrganisations(content);

    await organisations.bulkCreate([{ ...content.organisation }] as never, { transaction: t, updateOnDuplicate: ORGANISATION_UPDATE as never });
    this.counts.organisations.upserted = 1;

    // ---- delete this organisation's content --------------------------------
    const curriculumIds = this.union(ownedCurriculaBefore, tables.curriculums.map((r) => String(r.curriculumid)));
    const schoolIds = this.union(ownedSchoolsBefore, tables.schools.map((r) => String(r.schoolid)));
    await this.deleteCurriculumChildren(curriculumIds);
    await this.deleteWhere("standards", "schoolid", schoolIds);
    for (const key of ["questions", "documents", "subjects"] as const) {
      this.counts[key].deleted = await MODELS[key].destroy({ where: { organisationid }, transaction: t });
    }

    // A child row whose id is still here is not this organisation's: refuse the file.
    await this.refuseStrayChildren(content);

    // ---- write the payload ---------------------------------------------------
    const owned = (key: TableKey): Row[] => tables[key].map((r) => ({ ...r, organisationid }));
    await this.write("documents", owned("documents"), "inserted");
    await this.write("questions", owned("questions"), "inserted");
    await this.write("subjects", owned("subjects"), "inserted");
    await this.write("countries", tables.countries, "upserted");
    await this.write("schools", owned("schools"), "upserted");
    await this.write("standards", tables.standards, "inserted");
    await this.write("curriculums", owned("curriculums"), "upserted");
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
      await this.write(key, tables[key], "inserted");
    }

    // ---- what the payload no longer has ---------------------------------------
    await this.markMissing("schools", organisationid, ownedSchoolsBefore, tables.schools);
    await this.markMissing("curriculums", organisationid, ownedCurriculaBefore, tables.curriculums);

    await new SyncBusiness(t).linkRosterToSchools();
  };

  // ---------------------------------------------------------------------------

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

  private union = (a: string[], b: string[]): string[] => {
    const seen = new Map<string, string>();
    for (const id of [...a, ...b]) {
      if (!seen.has(lower(id))) seen.set(lower(id), id);
    }
    return [...seen.values()];
  };

  /**
   * A payload row of an owned table whose id is here under a DIFFERENT
   * organisation refuses the whole file, naming the table and how many rows. A
   * row whose id is here with no owner is counted as adopted.
   */
  private refuseRowsOfOtherOrganisations = async (content: OrganisationContent): Promise<void> => {
    const header = lower(content.organisationid);
    const refused: string[] = [];
    for (const key of OWNED) {
      const pk = PKS[key];
      let foreign = 0;
      let adopted = 0;
      for (const part of chunk(content.tables[key].map((r) => String(r[pk])), CHUNK)) {
        const found = (await MODELS[key].scope("withOwnership").findAll({
          attributes: [pk, "organisationid"],
          where: { [pk]: { [Op.in]: part } },
          raw: true,
          transaction: this.transaction,
        })) as unknown as Array<Record<string, string | null>>;
        for (const row of found) {
          const owner = row.organisationid;
          if (owner === null || owner === undefined || owner === "") adopted += 1;
          else if (lower(String(owner)) !== header) foreign += 1;
        }
      }
      this.counts[key].adopted = adopted;
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

  /** Everything under the curricula, children first. */
  private deleteCurriculumChildren = async (curriculumIds: string[]): Promise<void> => {
    const idsWhere = async (key: TableKey, column: string, parents: string[]): Promise<string[]> => {
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
    const gradeIds = await idsWhere("grades", "curriculumid", curriculumIds);
    const levelIds = await idsWhere("levels", "gradeid", gradeIds);
    const lessonIds = await idsWhere("lessons", "levelid", levelIds);
    const practiceIds = await idsWhere("lessonpractices", "lessonid", lessonIds);
    const quizIds = await idsWhere("lessonquizzes", "lessonid", lessonIds);
    const baselineIds = await idsWhere("curriculumbaselines", "curriculumid", curriculumIds);

    await this.deleteWhere("lessonquizquestions", "lessonquizid", quizIds);
    await this.deleteWhere("lessonpracticequestions", "lessonpracticeid", practiceIds);
    await this.deleteWhere("levelquizquestions", "levelid", levelIds);
    await this.deleteWhere("lessonquizzes", "lessonid", lessonIds);
    await this.deleteWhere("lessonpractices", "lessonid", lessonIds);
    await this.deleteWhere("lessonlearnings", "lessonid", lessonIds);
    await this.deleteWhere("lessonplans", "lessonid", lessonIds);
    await this.deleteWhere("lessons", "levelid", levelIds);
    await this.deleteWhere("levels", "gradeid", gradeIds);
    await this.deleteWhere("grades", "curriculumid", curriculumIds);
    await this.deleteWhere("baselinequestion", "curriculumbaselineid", baselineIds);
    await this.deleteWhere("curriculumbaselines", "curriculumid", curriculumIds);
  };

  private deleteWhere = async (key: TableKey, column: string, ids: string[]): Promise<void> => {
    for (const part of chunk(ids, CHUNK)) {
      this.counts[key].deleted += await MODELS[key].destroy({ where: { [column]: { [Op.in]: part } }, transaction: this.transaction });
    }
  };

  /** After the deletes, a payload child row whose id is still here is somebody else's: the file is refused. */
  private refuseStrayChildren = async (content: OrganisationContent): Promise<void> => {
    const refused: string[] = [];
    for (const key of TABLE_KEYS) {
      if (key === "countries" || OWNED.includes(key)) continue;
      let stray = 0;
      for (const part of chunk(content.tables[key].map((r) => String(r[PKS[key]])), CHUNK)) {
        stray += await MODELS[key].count({ where: { [PKS[key]]: { [Op.in]: part } }, transaction: this.transaction });
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

  private write = async (key: TableKey, list: Row[], as: "inserted" | "upserted"): Promise<void> => {
    const update = OWNED_UPDATE[key];
    for (const part of chunk(list, WRITE_CHUNK[key] ?? CHUNK)) {
      await this.bulkWrite(key, part, update);
    }
    this.counts[key][as] += list.length;
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
