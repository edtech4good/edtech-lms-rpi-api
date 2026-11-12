import { Op, Transaction } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { FieldError } from "src/models/FieldError";
import { studentcertificates } from "src/models/data-models/studentcertificates";
import { students } from "src/models/data-models/students";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { dbinstance } from "src/services/dbservice";
import { CERTIFICATE_SCOPES } from "./certificate-eligibility";
import { learnersInScope, ReportScope } from "./report-scope";

/**
 * `PUT /import/certificates`: central pushes the certificates it issued (and revoked) for this server's learners.
 * The learning server only keeps a copy, so the learner app can show them offline.
 *
 * The body is `{ certificates: [row...], replaceForStudents?: string[] }`, 0 to 2000 rows. Every row is checked
 * before anything is written, and the learner of every row (and every id in `replaceForStudents`) must be a learner this
 * server holds in the caller's organisation: otherwise the WHOLE payload is refused with a 400 that names the row
 * (counted from 1), and nothing is written. A certificate id this server already holds for another learner is refused
 * the same way (a push never moves a certificate between learners). Rows are upserted by `certificateid`, so a later
 * `revokedat` or `checkurl` overwrites. When `replaceForStudents` is given, the certificates of those learners that are
 * not in the payload are deleted, so the learner's set matches central's. Everything is one transaction, and every read
 * is on it.
 */
export const MAX_CERTIFICATE_ROWS = 2000;
export const MAX_REPLACE_STUDENTS = 5000;
const MAX_ID = 36;
const MAX_CHECKURL = 2048;
const LOOKUP_CHUNK = 500;
/** "XXXX-XXXX": eight characters from 0-9 and A-Z without I, L, O and U, as central makes them. */
export const SHORTCODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export interface CertificateRow {
  certificateid: string;
  shortcode: string;
  studentid: string;
  curriculumid: string;
  scope: (typeof CERTIFICATE_SCOPES)[number];
  scopeid: string;
  issuedat: Date;
  revokedat: Date | null;
  snapshot: Record<string, unknown>;
  checkurl: string | null;
}

export interface CertificatesPayload {
  certificates: CertificateRow[];
  replaceForStudents?: string[];
}

const refuse = (field: string, message: string): ApiError =>
  new ApiError(ErrorCode.INVALID_INPUT, { message: `${field}: ${message}`, fields: [{ field, message } as FieldError] });

const lower = (x: string): string => x.toLowerCase();
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === "string" && x.trim() !== "" && x.length <= MAX_ID;

const dateOf = (x: unknown): Date | null => {
  if (typeof x !== "string" || x.length > 40) return null;
  const at = new Date(x);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** The body, checked. Throws a 400 naming the field and the row (counted from 1). */
export const parseCertificatesPayload = (raw: unknown): CertificatesPayload => {
  if (!isObject(raw) || !Array.isArray(raw.certificates)) {
    throw refuse("certificates", "A list of certificates is required.");
  }
  if (raw.certificates.length > MAX_CERTIFICATE_ROWS) {
    throw refuse("certificates", `At most ${MAX_CERTIFICATE_ROWS} certificates in one push.`);
  }
  const seen = new Set<string>();
  const rows = raw.certificates.map((entry: unknown, at: number): CertificateRow => {
    const where = `certificates row ${at + 1}`;
    if (!isObject(entry)) throw refuse(where, "Must be an object.");
    for (const field of ["certificateid", "studentid", "curriculumid", "scopeid"] as const) {
      if (!isId(entry[field])) throw refuse(`${where} ${field}`, "An id (text, up to 36 characters) is required.");
    }
    if (typeof entry.shortcode !== "string" || !SHORTCODE_PATTERN.test(entry.shortcode)) {
      throw refuse(`${where} shortcode`, "Must look like XXXX-XXXX.");
    }
    if (typeof entry.scope !== "string" || !(CERTIFICATE_SCOPES as readonly string[]).includes(entry.scope)) {
      throw refuse(`${where} scope`, "Must be one of level, grade or curriculum.");
    }
    const issuedat = dateOf(entry.issuedat);
    if (issuedat === null) throw refuse(`${where} issuedat`, "A date is required.");
    let revokedat: Date | null = null;
    if (entry.revokedat !== undefined && entry.revokedat !== null) {
      revokedat = dateOf(entry.revokedat);
      if (revokedat === null) throw refuse(`${where} revokedat`, "Must be a date, or null.");
    }
    if (!isObject(entry.snapshot)) throw refuse(`${where} snapshot`, "An object is required.");
    let checkurl: string | null = null;
    if (entry.checkurl !== undefined && entry.checkurl !== null) {
      if (typeof entry.checkurl !== "string" || entry.checkurl.length > MAX_CHECKURL || !/^https?:\/\/\S+$/i.test(entry.checkurl)) {
        throw refuse(`${where} checkurl`, "Must be a web address (http or https), or null.");
      }
      checkurl = entry.checkurl;
    }
    const id = lower(entry.certificateid as string);
    if (seen.has(id)) throw refuse(`${where} certificateid`, "Appears twice in the payload.");
    seen.add(id);
    return {
      certificateid: (entry.certificateid as string).trim(),
      shortcode: entry.shortcode,
      studentid: (entry.studentid as string).trim(),
      curriculumid: (entry.curriculumid as string).trim(),
      scope: entry.scope as CertificateRow["scope"],
      scopeid: (entry.scopeid as string).trim(),
      issuedat,
      revokedat,
      snapshot: entry.snapshot,
      checkurl,
    };
  });
  let replaceForStudents: string[] | undefined;
  if (raw.replaceForStudents !== undefined) {
    const list = raw.replaceForStudents;
    if (!Array.isArray(list) || list.length > MAX_REPLACE_STUDENTS) {
      throw refuse("replaceForStudents", `A list of at most ${MAX_REPLACE_STUDENTS} learner ids.`);
    }
    list.forEach((id: unknown, at: number) => {
      if (!isId(id)) throw refuse(`replaceForStudents entry ${at + 1}`, "An id (text, up to 36 characters) is required.");
    });
    replaceForStudents = (list as string[]).map((id) => id.trim());
  }
  return { certificates: rows, ...(replaceForStudents ? { replaceForStudents } : {}) };
};

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let at = 0; at < list.length; at += size) out.push(list.slice(at, at + size));
  return out;
};

