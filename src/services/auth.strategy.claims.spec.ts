import { UnauthorizedException } from "@nestjs/common";
import { Sequelize } from "sequelize";
import { Config } from "src/config";
import { initModels } from "src/models/data-models/init-models";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { JwtAccessStrategy } from "./auth.strategy";

/**
 * The strategy refuses a token that does not prove the organisation it acts for (organisations package 8):
 * both `schoolid` and `organisationid` must be present, the organisation must be here and neither suspended
 * nor deleted, and the school must still be that organisation's. The one exception is a classroom Pi
 * (`RPI_OFFLINE`) whose own school has no organisation yet: a token with no organisation is accepted, on every
 * route, ONLY while the school is here and unowned (and never online).
 *
 * No database: the token table and the two lookups are stubbed; the rule is the real code.
 */
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists: jest.fn().mockResolvedValue(true) })),
}));

const ORG = "0a000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "0b000000-0000-4000-8000-00000000000b";
const SCHOOL = "5c000000-0000-4000-8000-0000000000a1";
const UNOWNED = "5c000000-0000-4000-8000-0000000000c3";

let orgs: Record<string, { organisationstatus: boolean; isdeleted: boolean }>;
let schoolRows: Record<string, { schoolid: string; organisationid: string | null; isdeleted?: boolean }>;
let schoolByName: Record<string, string>;

beforeAll(() => {
  initModels(new Sequelize("test", "test", "test", { dialect: "mysql", logging: false }));
});

const originalOffline = Config.fortyk.api.rpi.offline;
beforeEach(() => {
  orgs = {
    [ORG]: { organisationstatus: true, isdeleted: false },
    [OTHER_ORG]: { organisationstatus: true, isdeleted: false },
  };
  schoolRows = {
    [SCHOOL]: { schoolid: SCHOOL, organisationid: ORG },
    [UNOWNED]: { schoolid: UNOWNED, organisationid: null },
  };
  schoolByName = { "Unowned School": UNOWNED };
  jest.spyOn(organisations, "findOne").mockImplementation((async (o: { where: { organisationid: string } }) => {
    // the column's collation ignores letter case
    const row = orgs[o.where.organisationid.toLowerCase()];
    return row ? { organisationid: o.where.organisationid, ...row } : null;
  }) as never);
  jest.spyOn(schools, "findOne").mockImplementation((async (o: { where: { schoolid: string } }) => schoolRows[o.where.schoolid] ?? null) as never);
  jest.spyOn(schools, "findAll").mockImplementation((async (o: { where: { logic?: string } }) => {
    // the by-name narrowing of the school resolver: the name is compared as text
    const id = schoolByName[String(o.where.logic ?? "")];
    return id ? [{ schoolid: id, schoolname: String(o.where.logic), isdeleted: false }] : [];
  }) as never);
});
afterEach(() => {
  Config.fortyk.api.rpi.offline = originalOffline;
  jest.restoreAllMocks();
});

const strategy = () => new JwtAccessStrategy();
const refused = (claims: Record<string, unknown>) =>
  expect(strategy().validate({ jti: "j", sub: "u1", schooluserid: "u1", ...claims })).rejects.toBeInstanceOf(UnauthorizedException);
const accepted = (claims: Record<string, unknown>) =>
  expect(strategy().validate({ jti: "j", sub: "u1", schooluserid: "u1", ...claims })).resolves.toMatchObject({ jti: "j", ...claims });

