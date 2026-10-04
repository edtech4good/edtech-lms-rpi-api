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
 *  - the school is not here, is deleted, or is no longer the organisation's.
 *
 * The one exception is a classroom Pi (`RPI_OFFLINE`) whose own school has no
 * organisation yet (the window between a code update and the first format-3 zip).
 * A learner or staff member signs in there with no `organisationid`, and the
 * content import is what gives the school its organisation. That token is accepted
 * on every route, ONLY while its school is a school here that still has no
 * organisation, and its scope is that one school (see content-access.ts). Once the
 * school is owned the token is refused like any other without the claim, so people
 * sign in again. Online, a token with no organisation is always refused.
 */
export interface TokenClaims {
  schoolid?: unknown;
  schoolname?: unknown;
  organisationid?: unknown;
}

const refuse = (): never => {
  throw new UnauthorizedException();
};

/**
 * On a classroom Pi, the id of the school this token names (by id, else by name) when it is a school here with no
 * organisation and the token itself has no organisation (null or absent: an empty or odd claim is not "none").
 * Null in every other case, and always online.
 */
export async function unownedPiSchoolOf(claims: TokenClaims): Promise<string | null> {
  if (!Config.fortyk.api.rpi.offline || (claims.organisationid !== undefined && claims.organisationid !== null)) {
    return null;
  }
  let own: string | null = null;
  if (isGiven(claims.schoolid)) {
    own = claims.schoolid.trim();
  } else if (isGiven(claims.schoolname)) {
    own = await findSchoolIdByName(claims.schoolname, { strict: true }).catch(() => null);
  }
  if (!own) {
    return null;
  }
  const row = (await schools.scope("withOwnership").findOne({
    attributes: ["schoolid", "organisationid"],
    where: { schoolid: own },
    raw: true,
  })) as unknown as { organisationid: string | null } | null;
  return row && (row.organisationid === null || row.organisationid === undefined || row.organisationid === "") ? own : null;
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

export async function checkTokenClaims(claims: TokenClaims): Promise<void> {
  const organisationid = claims.organisationid;
  const schoolid = claims.schoolid;

  if (!isGiven(organisationid) || !isGiven(schoolid)) {
    if (await unownedPiSchoolOf(claims)) {
      return;
    }
    return refuse();
  }

  if (!(await organisationIsActive(organisationid))) {
    return refuse();
  }

  const school = await schools.scope("withOwnership").findOne({
    attributes: ["schoolid", "organisationid", "isdeleted"],
    where: { schoolid: schoolid.trim() },
  });
  // a school that is soft-deleted is gone, like an organisation that is deleted
  if (!school || school.isdeleted || !school.organisationid || school.organisationid.toLowerCase() !== organisationid.trim().toLowerCase()) {
    return refuse();
  }
}
