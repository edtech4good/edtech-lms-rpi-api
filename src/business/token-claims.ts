import { UnauthorizedException } from "@nestjs/common";
import { ApiError } from "src/models/ApiError";
import { organisations } from "src/models/data-models/organisations";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { schools } from "src/models/data-models/school";
import { isGiven } from "./school-identity";

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
 * There is no exception: a token with no organisation is refused on a classroom Pi as
 * much as online. A school with no organisation here cannot have people signed in.
 */
export interface TokenClaims {
  schoolid?: unknown;
  schoolname?: unknown;
  organisationid?: unknown;
}

const refuse = (): never => {
  throw new UnauthorizedException();
};

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
 * whose school is deleted, or whose organisation is suspended or deleted. A school with no organisation
 * cannot sign anyone in, on a classroom Pi as much as online.
 */
export async function assertCanSignIn(claims: { schoolid: string | null; organisationid: string | null; isdeleted?: boolean }): Promise<void> {
  // One message for every reason: it must not say whether the school, the organisation or its status is the cause.
  const refused = (): never => {
    throw new ApiError(ErrorCode.SIGN_IN_REQUIRED, {
      message: "This account can't sign in right now.",
      hint: "Ask your school.",
    });
  };
  if (!claims.schoolid || claims.isdeleted) {
    // no school, or one that is deleted (the same answer as a school that is not here)
    return refused();
  }
  if (!claims.organisationid) {
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
