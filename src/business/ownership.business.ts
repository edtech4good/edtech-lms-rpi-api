import { chunk, isEqual } from "lodash";
import { Op, QueryTypes, Transaction } from "sequelize";
import { Logger } from "src/config";
import { ApiError } from "src/models/ApiError";
import { curriculums } from "src/models/data-models/curriculums";
import { documents } from "src/models/data-models/documents";
import { organisations } from "src/models/data-models/organisations";
import { questions } from "src/models/data-models/questions";
import { schools } from "src/models/data-models/school";
import { subjects } from "src/models/data-models/subjects";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { OwnershipBody, OwnershipOrganisation } from "src/modules/import/ownership.request.validator";
import { dbinstance } from "src/services/dbservice";

/**
 * `PUT /import/ownership`: central tells this API which organisation owns each
 * school and each piece of content, without re-sending the content itself.
 *
 * The rules, all inside ONE transaction:
 *
 *  - The organisation rows are upserted by id (every column). That is the only
 *    place a row is created.
 *  - For each `id -> organisationid` entry the row's `organisationid` is set
 *    only if it is NULL. A row already owned by the SAME organisation is left
 *    as it is; a row owned by a DIFFERENT organisation is NOT changed and is
 *    reported under `disagreements`. Ownership is never moved by this call.
 *  - An id that no row here has is listed under `unknown`, never guessed at or
 *    created.
 *  - Rows here that the map does not mention are only COUNTED (`unmapped`).
 *  - Nothing is deleted, and no password, login or any other column is
 *    written: the only columns that change are `organisationid` on the five
 *    tables and the rows of `organisations`. (A plain content sync, which wipes
 *    and re-creates rows, is exactly what this call exists to avoid.)
 *
 * Calling it again with the same body applies nothing.
 */

type OwnedModel = typeof schools | typeof curriculums | typeof questions | typeof documents | typeof subjects;
type TableKey = "schools" | "curriculums" | "questions" | "documents" | "subjects";

interface OwnedTable {
  /** The name of the table in the request and in every part of the response. */
  key: TableKey;
  /** The SQL table, which is the same name. */
  table: string;
  pk: string;
  model: OwnedModel;
  ids: (body: OwnershipBody) => Record<string, string>;
}

const OWNED_TABLES: OwnedTable[] = [
  { key: "schools", table: "schools", pk: "schoolid", model: schools, ids: (b) => b.schools },
  { key: "curriculums", table: "curriculums", pk: "curriculumid", model: curriculums, ids: (b) => b.content.curriculums },
  { key: "questions", table: "questions", pk: "questionid", model: questions, ids: (b) => b.content.questions },
  { key: "documents", table: "documents", pk: "documentid", model: documents, ids: (b) => b.content.documents },
  { key: "subjects", table: "subjects", pk: "subjectid", model: subjects, ids: (b) => b.content.subjects },
];

export interface OwnershipDisagreement {
  table: TableKey;
  id: string;
  /** The organisation that owns the row here. */
  current: string;
  /** The organisation the body asked for. */
  requested: string;
}

/** At most this many disagreements are listed in the response; `disagreementCount` is always the full number. */
export const MAX_LISTED_DISAGREEMENTS = 500;

export interface OwnershipResult {
  applied: { organisations: number } & Record<TableKey, number>;
  /** The first MAX_LISTED_DISAGREEMENTS only. */
  disagreements: OwnershipDisagreement[];
  /** How many rows disagreed in all. */
  disagreementCount: number;
  unknown: Record<TableKey, string[]>;
  unmapped: Record<TableKey, number>;
}

/** Ids per query: far below MySQL's packet limit, and keeps each lock set small. */
const CHUNK = 500;

const ORGANISATION_COLUMNS: Array<keyof OwnershipOrganisation> = [
  "organisationname",
  "organisationcode",
  "organisationstatus",
  "uitheme",
  "brandingconfig",
  "settingsconfig",
  "isdeleted",
];

const emptyByTable = <T>(make: () => T): Record<TableKey, T> => ({
  schools: make(),
  curriculums: make(),
  questions: make(),
  documents: make(),
  subjects: make(),
});

/** The comparison the database's own (case-insensitive) collation makes for ids. */
const sameId = (a: string | null | undefined, b: string | null | undefined): boolean =>
  typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

export class OwnershipBusiness {
  /**
   * Refuses the call, with a 503 and a message that says what to do, when the
   * schema this route writes to is not there: running it against a database
   * the migrations have not reached would otherwise end in a raw column error.
   */
  assertSchemaReady = async (): Promise<void> => {
    const rows = (await dbinstance.getdbinstance().query(
      `SELECT DISTINCT TABLE_NAME AS tbl FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'organisationid'
          AND TABLE_NAME IN ('organisations','schools','curriculums','questions','documents','subjects')`,
      { type: QueryTypes.SELECT }
    )) as Array<{ tbl: string }>;
    const present = new Set(rows.map((r) => String(r.tbl).toLowerCase()));
    const required = ["organisations", ...OWNED_TABLES.map((t) => t.table)];
    if (required.some((t) => !present.has(t))) {
      throw new ApiError(ErrorCode.SERVICE_UNAVAILABLE, {
        message:
          "This database has not been migrated for organisations yet. Run the pending migrations, then try again.",
      });
    }
  };

