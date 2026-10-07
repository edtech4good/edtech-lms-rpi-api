import { ProvisionError, ProvisionOptions } from "./args";
import { PASSWORD_LENGTH, checkEnvironment, generatePassword } from "./provision";
import { describePlan, describeResult } from "./cli";
import { verifyPassword } from "src/services/password.service";

const options = (extra: Partial<ProvisionOptions> = {}): ProvisionOptions => ({
  organisation: "Riverside Learning Network",
  code: "riverside",
  school: "Riverside Primary",
  country: "Cambodia",
  admin: "river.admin",
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
  const plan = {
    database: "edtech_lms_rpi",
    organisation: { action: "create" as const, row: organisation },
    school: { action: "create" as const, schoolid: "22222222-2222-4222-8222-222222222222", schoolname: "Riverside Primary", countryid: null, countryname: "Cambodia" },
    standard: null,
    logins: [{ kind: "admin" as const, username: "river.admin", action: "create" as const, schooluserid: "33333333-3333-4333-8333-333333333333" }],
    otherSchoolsMarkedDeleted: 0,
    content: null,
  };

  it("a dry run says nothing is written", () => {
    expect(describePlan(plan, false)).toContain("dry run: nothing is written");
    expect(describePlan(plan, true)).not.toContain("dry run");
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
