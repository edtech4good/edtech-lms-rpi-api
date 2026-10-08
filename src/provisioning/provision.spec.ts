import * as crypto from "crypto";

// randomInt is a read-only export of the module: wrap it so a spec can see what draws it is asked for.
jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

import { closeSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProvisionError, ProvisionOptions } from "./args";
import { PASSWORD_ALPHABET, PASSWORD_LENGTH, Provisioner, checkEnvironment, createCredentialsFile, generatePassword } from "./provision";
import { describePlan, describeResult } from "./cli";
import { ProvisionPlan } from "./provision";
import { verifyPassword } from "src/services/password.service";
import { countries } from "src/models/data-models/countries";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { dbinstance } from "src/services/dbservice";
import { collateCountryName } from "src/test-support/country-names";

const options = (extra: Partial<ProvisionOptions> = {}): ProvisionOptions => ({
  organisation: "Riverside Learning Network",
  code: "riverside",
  school: "Riverside Primary",
  country: "Cambodia",
  admin: "river.admin",
  replaceSchool: false,
  apply: false,
  allowOnline: false,
  ...extra,
});

const refusal = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProvisionError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
};

describe("provision environment guard", () => {
  it("refuses a server that is not set up as a classroom (offline) server, saying how to proceed", () => {
    const message = refusal(() => checkEnvironment(options(), { offline: false, configuredDatabase: "edtech_lms_rpi" }));
    expect(message).toBe(
      "This is a classroom-server tool: RPI_OFFLINE is not set, so this server looks like an online one. " +
        "Set RPI_OFFLINE=true on the classroom server, or pass --i-know-this-is-online (for tests).",
    );
  });

  it("runs on an offline server, or online only with the explicit flag", () => {
    expect(() => checkEnvironment(options(), { offline: true, configuredDatabase: "edtech_lms_rpi" })).not.toThrow();
    expect(() => checkEnvironment(options({ allowOnline: true }), { offline: false, configuredDatabase: "edtech_lms_rpi" })).not.toThrow();
  });

  it("refuses a database name that is not the configured one, and accepts the configured one", () => {
    expect(refusal(() => checkEnvironment(options({ database: "edtech_lms" }), { offline: true, configuredDatabase: "edtech_lms_rpi" }))).toBe(
      '--database names "edtech_lms", but this server is configured for "edtech_lms_rpi". Nothing was changed.',
    );
    expect(() => checkEnvironment(options({ database: "edtech_lms_rpi" }), { offline: true, configuredDatabase: "edtech_lms_rpi" })).not.toThrow();
  });
});

describe("generated passwords", () => {
  it("are random, 16 characters, free of look-alike characters, and verify as the server verifies them (bcrypt of md5)", async () => {
    const { hashPassword } = await import("src/services/password.service");
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const password = generatePassword();
      expect(password).toHaveLength(PASSWORD_LENGTH);
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
    const password = generatePassword();
    const hash = hashPassword(password);
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword(password + "x", hash)).toBe(false);
  });
});

