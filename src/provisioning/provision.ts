import { randomInt } from "crypto";
import { closeSync, existsSync, openSync, unlinkSync, writeSync } from "fs";
import { dirname } from "path";
import { chunk } from "lodash";
import { Op, Transaction } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import { OrganisationContentImport } from "src/business/organisation-content.business";
import { isSameSchoolName } from "src/business/school-identity";
import { countries } from "src/models/data-models/countries";
import { organisations, schoolusers } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { OrganisationContent, Row } from "src/modules/import/organisation-content.validator";
import { OwnershipOrganisation } from "src/modules/import/ownership.request.validator";
import { dbinstance } from "src/services/dbservice";
import { hashPassword } from "src/services/password.service";
import { ProvisionError, ProvisionOptions, sameName } from "./args";
import { LocalIdentity, Rehomed, RehomeSummary, readContentFile, rehomeContent, validatePayload } from "./payload";

/**
 * Provisioning a classroom server without ever touching the online system.
 *
 * A fresh classroom server has no organisation, no school and no login, and a login whose school has no
 * organisation cannot sign in (business/token-claims.ts), so there is nothing to sign in with. This creates, on
 * THIS server's own database, in ONE transaction:
 *
 *  - the organisation (a new UUID and the code given; reused when the code is already here under the same name),
 *  - the school (a new UUID, owned by that organisation) and, if asked, one class,
 *  - the first staff logins (an admin, and a teacher if asked), each with a random password,
 *  - and, with a content payload, the content: the payload is re-homed to the local organisation (payload.ts)
 *    and imported by the same code `PUT /import/master` runs.
 *
 * Nothing here uses the network. Central is not involved: the ids minted here are this server's own.
 *
 * The school and the class go INTO the payload when there is one. The import replaces an organisation's
 * schools, classes and content as a whole (and marks a school the payload no longer has as deleted), so a school
 * or class created beside the payload would be marked deleted or wiped by it, on this run or the next.
 */

export const ROLE_OF = { admin: SchoolRole.ADMIN, teacher: SchoolRole.TEACHER } as const;

export interface LoginPlan {
  kind: "admin" | "teacher";
  username: string;
  action: "create" | "exists";
  schooluserid: string;
}

export interface ProvisionPlan {
  database: string;
  organisation: { action: "create" | "reuse"; row: OwnershipOrganisation };
  school: { action: "create" | "reuse"; schoolid: string; schoolname: string; countryid: string | null; countryname: string | null };
  standard: { action: "create" | "reuse"; standardid: string; standardname: string } | null;
  logins: LoginPlan[];
  /** Schools this organisation already owns that the import will mark deleted (they are not in the payload). */
  otherSchoolsMarkedDeleted: number;
  content: null | { file: string; rehomed: Rehomed };
}

export interface ProvisionVerification {
  organisations: number;
  schools: number;
  standards: number;
  logins: number;
  /** Rows of the payload checked per owned table, and how many of them were missing or had another owner. */
  payloadRowsChecked: number;
  payloadRowsWrongOwner: number;
}

