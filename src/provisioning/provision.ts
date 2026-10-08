import { randomInt } from "crypto";
import { closeSync, existsSync, openSync, unlinkSync, writeSync } from "fs";
import { dirname } from "path";
import { chunk } from "lodash";
import { Op, Transaction } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import { OrganisationContentImport } from "src/business/organisation-content.business";
import { isSameSchoolName } from "src/business/school-identity";
import { LocalCountry, matchCountriesByName, mysqlCountryNames, rehomeCountriesByName } from "src/business/country-rehoming";
import { countries } from "src/models/data-models/countries";
import { organisations, schoolusers, tokens } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { OrganisationContent, Row } from "src/modules/import/organisation-content.validator";
import { OwnershipOrganisation } from "src/modules/import/ownership.request.validator";
import { dbinstance } from "src/services/dbservice";
import { hashPassword, verifyPassword } from "src/services/password.service";
import { ProvisionError, ProvisionOptions, sameLoginName } from "./args";
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
 *  - the country, when there is no payload to carry it and the server has not got it,
 *  - and, with a content payload, the content: the payload is re-homed to the local organisation (payload.ts)
 *    and imported by the same code `PUT /import/master` runs.
 *
 * A classroom server holds ONE school. A second `--school` for the same organisation is refused unless
 * `--replace-school` says the first is to be marked deleted; naming the first school again brings it back.
 *
 * `--reset-password <login>` is a separate mode: it sets a new password for a login of the school and changes
 * nothing else.
 *
 * Nothing here uses the network. Central is not involved: the ids minted here are this server's own.
 *
 * The school and its classes go INTO the payload when there is one. The import replaces an organisation's
 * schools, classes and content as a whole (and marks a school the payload no longer has as deleted), so a school
 * or class created beside the payload would be marked deleted or wiped by it, on this run or the next. For the
 * same reason every class the school already has goes into the payload too.
 */

export const ROLE_OF = { admin: SchoolRole.ADMIN, teacher: SchoolRole.TEACHER } as const;

export type LoginKind = "admin" | "teacher" | "reset";

export interface LoginPlan {
  kind: "admin" | "teacher";
  username: string;
  action: "create" | "exists";
  schooluserid: string;
}

/** What the import would take away or mark deleted on this organisation, read before anything is written. */
export interface Removals {
  /** Classes of the school that are not in the payload (hard-deleted by the import). */
  classes: number;
  /** Rows of this organisation that the payload does not have (hard-deleted by the import). */
  questions: number;
  documents: number;
  subjects: number;
  /** Rows of this organisation that the payload does not have (kept, marked deleted). */
  curricula: number;
  schools: number;
}

export interface ProvisionPlan {
  database: string;
  mode: "provision" | "reset";
  organisation: { action: "create" | "reuse"; row: OwnershipOrganisation };
  school: {
    action: "create" | "reuse" | "restore";
    schoolid: string;
    /** The stored name when the school is reused: it is never renamed, so a name that differs only in case keeps the stored one. */
    schoolname: string;
    countryid: string | null;
    countryname: string | null;
  };
  /** `create`: the country row is made from the name given (no payload, and the server has none of that name). */
  country: { action: "create" | "reuse" | "revive"; countryid: string; countryname: string } | null;
  /** The class asked for. */
  standard: { action: "create" | "reuse"; standardid: string; standardname: string } | null;
  /** Classes the school already has here, which go into the payload with it. */
  standardsKept: number;
  logins: LoginPlan[];
  /** Other live schools of this organisation here, to be marked deleted (only with --replace-school). */
  otherSchoolsMarkedDeleted: number;
  /** Their ids: without --replace-school each must still be live afterwards. */
  otherLiveSchoolIds: string[];
  replaceSchool: boolean;
  removals: Removals | null;
  content: null | { file: string; rehomed: Rehomed };
  reset: null | { schooluserid: string; username: string };
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
  /** Each new password: shown once by the caller, never stored here, absent when written to a file. */
  newLogins?: Array<{ kind: LoginKind; username: string; password: string }>;
  credentialsFile?: string;
}

export const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const PASSWORD_LENGTH = 16;

/** A random password from an alphabet without look-alike characters (about 93 bits), from the system's secure random source. */
export const generatePassword = (): string => {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i += 1) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
};