describe("what the command prints", () => {
  const organisation = {
    organisationid: "11111111-1111-4111-8111-111111111111",
    organisationname: "Riverside Learning Network",
    organisationcode: "riverside",
    organisationstatus: true,
    uitheme: "kids",
    brandingconfig: null,
    settingsconfig: null,
    isdeleted: false,
  };
  const plan: ProvisionPlan = {
    database: "edtech_lms_rpi",
    mode: "provision",
    organisation: { action: "create", row: organisation },
    school: { action: "create", schoolid: "22222222-2222-4222-8222-222222222222", schoolname: "Riverside Primary", countryid: null, countryname: "Cambodia" },
    country: { action: "create", countryid: "44444444-4444-4444-8444-444444444444", countryname: "Cambodia" },
    standard: null,
    standardsKept: 2,
    logins: [{ kind: "admin", username: "river.admin", action: "create", schooluserid: "33333333-3333-4333-8333-333333333333" }],
    otherSchoolsMarkedDeleted: 0,
    otherLiveSchoolIds: [],
    replaceSchool: false,
    removals: null,
    content: null,
    reset: null,
  };

  it("a dry run says nothing is written", () => {
    expect(describePlan(plan, false)).toContain("dry run: nothing is written");
    expect(describePlan(plan, true)).not.toContain("dry run");
  });

  it("a dry run shows (new) where --apply will mint an id of its own, and --apply shows the id", () => {
    expect(describePlan(plan, false)).toContain("id (new)");
    expect(describePlan(plan, false)).not.toContain(organisation.organisationid);
    expect(describePlan(plan, true)).toContain(organisation.organisationid);
  });

  it("says a country is created when the server has none, and that the existing classes stay", () => {
    const text = describePlan(plan, false);
    expect(text).toContain('country       create  "Cambodia"');
    expect(text).toContain("the school's 2 existing classes stay as they are");
  });

  it("lists what the import would delete or mark deleted, and the other school a replace would delete", () => {
    const text = describePlan(
      { ...plan, otherSchoolsMarkedDeleted: 1, removals: { classes: 0, questions: 3, documents: 1, subjects: 0, curricula: 2, schools: 1 } },
      false,
    );
    expect(text).toContain("the import will DELETE (this organisation's rows the payload does not have): 3 questions, 1 document");
    expect(text).toContain("the import will mark deleted: 2 curricula, 1 school");
    expect(text).toContain("--replace-school: 1 other school of this organisation will be marked deleted");
  });

  it("says when a country that is deleted here is brought back, and how many payload countries were re-homed by name", () => {
    const revive = describePlan({ ...plan, country: { action: "revive", countryid: "44444444-4444-4444-8444-444444444444", countryname: "កម្ពុជា" } }, false);
    expect(revive).toContain('country       revive  "កម្ពុជា" (it is deleted here; a country is a shared reference row, so it is brought back)');
    expect(describePlan(plan, false)).not.toContain("revive");
    const withContent = (countriesRemapped: number): ProvisionPlan => ({
      ...plan,
      content: {
        file: "payload.json",
        rehomed: {
          summary: { ownersRewritten: {}, schoolsInPayload: 1, standardsInPayload: 1, baselineListsRewritten: 0, curricula: 1, countryAdded: false, countriesRemapped, rows: { organisations: 1 } },
        },
      } as unknown as NonNullable<ProvisionPlan["content"]>,
    });
    expect(describePlan(withContent(1), false)).toContain("countries re-homed onto this server's row of the same name: 1");
    expect(describePlan(withContent(0), false)).toContain("countries re-homed onto this server's row of the same name: 0");
  });

  it("describes a password reset as changing nothing else, and shows the new password once", () => {
    const resetPlan: ProvisionPlan = { ...plan, mode: "reset", reset: { schooluserid: "33333333-3333-4333-8333-333333333333", username: "river.admin" } };
    expect(describePlan(resetPlan, false)).toContain("new password for river.admin (its session ends); nothing else is changed");
    expect(describeResult({ plan: resetPlan, applied: true, newLogins: [{ kind: "reset", username: "river.admin", password: "Abcdefghjk234567" }] })).toContain("new      river.admin   Abcdefghjk234567");
  });

  it("shows a new password once, with the warning, and never when a file got it", () => {
    const shown = describeResult({ plan, applied: true, newLogins: [{ kind: "admin", username: "river.admin", password: "Abcdefghjk234567" }] });
    expect(shown).toContain("shown this ONCE");
    expect(shown).toContain("Abcdefghjk234567");
    const filed = describeResult({ plan, applied: true, credentialsFile: "/safe/place.txt" });
    expect(filed).toContain("/safe/place.txt");
    expect(filed).not.toContain("PASSWORDS");
    const none = describeResult({ plan, applied: true, newLogins: [] });
    expect(none).toContain("No login was created, so no password is shown");
  });
});