export interface ProvisionResult {
  plan: ProvisionPlan;
  applied: boolean;
  counts?: Record<string, unknown>;
  verification?: ProvisionVerification;
  /** Each new login's password: shown once by the caller, never stored here, absent when written to a file. */
  newLogins?: Array<{ kind: "admin" | "teacher"; username: string; password: string }>;
  credentialsFile?: string;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const PASSWORD_LENGTH = 16;

/** A random password from an alphabet without look-alike characters (about 93 bits). */
export const generatePassword = (): string => {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 1000;
const lower = (value: string) => value.toLowerCase();

interface CountryChoice {
  countryid: string;
  countryname: string;
  /** The row to add to the payload when the payload does not carry the country. */
  dbRow: Row | null;
}

export interface Guards {
  offline: boolean;
  configuredDatabase: string;
}

/** The refusals that need no database: a classroom-server tool, and the right database. */
export function checkEnvironment(options: ProvisionOptions, guards: Guards): void {
  if (!guards.offline && !options.allowOnline) {
    throw new ProvisionError(
      "This is a classroom-server tool: RPI_OFFLINE is not set, so this server looks like an online one. " +
        "Set RPI_OFFLINE=true on the classroom server, or pass --i-know-this-is-online (for tests).",
    );
  }
  if (options.database !== undefined && options.database !== guards.configuredDatabase) {
    throw new ProvisionError(
      `--database names "${options.database}", but this server is configured for "${guards.configuredDatabase}". Nothing was changed.`,
    );
  }
}

export class Provisioner {
  private readonly sequelize = dbinstance.getdbinstance();

  constructor(private readonly guards: Guards) {}

  /** Reads what is here and what the payload says; writes nothing. Throws a ProvisionError for every refusal. */
  plan = async (options: ProvisionOptions, transaction?: Transaction): Promise<ProvisionPlan> => {
    checkEnvironment(options, this.guards);
    this.checkCredentialsFile(options);

    const original = options.content ? validatePayload(readContentFile(options.content)) : null;

    // ---- the organisation ----------------------------------------------------
    const found = await organisations.findAll({ where: { organisationcode: options.code }, transaction });
    if (found.length > 1) {
      throw new ProvisionError(`More than one organisation here has the code "${options.code}". Nothing was changed.`);
    }
    let organisation: OwnershipOrganisation;
    let organisationAction: "create" | "reuse";
    if (found.length === 1) {
      const row = found[0];
      if (row.isdeleted) {
        throw new ProvisionError(`The organisation with code "${options.code}" has been deleted, and a code is never reissued. Use another code.`);
      }
      if (!isSameSchoolName(row.organisationname, options.organisation)) {
        throw new ProvisionError(
          `The code "${options.code}" is already used by an organisation with a different name. Use that name, or another code.`,
        );
      }
      if (!row.organisationstatus) {
        throw new ProvisionError(`The organisation with code "${options.code}" is suspended here. It is not reactivated by this command.`);
      }
      organisation = {
        organisationid: row.organisationid,
        organisationname: row.organisationname,
        organisationcode: row.organisationcode,
        organisationstatus: true,
        uitheme: row.uitheme,
        brandingconfig: (row.brandingconfig ?? null) as OwnershipOrganisation["brandingconfig"],
        settingsconfig: (row.settingsconfig ?? null) as OwnershipOrganisation["settingsconfig"],
        isdeleted: false,
      };
      organisationAction = "reuse";
    } else {
      organisation = {
        organisationid: uuidv4(),
        organisationname: options.organisation,
        organisationcode: options.code,
        organisationstatus: true,
        uitheme: original?.organisation.uitheme ?? "kids",
        brandingconfig: null,
        settingsconfig: null,
        isdeleted: false,
      };
      organisationAction = "create";
    }

    // ---- the country ---------------------------------------------------------
    const country = await this.resolveCountry(options.country, original, transaction);

    // ---- the school ----------------------------------------------------------
    const sameNameSchools = (await schools.scope("withOwnership").findAll({ where: { schoolname: options.school }, transaction })).filter((s) =>
      isSameSchoolName(s.schoolname, options.school),
    );
    let schoolid = uuidv4();
    let schoolAction: "create" | "reuse" = "create";
    let uitheme = organisation.uitheme;
    let brandingconfig: object | null = null;
    let expectedcontribution: number | null = null;
    let expectedusage: number | null = null;
    if (sameNameSchools.length > 1) {
      throw new ProvisionError("More than one school here has that name. Nothing was changed.");
    }
    if (sameNameSchools.length === 1) {
      const existing = sameNameSchools[0];
      if (!existing.organisationid || lower(existing.organisationid) !== lower(organisation.organisationid)) {
        throw new ProvisionError(
          `A school with that name already exists here in ${existing.organisationid ? "another organisation" : "no organisation"}. Nothing was changed.`,
        );
      }
      if (existing.isdeleted) {
        throw new ProvisionError("A school with that name exists here but has been deleted. Use another name.");
      }
      if ((existing.countryid ?? null) !== null && lower(String(existing.countryid)) !== lower(country.countryid)) {
        throw new ProvisionError("That school already exists here with another country. Nothing was changed.");
      }
      schoolid = existing.schoolid;
      schoolAction = "reuse";
      uitheme = existing.uitheme;
      brandingconfig = (existing.brandingconfig ?? null) as object | null;
      expectedcontribution = existing.expectedcontribution ?? null;
      expectedusage = existing.expectedusage ?? null;
    }

    // ---- the class -----------------------------------------------------------
    let standard: ProvisionPlan["standard"] = null;
    if (options.className) {
      let existingClass: standards | undefined;
      if (schoolAction === "reuse") {
        const classes = await standards.findAll({ where: { schoolid, isdeleted: false }, transaction });
        existingClass = classes.find((c) => isSameSchoolName(c.standardname, options.className as string));
      }
      standard = existingClass
        ? { action: "reuse", standardid: existingClass.standardid, standardname: existingClass.standardname }
        : { action: "create", standardid: uuidv4(), standardname: options.className };
    }

    // ---- the logins ----------------------------------------------------------
    const logins: LoginPlan[] = [];
    for (const [kind, username] of [["admin", options.admin], ["teacher", options.teacher]] as const) {
      if (!username) continue;
      const existing = await schoolusers.scope("withOwnership").findOne({ where: { schoolusername: username }, transaction });
      if (!existing) {
        logins.push({ kind, username, action: "create", schooluserid: uuidv4() });
        continue;
      }
      if (existing.isdeleted || existing.isdisabled) {
        throw new ProvisionError(`The login "${username}" exists here but is deleted or disabled. Use another name.`);
      }
      if (schoolAction !== "reuse" || !existing.schoolid || lower(existing.schoolid) !== lower(schoolid)) {
        throw new ProvisionError(`The login "${username}" already exists here for another school. Use another name.`);
      }
      if (Number(existing.schooluserrole) !== ROLE_OF[kind]) {
        throw new ProvisionError(`The login "${username}" already exists here with another role. Use another name.`);
      }
      logins.push({ kind, username, action: "exists", schooluserid: existing.schooluserid });
    }

    // ---- the content ---------------------------------------------------------
    let content: ProvisionPlan["content"] = null;
    let otherSchoolsMarkedDeleted = 0;
    if (original && options.content) {
      const identity: LocalIdentity = {
        organisation,
        school: { schoolid, schoolname: options.school, countryid: country.countryid, uitheme, brandingconfig, expectedcontribution, expectedusage },
        standard: standard ? { standardid: standard.standardid, standardname: standard.standardname } : null,
        country: country.dbRow,
      };
      const rehomed = rehomeContent(original, identity);
      await this.refuseForeignRows(rehomed.content, organisation.organisationid, transaction);
      content = { file: options.content, rehomed };
      if (organisationAction === "reuse") {
        const owned = await schools.scope("withOwnership").count({
          where: { organisationid: organisation.organisationid, isdeleted: false, schoolid: { [Op.ne]: schoolid } },
          transaction,
        });
        otherSchoolsMarkedDeleted = owned;
      }
    }

    return {
      database: this.guards.configuredDatabase,
      organisation: { action: organisationAction, row: organisation },
      school: { action: schoolAction, schoolid, schoolname: options.school, countryid: country.countryid, countryname: country.countryname },
      standard,
      logins,
      otherSchoolsMarkedDeleted,
      content,
    };
  };

  /** Writes everything in one transaction, verifies it in the same transaction, then commits. */
  apply = async (plan: ProvisionPlan, options: ProvisionOptions): Promise<ProvisionResult> => {
    let credentials: { fd: number; path: string } | null = null;
    const transaction = await this.sequelize.transaction();
    try {
      const created = plan.logins.filter((l) => l.action === "create");
      if (options.credentialsFile && created.length > 0) {
        // mode 0600, and never over an existing file: a refusal here is before anything is written.
        try {
          credentials = { fd: openSync(options.credentialsFile, "wx", 0o600), path: options.credentialsFile };
        } catch {
          throw new ProvisionError(`Cannot create the credentials file (it must not exist yet): ${options.credentialsFile}`);
        }
      }

      let counts: Record<string, unknown> | undefined;
      if (plan.content) {
        counts = (await new OrganisationContentImport(transaction).run(plan.content.rehomed.content)) as unknown as Record<string, unknown>;
      } else {
        if (plan.organisation.action === "create") {
          await organisations.create({ ...plan.organisation.row } as never, { transaction });
        }
        if (plan.school.action === "create") {
          await schools.create(
            {
              schoolid: plan.school.schoolid,
              schoolname: plan.school.schoolname,
              countryid: plan.school.countryid,
              curriculums: [],
              isdeleted: false,
              uitheme: plan.organisation.row.uitheme,
              brandingconfig: null,
              organisationid: plan.organisation.row.organisationid,
            } as never,
            { transaction },
          );
        }
        if (plan.standard && plan.standard.action === "create") {
          await standards.create(
            {
              standardid: plan.standard.standardid,
              standardname: plan.standard.standardname,
              schoolid: plan.school.schoolid,
              schoolname: plan.school.schoolname,
              isdeleted: false,
            } as never,
            { transaction },
          );
        }
      }

      const newLogins: Array<{ kind: "admin" | "teacher"; username: string; password: string }> = [];
      for (const login of created) {
        const password = generatePassword();
        await schoolusers.create(
          {
            schooluserid: login.schooluserid,
            schoolusername: login.username,
            schooluserpasswordhash: hashPassword(password),
            schooluserrole: ROLE_OF[login.kind],
            schooluserstatus: 1,
            schoolname: plan.school.schoolname,
            schoolid: plan.school.schoolid,
            isdisabled: false,
            isdeleted: false,
          } as never,
          { transaction },
        );
        newLogins.push({ kind: login.kind, username: login.username, password });
      }

      const verification = await this.verify(plan, transaction);

      if (credentials) {
        const text = newLogins.map((l) => `${l.kind}\t${l.username}\t${l.password}`).join("\n") + "\n";
        writeSync(credentials.fd, text);
        closeSync(credentials.fd);
      }
      await transaction.commit();
      return {
        plan,
        applied: true,
        counts,
        verification,
        newLogins: credentials ? undefined : newLogins,
        credentialsFile: credentials?.path,
      };
    } catch (e) {
      try {
        await transaction.rollback();
      } catch {
        // already finished: the first failure is the one to report
      }
      if (credentials) {
        try {
          closeSync(credentials.fd);
        } catch {
          // closed already
        }
        try {
          unlinkSync(credentials.path);
        } catch {
          // nothing to remove
        }
      }
      throw e;
    }
  };

  // ---------------------------------------------------------------------------

  private checkCredentialsFile = (options: ProvisionOptions): void => {
    if (!options.credentialsFile) return;
    if (existsSync(options.credentialsFile)) {
      throw new ProvisionError(`The credentials file already exists: ${options.credentialsFile}. It is never overwritten.`);
    }
    if (!existsSync(dirname(options.credentialsFile))) {
      throw new ProvisionError(`The folder of the credentials file does not exist: ${dirname(options.credentialsFile)}`);
    }
  };

  /** A country by id, or by name as the `countries` table (or the payload) has it. */
  private resolveCountry = async (given: string, original: OrganisationContent | null, transaction?: Transaction): Promise<CountryChoice> => {
    const byId = UUID.test(given);
    const matches = (row: Row | countries): boolean => {
      const r = row as unknown as { countryid: unknown; countryname: unknown; isdeleted?: unknown };
      return !r.isdeleted && (byId ? lower(String(r.countryid)) === lower(given) : sameName(String(r.countryname), given));
    };
    const inPayload = (original?.tables.countries ?? []).filter(matches);
    if (inPayload.length > 1) throw new ProvisionError("--country matches more than one country of the payload.");
    const inDatabase = (await countries.findAll({ transaction })).filter((c) => matches(c));
    if (inDatabase.length > 1 && inPayload.length === 0) throw new ProvisionError("--country matches more than one country here.");
    if (inPayload.length === 1) {
      const row = inPayload[0];
      return { countryid: String(row.countryid), countryname: String(row.countryname), dbRow: null };
    }
    if (inDatabase.length === 1) {
      const row = inDatabase[0];
      return {
        countryid: row.countryid,
        countryname: row.countryname,
        dbRow: { countryid: row.countryid, countryname: row.countryname, expectedusage: row.expectedusage ?? null, isdeleted: false },
      };
    }
    throw new ProvisionError(
      "--country is not in the countries table of this server nor in the payload. Give a country id or a name the payload carries.",
    );
  };

  /** Refused before anything is written: a payload row whose id is already here under ANOTHER organisation (the import refuses it too). */
  private refuseForeignRows = async (content: OrganisationContent, organisationid: string, transaction?: Transaction): Promise<void> => {
    const refused: string[] = [];
    for (const [key, pk] of [
      ["curriculums", "curriculumid"],
      ["questions", "questionid"],
      ["documents", "documentid"],
      ["subjects", "subjectid"],
    ] as const) {
      const ids = content.tables[key].map((r) => String(r[pk]));
      let foreign = 0;
      for (const part of chunk(ids, CHUNK)) {
        const [rows] = (await this.sequelize.query(
          `SELECT \`organisationid\` FROM \`${key}\` WHERE \`${pk}\` IN (:ids) AND \`organisationid\` IS NOT NULL AND \`organisationid\` <> ''`,
          { replacements: { ids: part }, transaction },
        )) as unknown as [Array<{ organisationid: string }>, unknown];
        foreign += rows.filter((r) => lower(r.organisationid) !== lower(organisationid)).length;
      }
      if (foreign > 0) refused.push(`${key}: ${foreign} row(s) already belong to another organisation here`);
    }
    if (refused.length > 0) {
      throw new ProvisionError(`The payload names content that belongs to another organisation here. Nothing was changed. ${refused.join("; ")}.`);
    }
  };

  /** Counts only. Throws (so the transaction rolls back) when anything is not as it should be. */
  private verify = async (plan: ProvisionPlan, transaction: Transaction): Promise<ProvisionVerification> => {
    const organisationid = plan.organisation.row.organisationid;
    const orgRows = await organisations.findAll({ where: { organisationcode: plan.organisation.row.organisationcode }, transaction });
    if (orgRows.length !== 1 || lower(orgRows[0].organisationid) !== lower(organisationid) || orgRows[0].isdeleted || !orgRows[0].organisationstatus) {
      throw new ProvisionError("Check failed: the organisation is not here exactly once, active.");
    }
    const school = await schools.scope("withOwnership").findOne({ where: { schoolid: plan.school.schoolid }, transaction });
    if (!school || school.isdeleted || !school.organisationid || lower(school.organisationid) !== lower(organisationid)) {
      throw new ProvisionError("Check failed: the school is not here, live and owned by the organisation.");
    }
    let standardsFound = 0;
    if (plan.standard) {
      standardsFound = await standards.count({ where: { standardid: plan.standard.standardid, schoolid: plan.school.schoolid, isdeleted: false }, transaction });
      if (standardsFound !== 1) throw new ProvisionError("Check failed: the class is not here.");
    }
    for (const login of plan.logins) {
      const row = await schoolusers.scope("withOwnership").findOne({ where: { schooluserid: login.schooluserid }, transaction });
      if (
        !row ||
        row.schoolusername !== login.username ||
        !row.schoolid ||
        lower(row.schoolid) !== lower(plan.school.schoolid) ||
        Number(row.schooluserrole) !== ROLE_OF[login.kind] ||
        row.isdisabled ||
        row.isdeleted
      ) {
        throw new ProvisionError("Check failed: a login is missing, or is not in the school with the right role.");
      }
    }
    let checked = 0;
    let wrong = 0;
    if (plan.content) {
      for (const [key, pk] of [
        ["schools", "schoolid"],
        ["curriculums", "curriculumid"],
        ["questions", "questionid"],
        ["documents", "documentid"],
        ["subjects", "subjectid"],
      ] as const) {
        const ids = plan.content.rehomed.content.tables[key].map((r) => String(r[pk]));
        checked += ids.length;
        for (const part of chunk(ids, CHUNK)) {
          const [rows] = (await this.sequelize.query(
            `SELECT COUNT(*) AS n FROM \`${key}\` WHERE \`${pk}\` IN (:ids) AND \`organisationid\` = :organisationid`,
            { replacements: { ids: part, organisationid }, transaction },
          )) as unknown as [Array<{ n: number | string }>, unknown];
          wrong += part.length - Number(rows[0].n);
        }
      }
      if (wrong > 0) {
        throw new ProvisionError(`Check failed: ${wrong} row(s) of the payload are missing or belong to another organisation.`);
      }
    }
    return {
      organisations: 1,
      schools: 1,
      standards: standardsFound,
      logins: plan.logins.length,
      payloadRowsChecked: checked,
      payloadRowsWrongOwner: wrong,
    };
  };
}

export type { RehomeSummary };
