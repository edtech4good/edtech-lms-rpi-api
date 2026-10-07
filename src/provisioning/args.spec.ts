import { ProvisionError, parseArgs, sameLoginName } from "./args";

const base = ["--organisation", "Riverside Learning Network", "--code", "riverside", "--school", "Riverside Primary", "--country", "Cambodia", "--admin", "river.admin"];

/** `base` with one flag's value replaced. */
const withFlag = (flag: string, value: string): string[] => {
  const at = base.indexOf(flag);
  return [...base.slice(0, at + 1), value, ...base.slice(at + 2)];
};

const refused = (argv: string[]): string => {
  try {
    parseArgs(argv);
  } catch (e) {
    expect(e).toBeInstanceOf(ProvisionError);
    return (e as Error).message;
  }
  throw new Error("expected the arguments to be refused");
};

describe("provision arguments", () => {
  it("parses the full usage, with and without = between flag and value", () => {
    expect(
      parseArgs([...base, "--teacher", "river.teacher", "--class", "Class 3A", "--content", "x.json", "--credentials-file", "/tmp/c.txt", "--database", "db", "--apply", "--i-know-this-is-online"]),
    ).toEqual({
      organisation: "Riverside Learning Network",
      code: "riverside",
      school: "Riverside Primary",
      country: "Cambodia",
      admin: "river.admin",
      teacher: "river.teacher",
      className: "Class 3A",
      content: "x.json",
      credentialsFile: "/tmp/c.txt",
      database: "db",
      replaceSchool: false,
      apply: true,
      allowOnline: true,
    });
    expect(parseArgs(["--organisation=Riverside Learning Network", "--code=riverside", "--school=Riverside Primary", "--country=Cambodia", "--admin=river.admin"])).toEqual({
      organisation: "Riverside Learning Network",
      code: "riverside",
      school: "Riverside Primary",
      country: "Cambodia",
      admin: "river.admin",
      replaceSchool: false,
      apply: false,
      allowOnline: false,
    });
  });

  it("is a dry run unless --apply is given", () => {
    expect(parseArgs(base).apply).toBe(false);
  });

  it("keeps Khmer names whole (NFC, with every mark) and counts characters, not bytes", () => {
    const school = "សាលាបឋមសិក្សា ទន្លេមេគង្គ";
    const organisation = "បណ្តាញសិក្សាមេគង្គ";
    const parsed = parseArgs(["--organisation", organisation, "--code", "mekong", "--school", school, "--country", "កម្ពុជា", "--admin", "mekong.admin"]);
    expect(parsed.school).toBe(school);
    expect(parsed.organisation).toBe(organisation);
    expect(parsed.country).toBe("កម្ពុជា");
    // 45 Khmer characters are well over 45 bytes and still fit
    expect(parseArgs(withFlag("--school", "ក".repeat(45))).school).toBe("ក".repeat(45));
    expect(refused(withFlag("--school", "ក".repeat(46)))).toBe("--school is too long: at most 45 characters.");
  });

  it.each([
    ["Riverside", "--code must be 2 to 16 lower-case letters and digits."],
    ["river side", "--code must be 2 to 16 lower-case letters and digits."],
    ["r", "--code must be 2 to 16 lower-case letters and digits."],
    ["abcdefghijklmnopq", "--code must be 2 to 16 lower-case letters and digits."],
    ["mekong-2", "--code must be 2 to 16 lower-case letters and digits."],
    ["ក្រុម", "--code must be 2 to 16 lower-case letters and digits."],
  ])("refuses the code %p with the rule the API's own validator uses", (code, message) => {
    expect(refused(withFlag("--code", code))).toBe(message);
  });

  it("accepts the codes the rule allows, at its bounds", () => {
    for (const code of ["ab", "a1", "abcdefghijklmnop", "0123456789abcdef"]) {
      expect(parseArgs(withFlag("--code", code)).code).toBe(code);
    }
  });

  it("refuses what is missing, unknown, repeated or valueless, naming it", () => {
    expect(refused(base.slice(0, 8))).toMatch(/^--admin is required\./);
    expect(refused([...base, "--nope", "1"])).toMatch(/^Unknown option --nope\./);
    expect(refused([...base, "stray"])).toMatch(/^Unexpected argument "stray"\./);
    expect(refused([...base, "--admin", "someone.else"])).toBe("--admin was given twice.");
    expect(refused([...base, "--teacher"])).toBe("--teacher needs a value.");
    expect(refused([...base, "--teacher", "--apply"])).toBe("--teacher needs a value.");
    expect(refused([...base, "--apply=1"])).toBe("--apply takes no value.");
  });

  it("refuses logins that are too short, have spaces, or are the same for admin and teacher", () => {
    expect(refused(withFlag("--admin", "ab"))).toBe("--admin must be 3 to 45 letters, digits, dots, dashes or underscores.");
    expect(refused(withFlag("--admin", "has space"))).toBe("--admin must be 3 to 45 letters, digits, dots, dashes or underscores.");
    expect(refused([...base, "--teacher", "RIVER.ADMIN"])).toBe("--admin and --teacher must be different logins.");
    expect(refused([...base, "--teacher", "x"])).toBe("--teacher must be 3 to 45 letters, digits, dots, dashes or underscores.");
  });

  it("refuses an organisation, school or class name with a control character or no letter or digit", () => {
    expect(refused(withFlag("--organisation", "bad\nname"))).toMatch(/^--organisation must be text/);
    expect(refused(withFlag("--school", "..."))).toMatch(/^--school must be text/);
    expect(refused(withFlag("--school", "   "))).toMatch(/^--school is required\./);
    expect(refused([...base, "--class", "..."])).toMatch(/^--class must be text/);
  });

  it("takes --replace-school as a switch", () => {
    expect(parseArgs([...base, "--replace-school"]).replaceSchool).toBe(true);
    expect(refused([...base, "--replace-school=yes"])).toBe("--replace-school takes no value.");
  });

  describe("--reset-password", () => {
    const reset = ["--organisation", "Riverside Learning Network", "--code", "riverside", "--school", "Riverside Primary", "--reset-password", "river.admin"];

    it("needs only the organisation, code and school, and keeps the credentials file and database check", () => {
      expect(parseArgs([...reset, "--credentials-file", "/tmp/c.txt", "--database", "db", "--apply"])).toEqual({
        organisation: "Riverside Learning Network",
        code: "riverside",
        school: "Riverside Primary",
        resetPassword: "river.admin",
        credentialsFile: "/tmp/c.txt",
        database: "db",
        replaceSchool: false,
        apply: true,
        allowOnline: false,
      });
    });

    it.each([
      ["--admin", "someone.else"],
      ["--teacher", "a.teacher"],
      ["--class", "Class 3A"],
      ["--content", "x.json"],
      ["--country", "Cambodia"],
    ])("cannot be combined with %s: it only sets a password", (flag, value) => {
      expect(refused([...reset, flag, value])).toBe(`--reset-password only sets a password: it cannot be combined with ${flag}.`);
    });

    it("cannot be combined with --replace-school, and must name a well-formed login", () => {
      expect(refused([...reset, "--replace-school"])).toBe("--reset-password only sets a password: it cannot be combined with --replace-school.");
      expect(refused([...reset.slice(0, 6), "--reset-password", "x"])).toMatch(/^--reset-password must name a login/);
    });
  });

  it("calls two login names the same when they differ only in case (the database's collation does)", () => {
    expect(sameLoginName("River.Admin", "river.admin")).toBe(true);
    expect(sameLoginName("river.admin", "river.admin2")).toBe(false);
  });
});