/** The learner ids (lower case) among `ids` that this server holds in the scope. */
const learnersHere = async (ids: string[], scope: ReportScope, transaction: Transaction): Promise<Set<string>> => {
  const here = new Set<string>();
  for (const part of chunks([...new Set(ids)], LOOKUP_CHUNK)) {
    const rows = (await students.findAll({
      where: { studentid: { [Op.in]: part }, ...learnersInScope(scope) },
      attributes: ["studentid"],
      transaction,
      raw: true,
    })) as unknown as Array<{ studentid: string }>;
    for (const row of rows) here.add(lower(String(row.studentid)));
  }
  return here;
};

export interface CertificatesImportResult {
  upserted: number;
  deleted: number;
}

/**
 * Writes a checked payload for the organisation `scope` names. Refuses (400, nothing written) before it writes.
 */
export async function importCertificates(payload: CertificatesPayload, scope: ReportScope): Promise<CertificatesImportResult> {
  const tnx = await dbinstance.getdbinstance().transaction();
  try {
    const { certificates: rows, replaceForStudents } = payload;
    // 1. the learner of every row, and of every replace entry, is a learner of the caller's organisation
    const here = await learnersHere([...rows.map((r) => r.studentid), ...(replaceForStudents ?? [])], scope, tnx);
    rows.forEach((row, at) => {
      if (!here.has(lower(row.studentid))) {
        throw refuse(`certificates row ${at + 1} studentid`, "That learner is not a learner of this organisation on this server. Nothing was written.");
      }
    });
    (replaceForStudents ?? []).forEach((id, at) => {
      if (!here.has(lower(id))) {
        throw refuse(`replaceForStudents entry ${at + 1}`, "That learner is not a learner of this organisation on this server. Nothing was written.");
      }
    });
    // 2. a certificate id never moves to another learner
    const held = new Map<string, string>();
    for (const part of chunks(rows.map((r) => r.certificateid), LOOKUP_CHUNK)) {
      const found = (await studentcertificates.findAll({
        where: { certificateid: { [Op.in]: part } },
        attributes: ["certificateid", "studentid"],
        transaction: tnx,
        raw: true,
      })) as unknown as Array<{ certificateid: string; studentid: string }>;
      for (const row of found) held.set(lower(row.certificateid), lower(row.studentid));
    }
    rows.forEach((row, at) => {
      const owner = held.get(lower(row.certificateid));
      if (owner !== undefined && owner !== lower(row.studentid)) {
        throw refuse(`certificates row ${at + 1} certificateid`, "This server holds that certificate for another learner. Nothing was written.");
      }
    });
    // 3. upsert by certificateid
    const now = new Date();
    for (const part of chunks(rows, LOOKUP_CHUNK)) {
      await studentcertificates.bulkCreate(
        part.map((r) => ({ ...r, lastupdated: now })),
        {
          updateOnDuplicate: ["shortcode", "studentid", "curriculumid", "scope", "scopeid", "issuedat", "revokedat", "snapshot", "checkurl", "lastupdated"],
          transaction: tnx,
        },
      );
    }
    // 4. those learners' certificates that are not in the payload go
    let deleted = 0;
    if (replaceForStudents && replaceForStudents.length > 0) {
      const keep = new Set(rows.map((r) => lower(r.certificateid)));
      const stale: string[] = [];
      for (const part of chunks([...new Set(replaceForStudents)], LOOKUP_CHUNK)) {
        const found = (await studentcertificates.findAll({
          where: { studentid: { [Op.in]: part } },
          attributes: ["certificateid"],
          transaction: tnx,
          raw: true,
        })) as unknown as Array<{ certificateid: string }>;
        for (const row of found) if (!keep.has(lower(row.certificateid))) stale.push(row.certificateid);
      }
      for (const part of chunks(stale, LOOKUP_CHUNK)) {
        deleted += Number(await studentcertificates.destroy({ where: { certificateid: { [Op.in]: part } }, transaction: tnx }));
      }
    }
    await tnx.commit();
    return { upserted: rows.length, deleted };
  } catch (e) {
    try {
      await tnx.rollback();
    } catch {
      // already finished; the first failure is the one to report
    }
    throw e;
  }
}
