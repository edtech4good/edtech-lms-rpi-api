import { UnauthorizedException } from "@nestjs/common";
import { Config } from "src/config";
import { ApiError } from "src/models/ApiError";
import { organisations } from "src/models/data-models/organisations";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { schools } from "src/models/data-models/school";
import { findSchoolIdByName, isGiven } from "./school-identity";

/**
 * What a signed-in request must prove about the organisation it acts for.
 *
 * Every learner and staff token carries the `schoolid` and the `organisationid` of
 * the school it belongs to, resolved when the person signed in. A request is
 * refused (401: the client signs in again) when
 *  - either claim is missing or null (a token from before the claims existed, or a
 *    sign-in that could not resolve a school or an organisation);
 *  - the organisation is not here, is suspended or is deleted;
 *  - the school is not here, or is no longer the organisation's.
 *
 * The one exception is a classroom Pi (`RPI_OFFLINE`) whose own school has no
 * organisation yet. A staff member signs in there with no `organisationid`, and
 * the content import is what gives the school its organisation. That token is
 * accepted ONLY on the import route (the route's guard says so with
 * `markPiBootstrapRoute`), and ONLY while its school is a school here that still
 * has no organisation. Everywhere else it is refused like any claim-less token.
 */
export interface TokenClaims {
  schoolid?: unknown;
  schoolname?: unknown;
  organisationid?: unknown;
}

export interface TokenClaimOptions {
  /** True only on the request of the route a Pi's unowned school uses to get its organisation. */
  piBootstrapRoute?: boolean;
}

const refuse = (): never => {
  throw new UnauthorizedException();
};

/** Is the school this token names (by id, else by name) a school here with no organisation? */
async function ownSchoolIsUnowned(claims: TokenClaims): Promise<boolean> {
  let own: string | null = null;
  if (isGiven(claims.schoolid)) {
    own = claims.schoolid.trim();
  } else if (isGiven(claims.schoolname)) {
    own = await findSchoolIdByName(claims.schoolname, { strict: true }).catch(() => null);
  }
  if (!own) {
    return false;
  }
  const row = (await schools.scope("withOwnership").findOne({
    attributes: ["schoolid", "organisationid"],
    where: { schoolid: own },
    raw: true,
  })) as unknown as { organisationid: string | null } | null;
  return Boolean(row) && (row!.organisationid === null || row!.organisationid === undefined || row!.organisationid === "");
}

/** Is the organisation here, not deleted and not suspended? */
export async function organisationIsActive(organisationid: string): Promise<boolean> {
  const organisation = await organisations.findOne({
    attributes: ["organisationid", "organisationstatus", "isdeleted"],
    where: { organisationid: organisationid.trim() },
  });
  return Boolean(organisation) && !organisation!.isdeleted && Boolean(organisation!.organisationstatus);
}

/**
 * Sign-in is refused (401, one neutral message) for a login whose school or organisation cannot be resolved,
 * or whose organisation is suspended or deleted. The one exception is a classroom Pi (`RPI_OFFLINE`) whose
 * school is here but has no organisation yet: staff sign in there with no `organisationid` so that the
 * content import can give the school its organisation (see the note above).
 */
export async function assertCanSignIn(claims: { schoolid: string | null; organisationid: string | null }): Promise<void> {
  // One message for every reason: it must not say whether the school, the organisation or its status is the cause.
  const refused = (): never => {
    throw new ApiError(ErrorCode.SIGN_IN_REQUIRED, {
      message: "This account can't sign in right now.",
      hint: "Ask your school.",
    });
  };
  if (!claims.schoolid) {
    return refused();
  }
  if (!claims.organisationid) {
    if (Config.fortyk.api.rpi.offline) {
      return;
    }
    return refused();
  }
  if (!(await organisationIsActive(claims.organisationid))) {
    return refused();
  }
}

export async function checkTokenClaims(claims: TokenClaims, options: TokenClaimOptions = {}): Promise<void> {
  const organisationid = claims.organisationid;
  const schoolid = claims.schoolid;

  if (!isGiven(organisationid) || !isGiven(schoolid)) {
    const noOrganisation = organisationid === undefined || organisationid === null;
    if (noOrganisation && options.piBootstrapRoute === true && Config.fortyk.api.rpi.offline && (await ownSchoolIsUnowned(claims))) {
      return;
    }
    return refuse();
  }

  if (!(await organisationIsActive(organisationid))) {
    return refuse();
  }

  const school = await schools.scope("withOwnership").findOne({
    attributes: ["schoolid", "organisationid"],
    where: { schoolid: schoolid.trim() },
  });
  if (!school || !school.organisationid || school.organisationid.toLowerCase() !== organisationid.trim().toLowerCase()) {
    return refuse();
  }
}