  apply = async (body: OwnershipBody): Promise<OwnershipResult> => {
    await this.assertSchemaReady();

    const result: OwnershipResult = {
      applied: { organisations: 0, schools: 0, curriculums: 0, questions: 0, documents: 0, subjects: 0 },
      disagreements: [],
      disagreementCount: 0,
      unknown: emptyByTable<string[]>(() => []),
      unmapped: emptyByTable<number>(() => 0),
    };

    const transaction = await dbinstance.getdbinstance().transaction();
    try {
      await this.assertOrganisationsExist(body, transaction);
      result.applied.organisations = await this.upsertOrganisations(body.organisations, transaction);
      for (const table of OWNED_TABLES) {
        await this.applyTable(table, table.ids(body), result, transaction);
      }
      await transaction.commit();
    } catch (e) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        Logger.error("import ownership rollback failed", { error: rollbackError });
      }
      throw e;
    }

    Logger.info("import ownership", {
      applied: result.applied,
      disagreements: result.disagreementCount,
      unknown: Object.fromEntries(Object.entries(result.unknown).map(([k, v]) => [k, v.length])),
      unmapped: result.unmapped,
    });
    return result;
  };

  /**
   * Every organisation a map names must exist once the organisation rows are in:
   * either in the body or already here. Otherwise the foreign key would refuse
   * the write half-way through, so the whole call is refused up front.
   */
  private assertOrganisationsExist = async (body: OwnershipBody, transaction: Transaction): Promise<void> => {
    const inBody = new Set(body.organisations.map((o) => o.organisationid.toLowerCase()));
    const referenced = new Set<string>();
    for (const table of OWNED_TABLES) {
      for (const organisationid of Object.values(table.ids(body))) {
        if (!inBody.has(organisationid.toLowerCase())) {
          referenced.add(organisationid);
        }
      }
    }
    if (referenced.size === 0) {
      return;
    }
    const found = new Set<string>();
    for (const part of chunk([...referenced], CHUNK)) {
      const rows = await organisations.findAll({
        where: { organisationid: { [Op.in]: part } },
        attributes: ["organisationid"],
        transaction,
      });
      for (const row of rows) {
        found.add(row.organisationid.toLowerCase());
      }
    }
    if ([...referenced].some((organisationid) => !found.has(organisationid.toLowerCase()))) {
      throw new ApiError(ErrorCode.INVALID_INPUT, {
        message: "A school or content entry names an organisation that is neither in this request nor known here.",
      });
    }
  };

  /** Creates a missing organisation row, updates one that differs, leaves the rest. Returns how many it wrote. */
  private upsertOrganisations = async (rows: OwnershipOrganisation[], transaction: Transaction): Promise<number> => {
    let written = 0;
    for (const part of chunk(rows, CHUNK)) {
      const existing = await organisations.findAll({
        where: { organisationid: { [Op.in]: part.map((o) => o.organisationid) } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const byId = new Map(existing.map((o) => [o.organisationid.toLowerCase(), o]));
      for (const row of part) {
        const current = byId.get(row.organisationid.toLowerCase());
        if (!current) {
          await organisations.create({ ...row }, { transaction });
          written += 1;
          continue;
        }
        const changed: Partial<OwnershipOrganisation> = {};
        for (const column of ORGANISATION_COLUMNS) {
          if (!isEqual(current.get(column), row[column])) {
            Object.assign(changed, { [column]: row[column] });
          }
        }
        if (Object.keys(changed).length > 0) {
          await current.update(changed, { transaction });
          written += 1;
        }
      }
    }
    return written;
  };

  private applyTable = async (
    table: OwnedTable,
    map: Record<string, string>,
    result: OwnershipResult,
    transaction: Transaction
  ): Promise<void> => {
    const { key, pk } = table;
    // Every owned model has the same two operations used here; the union type of
    // the five classes does not let TypeScript call them without a common shape.
    const model = table.model as typeof schools;
    const requested = new Map<string, string>(Object.entries(map).map(([id, org]) => [id.toLowerCase(), org]));
    const found = new Set<string>();
    const toFill = new Map<string, string[]>();

    for (const part of chunk(Object.entries(map), CHUNK)) {
      // `withOwnership`: the column is left out of ordinary queries (see
      // models/data-models/ownership-scope.ts). Locked, so a second call that
      // overlaps this one waits instead of reading the same NULLs.
      const rows = (await model.scope("withOwnership").findAll({
        where: { [pk]: { [Op.in]: part.map(([id]) => id) } },
        attributes: [pk, "organisationid"],
        raw: true,
        transaction,
        lock: transaction.LOCK.UPDATE,
      })) as unknown as Array<Record<string, string | null>>;

      for (const row of rows) {
        const id = String(row[pk]);
        const want = requested.get(id.toLowerCase());
        if (want === undefined) {
          continue;
        }
        found.add(id.toLowerCase());
        const current = row.organisationid;
        if (current === null || current === undefined) {
          const ids = toFill.get(want);
          if (ids) {
            ids.push(id);
          } else {
            toFill.set(want, [id]);
          }
        } else if (!sameId(current, want)) {
          result.disagreementCount += 1;
          if (result.disagreements.length < MAX_LISTED_DISAGREEMENTS) {
            result.disagreements.push({ table: key, id, current, requested: want });
          }
        }
      }
    }

    for (const [organisationid, ids] of toFill) {
      for (const part of chunk(ids, CHUNK)) {
        // Only rows still NULL: the NULL test is repeated in the statement, so
        // a row that gained an owner since it was read is never overwritten.
        const [count] = await model.update(
          { organisationid },
          { where: { [pk]: { [Op.in]: part }, organisationid: null }, transaction }
        );
        result.applied[key] += count;
      }
    }

    result.unknown[key] = Object.keys(map).filter((id) => !found.has(id.toLowerCase()));
    const total = await model.count({ transaction });
    result.unmapped[key] = Math.max(0, total - found.size);
  };
}
