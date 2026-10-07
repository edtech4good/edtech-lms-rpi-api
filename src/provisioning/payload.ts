import AdmZip from "adm-zip";
import { readFileSync, statSync } from "fs";
import { UploadLimits } from "src/constants/upload-limits";
import { ApiError } from "src/models/ApiError";
import {
  CONTENT_TABLES,
  OrganisationContent,
  Row,
  TABLE_KEYS,
  TableKey,
  validateOrganisationContent,
} from "src/modules/import/organisation-content.validator";
import { OwnershipOrganisation } from "src/modules/import/ownership.request.validator";
import { ProvisionError } from "./args";

/**
 * Reading a format-3 content payload and RE-HOMING it to the organisation of a classroom server.
 *
 * A payload is one organisation's content as central exported it, carrying central's organisation id and code.
 * A classroom server mints its own organisation (see provision.ts), so before the payload is imported it is
 * re-homed: it becomes that organisation's, and everything else about it stays exactly as it was.
 *
 * What `rehomeContent` rewrites:
 *  - the header's `organisationid` and `organisationcode`, and the one `organisations` row, which becomes the
 *    local organisation's row;
 *  - the `organisationid` of every row of an owned table (`curriculums`, `questions`, `documents`, `subjects`)
 *    and of any inherited row that carries one;
 *  - `schools`: the payload's schools describe other classrooms, and a classroom server holds one school, so
 *    they are replaced by the local school (owner: the local organisation; its `curriculums` list: every
 *    curriculum of the payload, which is how a teacher reaches them);
 *  - `standards` (classes): they hang from the schools just replaced, so the payload's are dropped and the
 *    local school's own classes (every one it has here, deleted ones too, with their ids and creation
 *    dates) go in their place, plus the class that was asked for if it is new. The import replaces the
 *    standards of every school in the payload, so a class left out of the payload would be destroyed;
 *  - a curriculum baseline's `schoolid` list (the schools it applies to): when it names any school it now names
 *    the local school, so the baseline applies where the payload meant it to;
 *  - `countries`: a country the payload carries that this server already has under another id (the name is
 *    unique, so the two cannot both be written) is replaced by THIS server's row, and every reference to the
 *    payload's id is rewritten to the local id; the school's country is added when the payload does not carry it.
 *
 * What it does NOT touch: content ids (so a later join to central can recognise the same curriculum, lesson or
 * question), content text, `countries` otherwise, and every row of the payload that has no owner column.
 */

export interface LocalIdentity {
  organisation: OwnershipOrganisation;
  school: {
    schoolid: string;
    schoolname: string;
    countryid: string | null;
    uitheme: string;
    brandingconfig: object | null;
    expectedcontribution: number | null;
    expectedusage: number | null;
  };
  /** Every class the local school has here (empty for a new school), and the class asked for if it is new. */
  standards: Array<{ standardid: string; standardname: string; isdeleted: boolean; created_at?: Date | null }>;
  /** A `countries` row to add to the payload when it does not carry the school's country. */
  country: Row | null;
  /** Every country this server has (rows of `countries`): a payload country of the same name is re-homed onto it. */
  localCountries: Row[];
}

export interface RehomeSummary {
  /** Rows whose owner was rewritten, per table. */
  ownersRewritten: Partial<Record<TableKey, number>>;
  schoolsInPayload: number;
  standardsInPayload: number;
  baselineListsRewritten: number;
  curricula: number;
  countryAdded: boolean;
  /** Payload countries replaced by this server's row of the same name. */
  countriesRemapped: number;
  /** Rows per table of the re-homed payload (what the import is given). */
  rows: Record<"organisations" | TableKey, number>;
}

export interface Rehomed {
  body: Record<string, unknown>;
  content: OrganisationContent;
  summary: RehomeSummary;
}

const lower = (value: string) => value.toLowerCase();

/** The parsed JSON of a `.zip` (its first entry, as `PUT /import/master` reads it) or a raw `.json` file. */
export function readContentFile(path: string): unknown {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new ProvisionError(`Cannot read the content file: ${path}`);
  }
  if (size > UploadLimits.MASTER_IMPORT_MAX_BYTES) {
    throw new ProvisionError("The content file is larger than this server accepts (200 MB).");
  }
  const buffer = readFileSync(path);
  try {
    if (buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const entries = new AdmZip(buffer).getEntries();
      if (entries.length === 0) throw new ProvisionError("The zip holds no file.");
      if (entries[0].header.size > UploadLimits.MASTER_ZIP_DECOMPRESSED_MAX_BYTES) {
        throw new ProvisionError("The content file unpacks to more than this server accepts (500 MB).");
      }
      return JSON.parse(entries[0].getData().toString("utf8"));
    }
    return JSON.parse(buffer.toString("utf8").replace(/^﻿/, ""));
  } catch (e) {
    if (e instanceof ProvisionError) throw e;
    throw new ProvisionError("The content file is neither a zip holding JSON nor a JSON file.");
  }
}

/** Refuses anything that is not a format-3 content payload (format 2 is retired), and every payload problem the HTTP import also refuses (mixed owners included). */
export function validatePayload(parsed: unknown): OrganisationContent {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || (parsed as Row).format !== 3) {
    throw new ProvisionError("The content is not a format-3 payload (one organisation's content). Format 2 is retired. Export it again from the admin.");
  }
  try {
    return validateOrganisationContent(parsed);
  } catch (e) {
    if (e instanceof ApiError) throw new ProvisionError(`The content payload is refused: ${e.message}`);
    throw e;
  }
}