/** Creates the credentials file: mode 0600, and never over an existing file. */
export const createCredentialsFile = (path: string): { fd: number; path: string } => {
  try {
    return { fd: openSync(path, "wx", 0o600), path };
  } catch {
    throw new ProvisionError(`Cannot create the credentials file (it must not exist yet): ${path}`);
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 1000;
const MAX_COUNTRY_NAME = 45;
const lower = (value: string) => value.toLowerCase();

interface CountryChoice {
  countryid: string;
  countryname: string;
  /** The row to add to the payload when the payload does not carry the country. */
  dbRow: Row | null;
  /** The country row does not exist anywhere and is to be created from the name given (no payload only). */
  create: boolean;
  /** The local country that is used is deleted here, and is brought back (a country is a shared reference row; a classroom server has no screen that deletes one). */
  revive: boolean;
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

    const reset = options.resetPassword !== undefined;
    const original = options.content ? validatePayload(readContentFile(options.content)) : null;

    // ---- the organisation ----------------------------------------------------
    const { organisation, action: organisationAction } = await this.resolveOrganisation(options, original, reset, transaction);

    // ---- the country ---------------------------------------------------------
    let country = reset ? null : await this.resolveCountry(options.country as string, original, transaction);
    // What the database says about the payload's country names (the one rule the content import applies too).
    const countryMatches = original ? await matchCountriesByName(original.tables.countries, mysqlCountryNames(transaction)) : undefined;
    if (country && original && countryMatches) {
      // --country named a payload country that the database calls the same as an EARLIER one of the payload: the earlier one is
      // the one that is written, so it is the school's country (the second's row never reaches the database).
      const folded = rehomeCountriesByName(original.tables.countries, countryMatches).idMap.get(lower(country.countryid));
      if (folded) {
        const keeper = original.tables.countries.find((r) => lower(String(r.countryid)) === lower(folded));
        country = { ...country, countryid: folded, countryname: String(keeper?.countryname ?? country.countryname) };
      }
    }

    // ---- the school ----------------------------------------------------------
    const sameNameSchools = (await schools.scope("withOwnership").findAll({ where: { schoolname: options.school }, transaction })).filter((s) =>
      isSameSchoolName(s.schoolname, options.school),
    );
    if (sameNameSchools.length > 1) {
      throw new ProvisionError("More than one school here has that name. Nothing was changed.");
    }
    let schoolid = uuidv4();
    let schoolAction: "create" | "reuse" | "restore" = "create";
    // A school that is reused is never renamed: its stored name is used everywhere (the logins' schoolname too).
    let schoolname = options.school;
    let uitheme = organisation.uitheme;
    let brandingconfig: object | null = null;
    let expectedcontribution: number | null = null;
    let expectedusage: number | null = null;
    let schoolCountry: string | null = country?.countryid ?? null;
    if (sameNameSchools.length === 1) {
      const existing = sameNameSchools[0];
      if (!existing.organisationid || lower(existing.organisationid) !== lower(organisation.organisationid)) {
        throw new ProvisionError(
          `A school with that name already exists here in ${existing.organisationid ? "another organisation" : "no organisation"}. Nothing was changed.`,
        );
      }
      if (country && (existing.countryid ?? null) !== null && lower(String(existing.countryid)) !== lower(country.countryid)) {
        throw new ProvisionError("That school already exists here with another country. Nothing was changed.");
      }
      if (reset && existing.isdeleted) {
        throw new ProvisionError("That school is deleted. Name it again without --reset-password to bring it back first.");
      }
      schoolid = existing.schoolid;
      schoolAction = existing.isdeleted ? "restore" : "reuse";
      schoolname = existing.schoolname;
      uitheme = existing.uitheme;
      brandingconfig = (existing.brandingconfig ?? null) as object | null;
      expectedcontribution = existing.expectedcontribution ?? null;
      expectedusage = existing.expectedusage ?? null;
      schoolCountry = existing.countryid ?? schoolCountry;
    } else if (reset) {
      throw new ProvisionError("There is no school of that name here to reset a password in.");
    }

    // ---- one school per server -----------------------------------------------
    // The import (and --replace-school without a payload) marks every other live school of the organisation
    // deleted, and its logins can no longer sign in. A typo in --school must not do that silently.
    let otherSchools = 0;
    let otherLiveSchoolIds: string[] = [];
    if (!reset && organisationAction === "reuse") {
      const others = await schools.scope("withOwnership").findAll({
        attributes: ["schoolid"],
        where: { organisationid: organisation.organisationid, isdeleted: false, schoolid: { [Op.ne]: schoolid } },
        transaction,
      });
      otherLiveSchoolIds = others.map((o) => o.schoolid);
      otherSchools = otherLiveSchoolIds.length;
      if (otherSchools > 0 && !options.replaceSchool) {
        throw new ProvisionError(
          `This organisation already has ${otherSchools === 1 ? "another school" : `${otherSchools} other schools`} here, and a classroom server holds one school: ` +
            "naming a different school would mark it deleted, and its logins could no longer sign in. " +
            "Check the --school name. To replace the school on purpose, add --replace-school (naming the old school again brings it back).",
        );
      }
    }

    // ---- reset a password -----------------------------------------------------
    if (reset) {
      const login = await schoolusers.scope("withOwnership").findOne({ where: { schoolusername: options.resetPassword }, transaction });
      if (!login || !login.schoolid || lower(login.schoolid) !== lower(schoolid)) {
        // one answer for a login that is not here and one of another school
        throw new ProvisionError(`There is no login "${options.resetPassword}" in this school.`);
      }
      if (login.isdeleted || login.isdisabled) {
        throw new ProvisionError(`The login "${options.resetPassword}" is deleted or disabled; a password cannot bring it back.`);
      }
      return {
        database: this.guards.configuredDatabase,
        mode: "reset",
        organisation: { action: "reuse", row: organisation },
        school: { action: "reuse", schoolid, schoolname, countryid: schoolCountry, countryname: null },
        country: null,
        standard: null,
        standardsKept: 0,
        logins: [],
        otherSchoolsMarkedDeleted: 0,
        otherLiveSchoolIds: [],
        replaceSchool: false,
        removals: null,
        content: null,
        reset: { schooluserid: login.schooluserid, username: login.schoolusername },
      };
    }

    // ---- the classes -----------------------------------------------------------
    // Every class the school has goes into the payload (the import replaces the classes of the schools in it).
    const existingClasses = schoolAction === "create" ? [] : await standards.findAll({ where: { schoolid }, transaction });
    let standard: ProvisionPlan["standard"] = null;
    const classRows: LocalIdentity["standards"] = existingClasses.map((c) => ({
      standardid: c.standardid,
      standardname: c.standardname,
      isdeleted: Boolean(c.isdeleted),
      created_at: c.created_at ?? null,
    }));
    if (options.className) {
      const live = existingClasses.find((c) => !c.isdeleted && isSameSchoolName(c.standardname, options.className as string));
      if (live) {
        standard = { action: "reuse", standardid: live.standardid, standardname: live.standardname };
      } else {
        standard = { action: "create", standardid: uuidv4(), standardname: options.className };
        // with a date: rows of one bulk insert share their columns, so one with none would get NULL where the others have one
        classRows.push({ standardid: standard.standardid, standardname: standard.standardname, isdeleted: false, created_at: new Date() });
      }
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
      if (schoolAction === "create" || !existing.schoolid || lower(existing.schoolid) !== lower(schoolid)) {
        throw new ProvisionError(`The login "${username}" already exists here for another school. Use another name.`);
      }
      if (Number(existing.schooluserrole) !== ROLE_OF[kind]) {
        throw new ProvisionError(`The login "${username}" already exists here with another role. Use another name.`);
      }
      // The database compares names without regard to case, so a name that differs only in case IS this login.
      logins.push({ kind, username: existing.schoolusername, action: "exists", schooluserid: existing.schooluserid });
    }

    // ---- the content ---------------------------------------------------------
    let content: ProvisionPlan["content"] = null;
    let removals: Removals | null = null;
    if (original && options.content && country) {
      const identity: LocalIdentity = {
        organisation,
        school: { schoolid, schoolname, countryid: country.countryid, uitheme, brandingconfig, expectedcontribution, expectedusage },
        standards: classRows,
        country: country.dbRow,
        countryMatches,
      };
      const rehomed = rehomeContent(original, identity);
      await this.refuseForeignRows(rehomed.content, organisation.organisationid, transaction);
      content = { file: options.content, rehomed };
      if (organisationAction === "reuse") {
        removals = await this.removalsOf(rehomed.content, organisation.organisationid, otherSchools, transaction);
      }
    }

    return {
      database: this.guards.configuredDatabase,
      mode: "provision",
      organisation: { action: organisationAction, row: organisation },
      school: { action: schoolAction, schoolid, schoolname, countryid: country?.countryid ?? null, countryname: country?.countryname ?? null },
      country: country
        ? { action: country.create ? "create" : country.revive ? "revive" : "reuse", countryid: country.countryid, countryname: country.countryname }
        : null,
      standard,
      standardsKept: existingClasses.length,
      logins,
      otherSchoolsMarkedDeleted: otherSchools,
      otherLiveSchoolIds,
      replaceSchool: options.replaceSchool,
      removals,
      content,
      reset: null,
    };
  };

  /** Writes everything in one transaction, verifies it in the same transaction, then commits. */
  apply = async (plan: ProvisionPlan, options: ProvisionOptions): Promise<ProvisionResult> => {
    let credentials: { fd: number; path: string } | null = null;
    const transaction = await this.sequelize.transaction();
    try {
      const created = plan.logins.filter((l) => l.action === "create");
      const needsFile = plan.reset !== null || created.length > 0;
      if (options.credentialsFile && needsFile) {
        // a refusal here is before anything is written
        credentials = createCredentialsFile(options.credentialsFile);
      }

      const newLogins: Array<{ kind: LoginKind; username: string; password: string }> = [];
      let counts: Record<string, unknown> | undefined;
      let verification: ProvisionVerification;
      // The classes the school has, read here in the transaction by a query of its own (not the one that built the
      // payload), before anything is written: each must still be here afterwards.
      const classesBefore = plan.reset
        ? []
        : (await standards.findAll({ attributes: ["standardid"], where: { schoolid: plan.school.schoolid }, transaction })).map((c) => c.standardid);

      if (plan.reset) {
        // Only the password changes; the login's session (one token per user) ends so the old password's token cannot go on.
        const password = generatePassword();
        const hash = hashPassword(password);
        const [affected] = await schoolusers.update({ schooluserpasswordhash: hash } as never, { where: { schooluserid: plan.reset.schooluserid }, transaction });
        if (affected !== 1) {
          throw new ProvisionError(`Check failed: the password update changed ${affected} rows, not exactly 1.`);
        }
        await tokens.destroy({ where: { lmsuserid: plan.reset.schooluserid }, transaction });
        const row = await schoolusers.scope("withOwnership").findOne({ where: { schooluserid: plan.reset.schooluserid }, transaction });
        if (!row || !row.schoolid || lower(row.schoolid) !== lower(plan.school.schoolid) || !verifyPassword(password, row.schooluserpasswordhash)) {
          throw new ProvisionError("Check failed: the new password is not set on that login of the school.");
        }
        newLogins.push({ kind: "reset", username: plan.reset.username, password });
        verification = { organisations: 1, schools: 1, standards: 0, logins: 1, payloadRowsChecked: 0, payloadRowsWrongOwner: 0 };
      } else {
        if (plan.country && plan.country.action === "create") {
          await countries.create({ countryid: plan.country.countryid, countryname: plan.country.countryname, isdeleted: false } as never, { transaction });
        } else if (plan.country && plan.country.action === "revive") {
          await countries.update({ isdeleted: false } as never, { where: { countryid: plan.country.countryid }, transaction });
        }
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
          } else if (plan.school.action === "restore") {
            await schools.update({ isdeleted: false } as never, { where: { schoolid: plan.school.schoolid }, transaction });
          }
          if (plan.otherSchoolsMarkedDeleted > 0) {
            // what the import does with a payload, said outright for the case with none
            await schools.update({ isdeleted: true } as never, {
              where: { organisationid: plan.organisation.row.organisationid, isdeleted: false, schoolid: { [Op.ne]: plan.school.schoolid } },
              transaction,
            });
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
        verification = await this.verify(plan, classesBefore, transaction);
      }

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

  /** The organisation by its code: reused under the same name, else a new one (never in reset mode). */
  private resolveOrganisation = async (
    options: ProvisionOptions,
    original: OrganisationContent | null,
    mustExist: boolean,
    transaction?: Transaction,
  ): Promise<{ organisation: OwnershipOrganisation; action: "create" | "reuse" }> => {
    const found = await organisations.findAll({ where: { organisationcode: options.code }, transaction });
    if (found.length > 1) {
      throw new ProvisionError(`More than one organisation here has the code "${options.code}". Nothing was changed.`);
    }
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
      return {
        action: "reuse",
        organisation: {
          organisationid: row.organisationid,
          organisationname: row.organisationname,
          organisationcode: row.organisationcode,
          organisationstatus: true,
          uitheme: row.uitheme,
          brandingconfig: (row.brandingconfig ?? null) as OwnershipOrganisation["brandingconfig"],
          settingsconfig: (row.settingsconfig ?? null) as OwnershipOrganisation["settingsconfig"],
          isdeleted: false,
        },
      };
    }
    if (mustExist) {
      throw new ProvisionError(`There is no organisation with code "${options.code}" here.`);
    }
    return {
      action: "create",
      organisation: {
        organisationid: uuidv4(),
        organisationname: options.organisation,
        organisationcode: options.code,
        organisationstatus: true,
        uitheme: original?.organisation.uitheme ?? "kids",
        brandingconfig: null,
        settingsconfig: null,
        isdeleted: false,
      },
    };
  };

  /**
   * A country by id, or by name as the `countries` table (or the payload) has it. With NO payload to carry
   * one, a name this server does not have yet is created (a fresh server's `countries` is empty); an id is not.
   */
  private resolveCountry = async (given: string, original: OrganisationContent | null, transaction?: Transaction): Promise<CountryChoice> => {
    const byId = UUID.test(given);
    // "The same name" is the database's (its collation, which its unique key uses): business/country-rehoming.ts.
    const lookup = mysqlCountryNames(transaction);
    const dbRow = (c: LocalCountry): Row => ({ countryid: c.countryid, countryname: c.countryname, expectedusage: c.expectedusage ?? null, isdeleted: false });
    // One rule for a country that is deleted here: it is brought back, in the payload path and the other alike.
    const inPayload: Row[] = [];
    for (const row of original?.tables.countries ?? []) {
      if (row.isdeleted) continue;
      if (byId ? lower(String(row.countryid)) === lower(given) : await lookup.sameName(String(row.countryname), given)) inPayload.push(row);
    }
    if (inPayload.length > 1) throw new ProvisionError("--country matches more than one country of the payload.");
    const inDatabase: LocalCountry[] = byId
      ? ((await countries.findAll({ attributes: ["countryid", "countryname", "expectedusage", "isdeleted"], where: { countryid: given }, raw: true, transaction })) as unknown as LocalCountry[])
      : await lookup.findByName(given);
    if (inDatabase.length > 1 && inPayload.length === 0) throw new ProvisionError("--country matches more than one country here.");
    if (inPayload.length === 1) {
      const row = inPayload[0];
      // The name is unique: a country of this name that is here (under whatever id) is the one to use, and the payload's row is re-homed onto it.
      const same = await lookup.findByName(String(row.countryname));
      if (same.length > 1) throw new ProvisionError("More than one country here has the name of the payload's country. Nothing was changed.");
      if (same.length === 1 && lower(same[0].countryid) !== lower(String(row.countryid))) {
        return { countryid: same[0].countryid, countryname: same[0].countryname, dbRow: dbRow(same[0]), create: false, revive: Boolean(same[0].isdeleted) };
      }
      return {
        countryid: String(row.countryid),
        countryname: String(row.countryname),
        dbRow: null,
        create: false,
        revive: same.length === 1 && Boolean(same[0].isdeleted),
      };
    }
    if (inDatabase.length === 1) {
      const row = inDatabase[0];
      return { countryid: row.countryid, countryname: row.countryname, dbRow: dbRow(row), create: false, revive: Boolean(row.isdeleted) };
    }
    if (!original && !byId) {
      if (Array.from(given).length > MAX_COUNTRY_NAME) {
        throw new ProvisionError(`--country is too long for a country name: at most ${MAX_COUNTRY_NAME} characters.`);
      }
      return { countryid: uuidv4(), countryname: given, dbRow: null, create: true, revive: false };
    }
    throw new ProvisionError(
      original
        ? "--country is not in the countries table of this server nor in the payload. Give a country id or a name the payload carries."
        : "--country is not in the countries table of this server. Give the country's name (it is created when there is no --content) or the id of a country that is here.",
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

  /** What the import would delete or mark deleted here, from reads alone (the payload is the whole truth about this organisation's content). */
  private removalsOf = async (content: OrganisationContent, organisationid: string, otherSchools: number, transaction?: Transaction): Promise<Removals> => {
    const missing = async (table: string, pk: string, payloadIds: string[], extraWhere = ""): Promise<number> => {
      const [rows] = (await this.sequelize.query(`SELECT \`${pk}\` AS id FROM \`${table}\` WHERE \`organisationid\` = :organisationid ${extraWhere}`, {
        replacements: { organisationid },
        transaction,
      })) as unknown as [Array<{ id: string }>, unknown];
      const kept = new Set(payloadIds.map(lower));
      return rows.filter((r) => !kept.has(lower(String(r.id)))).length;
    };
    const idsOf = (key: "questions" | "documents" | "subjects" | "curriculums", pk: string) => content.tables[key].map((r) => String(r[pk]));
    const schoolIds = content.tables.schools.map((r) => String(r.schoolid));
    const [classRows] = (await this.sequelize.query(`SELECT \`standardid\` AS id FROM \`standards\` WHERE \`schoolid\` IN (:schoolIds)`, {
      replacements: { schoolIds },
      transaction,
    })) as unknown as [Array<{ id: string }>, unknown];
    const payloadClasses = new Set(content.tables.standards.map((r) => lower(String(r.standardid))));
    return {
      classes: classRows.filter((r) => !payloadClasses.has(lower(String(r.id)))).length,
      questions: await missing("questions", "questionid", idsOf("questions", "questionid")),
      documents: await missing("documents", "documentid", idsOf("documents", "documentid")),
      subjects: await missing("subjects", "subjectid", idsOf("subjects", "subjectid")),
      curricula: await missing("curriculums", "curriculumid", idsOf("curriculums", "curriculumid"), "AND `isdeleted` = 0"),
      schools: otherSchools,
    };
  };

  /** Counts only. Throws (so the transaction rolls back) when anything is not as it should be. */
  private verify = async (plan: ProvisionPlan, classesBefore: string[], transaction: Transaction): Promise<ProvisionVerification> => {
    const organisationid = plan.organisation.row.organisationid;
    const orgRows = await organisations.findAll({ where: { organisationcode: plan.organisation.row.organisationcode }, transaction });
    if (orgRows.length !== 1 || lower(orgRows[0].organisationid) !== lower(organisationid) || orgRows[0].isdeleted || !orgRows[0].organisationstatus) {
      throw new ProvisionError("Check failed: the organisation is not here exactly once, active.");
    }
    const school = await schools.scope("withOwnership").findOne({ where: { schoolid: plan.school.schoolid }, transaction });
    if (!school || school.isdeleted || !school.organisationid || lower(school.organisationid) !== lower(organisationid)) {
      throw new ProvisionError("Check failed: the school is not here, live and owned by the organisation.");
    }
    // One school per server: exactly one live school, and no school that was live before is gone unless --replace-school said so.
    const live = await schools.scope("withOwnership").findAll({ attributes: ["schoolid"], where: { organisationid, isdeleted: false }, transaction });
    if (live.length !== 1 || lower(live[0].schoolid) !== lower(plan.school.schoolid)) {
      throw new ProvisionError(`Check failed: the organisation has ${live.length} live schools, not exactly the one named.`);
    }
    if (!plan.replaceSchool) {
      const gone = plan.otherLiveSchoolIds.filter((id) => !live.some((l) => lower(l.schoolid) === lower(id)));
      if (gone.length > 0) throw new ProvisionError("Check failed: another school of the organisation would be marked deleted, and --replace-school was not given.");
    }
    // Every class the school had is still here (the import replaces a school's classes as a whole).
    if (classesBefore.length > 0) {
      const kept = await standards.count({ where: { standardid: { [Op.in]: classesBefore }, schoolid: plan.school.schoolid }, transaction });
      if (kept !== classesBefore.length) {
        throw new ProvisionError(`Check failed: ${classesBefore.length - kept} class(es) the school had are gone.`);
      }
    }
    let standardsFound = 0;
    if (plan.standard) {
      standardsFound = await standards.count({ where: { standardid: plan.standard.standardid, schoolid: plan.school.schoolid, isdeleted: false }, transaction });
      if (standardsFound !== 1) throw new ProvisionError("Check failed: the class is not here.");
    }
    if (plan.content) {
      const wanted = plan.content.rehomed.content.tables.standards.map((r) => String(r.standardid));
      const present = wanted.length === 0 ? 0 : await standards.count({ where: { standardid: { [Op.in]: wanted }, schoolid: plan.school.schoolid }, transaction });
      if (present !== wanted.length) throw new ProvisionError("Check failed: a class of the school is missing.");
    }
    if (plan.country) {
      const country = await countries.count({ where: { countryid: plan.country.countryid, isdeleted: false }, transaction });
      if (country !== 1) throw new ProvisionError("Check failed: the country is not here.");
    }
    for (const login of plan.logins) {
      const row = await schoolusers.scope("withOwnership").findOne({ where: { schooluserid: login.schooluserid }, transaction });
      if (
        !row ||
        !sameLoginName(row.schoolusername, login.username) ||
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
