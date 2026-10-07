import { ORGANISATION_CODE } from "src/modules/import/ownership.request.validator";

/**
 * The arguments of `npm run provision` (scripts/provision.js), parsed and checked
 * before anything is read or written.
 *
 *   --organisation "<name>" --code <code> --school "<name>" --country <id or name>
 *   --admin <username> [--teacher <username>] [--class "<name>"]
 *   [--content <path to a .zip or .json>] [--credentials-file <path>]
 *   [--database <name>] [--apply] [--i-know-this-is-online]
 */

/** Thrown for anything the operator can fix: printed as one line, exit status 1, nothing written. */
export class ProvisionError extends Error {}

export interface ProvisionOptions {
  organisation: string;
  code: string;
  school: string;
  country: string;
  admin: string;
  teacher?: string;
  className?: string;
  content?: string;
  credentialsFile?: string;
  /** When given, must be the name of the database the server is configured for. */
  database?: string;
  apply: boolean;
  allowOnline: boolean;
}

export const USAGE = [
  "Usage: npm run provision -- --organisation \"<name>\" --code <code> --school \"<name>\" --country <country id or name>",
  "                            --admin <username> [--teacher <username>] [--class \"<name>\"]",
  "                            [--content <path to .zip or .json>] [--credentials-file <path>] [--apply]",
  "",
  "Without --apply this prints the plan and writes nothing. With --apply it writes everything in one",
  "transaction and shows each new login's password ONCE (or writes them to --credentials-file, mode 0600).",
  "Run it on the classroom server with RPI_OFFLINE=true. It never uses the network.",
].join("\n");

const VALUE_FLAGS: Record<string, keyof ProvisionOptions> = {
  organisation: "organisation",
  code: "code",
  school: "school",
  country: "country",
  admin: "admin",
  teacher: "teacher",
  class: "className",
  content: "content",
  "credentials-file": "credentialsFile",
  database: "database",
};
const SWITCHES: Record<string, keyof ProvisionOptions> = { apply: "apply", "i-know-this-is-online": "allowOnline" };

/** The longest a stored name may be (`schools.schoolname`, `standards.standardname`, `schoolusers.schoolusername` are VARCHAR(45)). */
export const MAX_SHORT_NAME = 45;
export const MAX_ORGANISATION_NAME = 250;

/** Control characters and the bidirectional controls that reorder displayed text (zero-width joiners stay: Khmer uses them). */
const FORBIDDEN_IN_NAME = /[\p{Cc}‪-‮⁦-⁩]/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** A login name: letters, digits, dot, dash, underscore; 3 to 45 characters, no spaces. */
export const USERNAME = /^[A-Za-z0-9._-]{3,45}$/;

const checkName = (label: string, value: string, max: number): string => {
  const trimmed = value.normalize("NFC").trim();
  if (trimmed.length === 0 || !HAS_LETTER_OR_DIGIT.test(trimmed) || FORBIDDEN_IN_NAME.test(trimmed)) {
    throw new ProvisionError(`${label} must be text with at least one letter or digit and no control characters.`);
  }
  if (Array.from(trimmed).length > max) {
    throw new ProvisionError(`${label} is too long: at most ${max} characters.`);
  }
  return trimmed;
};

export function parseArgs(argv: string[]): ProvisionOptions {
  const raw: Partial<Record<keyof ProvisionOptions, string | boolean>> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new ProvisionError(`Unexpected argument "${arg}".\n${USAGE}`);
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (name in SWITCHES) {
      if (eq !== -1) throw new ProvisionError(`--${name} takes no value.`);
      raw[SWITCHES[name]] = true;
      continue;
    }
    if (!(name in VALUE_FLAGS)) {
      throw new ProvisionError(`Unknown option --${name}.\n${USAGE}`);
    }
    const key = VALUE_FLAGS[name];
    if (key in raw) throw new ProvisionError(`--${name} was given twice.`);
    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new ProvisionError(`--${name} needs a value.`);
      i += 1;
    }
    raw[key] = value;
  }

  const need = (flag: string, key: keyof ProvisionOptions): string => {
    const value = raw[key];
    if (typeof value !== "string" || value.trim() === "") throw new ProvisionError(`--${flag} is required.\n${USAGE}`);
    return value;
  };

  const organisation = checkName("--organisation", need("organisation", "organisation"), MAX_ORGANISATION_NAME);
  const code = need("code", "code");
  if (!ORGANISATION_CODE.test(code)) {
    // The student API's own rule (ownership.request.validator.ts), which is central's rule: the code names the organisation in every payload.
    throw new ProvisionError("--code must be 2 to 16 lower-case letters and digits.");
  }
  const school = checkName("--school", need("school", "school"), MAX_SHORT_NAME);
  const country = need("country", "country").normalize("NFC").trim();
  const admin = need("admin", "admin");
  if (!USERNAME.test(admin)) throw new ProvisionError("--admin must be 3 to 45 letters, digits, dots, dashes or underscores.");
  const options: ProvisionOptions = {
    organisation,
    code,
    school,
    country,
    admin,
    apply: raw.apply === true,
    allowOnline: raw.allowOnline === true,
  };
  if (typeof raw.teacher === "string") {
    if (!USERNAME.test(raw.teacher)) throw new ProvisionError("--teacher must be 3 to 45 letters, digits, dots, dashes or underscores.");
    if (raw.teacher.toLowerCase() === admin.toLowerCase()) throw new ProvisionError("--admin and --teacher must be different logins.");
    options.teacher = raw.teacher;
  }
  if (typeof raw.className === "string") options.className = checkName("--class", raw.className, MAX_SHORT_NAME);
  if (typeof raw.content === "string" && raw.content !== "") options.content = raw.content;
  if (typeof raw.credentialsFile === "string" && raw.credentialsFile !== "") options.credentialsFile = raw.credentialsFile;
  if (typeof raw.database === "string" && raw.database !== "") options.database = raw.database;
  return options;
}

/** The text rule every reader of a school name uses (business/school-identity.ts): trim, NFC, lower-case. */
const normalise = (name: string): string => name.trim().normalize("NFC").toLowerCase();
export const sameName = (a: string, b: string): boolean => normalise(a) === normalise(b);
