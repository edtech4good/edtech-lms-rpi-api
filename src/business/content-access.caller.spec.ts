import { Config } from "src/config";
import { callerOf, claimsOf } from "./content-access";

/**
 * Who a token stands for, from its claims alone. A token with no organisation claim stands for nobody, on a
 * classroom Pi (`RPI_OFFLINE`) as much as online: the strategy refuses such a token before any route runs, and
 * this is the second line, so it is pinned on its own.
 */
const ORG = "0a000000-0000-4000-8000-00000000000a";
const SCHOOL = "5c000000-0000-4000-8000-0000000000a1";

const originalOffline = Config.fortyk.api.rpi.offline;
afterEach(() => {
  Config.fortyk.api.rpi.offline = originalOffline;
});

describe.each([[true], [false]])("callerOf / claimsOf (RPI_OFFLINE=%p)", (offline) => {
  beforeEach(() => {
    Config.fortyk.api.rpi.offline = offline;
  });

  it("a token with both claims is its school and organisation, trimmed", () => {
    expect(callerOf({ organisationid: ` ${ORG} `, schoolid: SCHOOL })).toEqual({ organisationid: ORG, schoolid: SCHOOL });
    expect(claimsOf({ organisationid: ORG, schoolid: SCHOOL })).toEqual({ organisationid: ORG, schoolid: SCHOOL });
  });

  it.each([
    ["no organisation claim, with a school", { schoolid: SCHOOL }],
    ["a null organisation", { schoolid: SCHOOL, organisationid: null }],
    ["an empty organisation", { schoolid: SCHOOL, organisationid: "" }],
    ["a blank organisation", { schoolid: SCHOOL, organisationid: "  " }],
    ["a number for an organisation", { schoolid: SCHOOL, organisationid: 42 }],
    ["no school", { organisationid: ORG }],
    ["nothing at all", {}],
  ])("%s is nobody", (_name, claims) => {
    expect(callerOf(claims as never)).toBeNull();
    expect(claimsOf(claims as never)).toBeNull();
  });

  it("no token is nobody", () => {
    expect(callerOf(undefined)).toBeNull();
    expect(claimsOf(undefined)).toBeNull();
  });
});