describe("password generation uses the system's secure random source", () => {
  it("draws every character with crypto.randomInt over the whole alphabet", () => {
    const spy = crypto.randomInt as unknown as jest.Mock;
    spy.mockClear();
    const password = generatePassword();
    expect(spy).toHaveBeenCalledTimes(PASSWORD_LENGTH);
    for (const call of spy.mock.calls) expect(call).toEqual([PASSWORD_ALPHABET.length]);
    expect(password).toHaveLength(PASSWORD_LENGTH);
  });

  it("takes each character from what that draw returned (a fixed draw gives a fixed password)", () => {
    const spy = crypto.randomInt as unknown as jest.Mock;
    const real = spy.getMockImplementation();
    spy.mockImplementation(() => 0);
    expect(generatePassword()).toBe(PASSWORD_ALPHABET[0].repeat(PASSWORD_LENGTH));
    spy.mockImplementation(real);
  });
});

describe("the credentials file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "provision-creds-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is created readable and writable by its owner only (mode 0600)", () => {
    const path = join(dir, "credentials.txt");
    const file = createCredentialsFile(path);
    closeSync(file.fd);
    expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
  });

  it("is never created over a file that is there, and the file it refuses to replace is left as it was", () => {
    const path = join(dir, "credentials.txt");
    writeFileSync(path, "keep me", { mode: 0o644 });
    expect(refusal(() => createCredentialsFile(path))).toBe(`Cannot create the credentials file (it must not exist yet): ${path}`);
    expect(readFileSync(path, "utf8")).toBe("keep me");
  });
});

describe("Provisioner.plan: --country names the SECOND of two payload countries the database calls equal", () => {
  afterEach(() => jest.restoreAllMocks());

  it("the plan's country and the school's country are the first (kept) one, the payload's school points at it, and the printed plan names it", async () => {
    const FIRST = "b0000000-0000-4000-8000-0000000000f1";
    const SECOND = "b0000000-0000-4000-8000-0000000000f2";
    const dir = mkdtempSync(join(tmpdir(), "provision-plan-"));
    try {
      const payload = JSON.parse(readFileSync("scripts/provision/sample-content.json", "utf8"));
      const first = { ...payload.countries[0], countryid: FIRST, countryname: "Testland" };
      const second = { ...first, countryid: SECOND, countryname: "TÉSTLAND " }; // the same name for the database (case, accent, trailing space)
      payload.countries = [first, second];
      payload.schools = payload.schools.map((sc: Record<string, unknown>) => ({ ...sc, countryid: FIRST }));
      const file = join(dir, "content.json");
      writeFileSync(file, JSON.stringify(payload));

      // a fresh server: no organisation, school, login or country; the only queries that matter are the two the country lookup asks MySQL
      jest.spyOn(organisations, "findAll").mockResolvedValue([] as never);
      jest.spyOn(countries, "findAll").mockResolvedValue([] as never);
      jest.spyOn(schools, "scope").mockReturnValue({ findAll: async () => [] } as never);
      jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: async () => null } as never);
      jest.spyOn(dbinstance.getdbinstance(), "query").mockImplementation((async (sql: string, opts?: { replacements?: { a: string; b: string } }) => {
        if (/INFORMATION_SCHEMA/i.test(sql)) return [{ cs: "utf8mb4", coll: "utf8mb4_unicode_ci" }];
        if (/AS same$/i.test(sql.trim()) && opts?.replacements) return [{ same: collateCountryName(opts.replacements.a) === collateCountryName(opts.replacements.b) ? 1 : 0 }];
        return [[]]; // the rows of another organisation's content: none
      }) as never);

      const plan = await new Provisioner({ offline: true, configuredDatabase: "edtech_lms_rpi" }).plan(options({ country: SECOND, admin: "river.admin", content: file }));

      expect(plan.country).toEqual({ action: "reuse", countryid: FIRST, countryname: "Testland" });
      expect(plan.school).toMatchObject({ countryid: FIRST, countryname: "Testland" });
      expect(plan.content?.rehomed.content.tables.countries.map((r) => r.countryid)).toEqual([FIRST]);
      expect(plan.content?.rehomed.content.tables.schools.map((r) => r.countryid)).toEqual([FIRST]);
      expect(describePlan(plan, false)).toContain('"Riverside Primary"  id (new)  country Testland');
      expect(describePlan(plan, false)).not.toContain("TÉSTLAND");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