describe("JwtAccessStrategy: a token must prove its school and organisation", () => {
  it("accepts a token whose school belongs to an active organisation, and passes the claims through", async () => {
    await accepted({ schoolid: SCHOOL, organisationid: ORG });
  });

  it("accepts it in the same way on a classroom Pi", async () => {
    Config.fortyk.api.rpi.offline = true;
    await accepted({ schoolid: SCHOOL, organisationid: ORG });
  });

  it("refuses a token with neither claim (one from before the claims existed)", async () => {
    await refused({});
  });

  it("refuses a token with only one of the claims", async () => {
    await refused({ schoolid: SCHOOL });
    await refused({ organisationid: ORG });
  });

  it("refuses null, empty and non-text claims", async () => {
    await refused({ schoolid: null, organisationid: null });
    await refused({ schoolid: SCHOOL, organisationid: null });
    await refused({ schoolid: null, organisationid: ORG });
    await refused({ schoolid: SCHOOL, organisationid: "" });
    await refused({ schoolid: "  ", organisationid: ORG });
    await refused({ schoolid: SCHOOL, organisationid: 42 });
    await refused({ schoolid: ["x"], organisationid: ORG });
  });

  it("refuses a token whose organisation is suspended", async () => {
    orgs[ORG].organisationstatus = false;
    await refused({ schoolid: SCHOOL, organisationid: ORG });
  });

  it("refuses a token whose organisation is deleted", async () => {
    orgs[ORG].isdeleted = true;
    await refused({ schoolid: SCHOOL, organisationid: ORG });
  });

  it("refuses a token whose organisation is not here", async () => {
    await refused({ schoolid: SCHOOL, organisationid: "0c000000-0000-4000-8000-00000000000c" });
  });

  it("refuses a token whose school is not here", async () => {
    await refused({ schoolid: "5c000000-0000-4000-8000-00000000dead", organisationid: ORG });
  });

  it("refuses a token whose school now belongs to another organisation (the school moved since sign-in)", async () => {
    schoolRows[SCHOOL].organisationid = OTHER_ORG;
    await refused({ schoolid: SCHOOL, organisationid: ORG });
  });

  it("refuses a token whose school is soft-deleted (as it refuses a deleted organisation)", async () => {
    schoolRows[SCHOOL].isdeleted = true;
    await refused({ schoolid: SCHOOL, organisationid: ORG });
  });

  it("refuses a token that names an organisation whose school has none", async () => {
    await refused({ schoolid: UNOWNED, organisationid: ORG });
  });

  it("compares the school's organisation without regard to letter case", async () => {
    await accepted({ schoolid: SCHOOL, organisationid: ORG.toUpperCase() });
  });
});

describe("JwtAccessStrategy: the classroom Pi whose school has no organisation yet", () => {
  beforeEach(() => {
    Config.fortyk.api.rpi.offline = true;
  });

  it("accepts a token with no organisation, on any route, while its school is here and unowned", async () => {
    await accepted({ schoolid: UNOWNED });
    await accepted({ schoolid: UNOWNED, organisationid: null });
  });

  it("finds the unowned school by its name when the token carries no id (a token from before the claims existed)", async () => {
    await accepted({ schoolid: null, schoolname: "Unowned School", organisationid: null });
    await accepted({ schoolname: "Unowned School" });
  });

  it("refuses it online, always", async () => {
    Config.fortyk.api.rpi.offline = false;
    await refused({ schoolid: UNOWNED });
    await refused({ schoolid: UNOWNED, organisationid: null });
    await refused({ schoolname: "Unowned School" });
  });

  it("refuses it once its school has an owner (the token is stale: it signs in again)", async () => {
    await refused({ schoolid: SCHOOL });
    await refused({ schoolid: SCHOOL, organisationid: null });
  });

  it("refuses it when its school is not here, or the token names none", async () => {
    await refused({ schoolid: "5c000000-0000-4000-8000-00000000dead" });
    await refused({});
    await refused({ schoolname: "Nowhere School" });
  });

  it("does not take an organisation claim that is not null as 'no organisation' (an empty or odd value is refused)", async () => {
    await refused({ schoolid: UNOWNED, organisationid: "" });
    await refused({ schoolid: UNOWNED, organisationid: 42 });
    await refused({ schoolid: UNOWNED, organisationid: "  " });
  });

  it("does not let a token that HAS an organisation use the exception: its organisation and school are checked as usual", async () => {
    orgs[ORG].organisationstatus = false;
    await refused({ schoolid: SCHOOL, organisationid: ORG });
    await refused({ schoolid: UNOWNED, organisationid: ORG });
  });
});