const OWNED_KEYS = TABLE_KEYS.filter((key) => CONTENT_TABLES[key].kind === "owned" && key !== "schools");

export function rehomeContent(original: OrganisationContent, local: LocalIdentity): Rehomed {
  const localId = local.organisation.organisationid;
  const tables = {} as Record<TableKey, Row[]>;
  const ownersRewritten: Partial<Record<TableKey, number>> = {};

  for (const key of TABLE_KEYS) {
    if (key === "schools" || key === "standards") continue;
    const kind = CONTENT_TABLES[key].kind;
    let rewritten = 0;
    tables[key] = original.tables[key].map((row) => {
      if (kind === "owned") {
        if (row.organisationid !== localId) rewritten += 1;
        return { ...row, organisationid: localId };
      }
      // An inherited or global row has no owner of its own; one that carries one is rewritten like the rest.
      if (row.organisationid !== undefined && row.organisationid !== null && row.organisationid !== "") {
        rewritten += 1;
        return { ...row, organisationid: localId };
      }
      return row;
    });
    if (rewritten > 0) ownersRewritten[key] = rewritten;
  }

  // The school: one row, the local one, which lists every curriculum of the payload.
  const curriculumIds = tables.curriculums.map((row) => String(row.curriculumid));
  tables.schools = [
    {
      schoolid: local.school.schoolid,
      schoolname: local.school.schoolname,
      countryid: local.school.countryid,
      curriculums: curriculumIds,
      expectedcontribution: local.school.expectedcontribution,
      expectedusage: local.school.expectedusage,
      isdeleted: false,
      uitheme: local.school.uitheme,
      brandingconfig: local.school.brandingconfig,
      organisationid: localId,
    },
  ];
  tables.standards = local.standards.map((standard) => ({
    standardid: standard.standardid,
    standardname: standard.standardname,
    schoolid: local.school.schoolid,
    schoolname: local.school.schoolname,
    isdeleted: standard.isdeleted,
    ...(standard.created_at ? { created_at: standard.created_at } : {}),
  }));

  // A payload country this server already has by name, under another id, becomes the local row; references follow.
  const norm = (name: string) => name.trim().normalize("NFC").toLowerCase();
  const localByName = new Map(local.localCountries.map((row) => [norm(String(row.countryname)), row]));
  const countryIds = new Map<string, string>();
  const seenCountries = new Set<string>();
  const countryRows: Row[] = [];
  for (const row of tables.countries) {
    const mine = localByName.get(norm(String(row.countryname)));
    let out = row;
    if (mine && lower(String(mine.countryid)) !== lower(String(row.countryid))) {
      countryIds.set(lower(String(row.countryid)), String(mine.countryid));
      out = { countryid: mine.countryid, countryname: mine.countryname, expectedusage: mine.expectedusage ?? null, isdeleted: false };
    }
    if (!seenCountries.has(lower(String(out.countryid)))) {
      seenCountries.add(lower(String(out.countryid)));
      countryRows.push(out);
    }
  }
  tables.countries = countryRows;
  if (countryIds.size > 0) {
    for (const key of TABLE_KEYS) {
      if (key === "schools") continue; // replaced below by the local school, which already has the local id
      for (const ref of CONTENT_TABLES[key].refs ?? []) {
        if (ref.to !== "countries") continue;
        tables[key] = tables[key].map((row) => {
          const mapped = countryIds.get(lower(String(row[ref.fk] ?? "")));
          return mapped ? { ...row, [ref.fk]: mapped } : row;
        });
      }
    }
  }

  // A baseline that named schools now names the local school.
  let baselineListsRewritten = 0;
  tables.curriculumbaselines = tables.curriculumbaselines.map((row) => {
    const list = row.schoolid;
    if (Array.isArray(list) && list.length > 0) {
      baselineListsRewritten += 1;
      return { ...row, schoolid: [local.school.schoolid] };
    }
    return row;
  });

  // The school's country must be a row of the payload (the import refuses a school that points outside it).
  let countryAdded = false;
  if (local.school.countryid && !tables.countries.some((row) => lower(String(row.countryid)) === lower(local.school.countryid as string))) {
    if (!local.country) {
      throw new ProvisionError("The school's country is neither in the payload nor in this database.");
    }
    tables.countries = [...tables.countries, local.country];
    countryAdded = true;
  }

  const body: Record<string, unknown> = {
    format: 3,
    organisationid: localId,
    organisationcode: local.organisation.organisationcode,
    scope: "organisation",
    organisations: [local.organisation],
    ...tables,
  };

  // The re-homed payload must be a valid payload of the local organisation: this is what proves no row kept another owner.
  let content: OrganisationContent;
  try {
    content = validateOrganisationContent(body);
  } catch (e) {
    if (e instanceof ApiError) throw new ProvisionError(`The re-homed payload is refused: ${e.message}`);
    throw e;
  }
  const rows = { organisations: 1 } as Record<"organisations" | TableKey, number>;
  for (const key of TABLE_KEYS) rows[key] = tables[key].length;
  return {
    body,
    content,
    summary: {
      ownersRewritten,
      schoolsInPayload: original.tables.schools.length,
      standardsInPayload: original.tables.standards.length,
      baselineListsRewritten,
      curricula: curriculumIds.length,
      countryAdded,
      countriesRemapped: countryIds.size,
      rows,
    },
  };
}

export { OWNED_KEYS };
