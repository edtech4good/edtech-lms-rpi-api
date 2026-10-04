import { Op, WhereOptions } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { IMultiFilter } from "src/models/IPaging";
import { Token } from "src/models/token.model";
import { callerKindOf, claimsOf, ContentKind, curriculaInScope, curriculumIdsOf, schoolCurriculumList } from "./content-access";

/**
 * Whose learners (and which content) a report, a login-time read or a baseline result may cover.
 *
 * Who calls, and what they get:
 *  - the server sync key with `X-Organisation-Id: <organisation id>`: central acting for one organisation. The
 *    scope is every school of that organisation here. Central also rewrites the body so each school filter is one
 *    list of ids inside that organisation, but the student API does not rely on it: this scope is applied as a
 *    further condition on every query, so a body that names another organisation's school or learner finds
 *    nothing.
 *  - the server sync key with `X-Organisation-Id: platform` (exactly that text, in lower case): central acting for
 *    a platform user who is not acting as an organisation. That is the unscoped view (`null`). It is acceptable
 *    only because the key is server-to-server, and it must be asked for.
 *  - the server sync key WITHOUT the header, or with one that is blank, in another case or not an identifier:
 *    refused (400). Silence never means "everything".
 *  - a staff token (teacher, admin, super admin): the token's own school, and the curricula of that school's list.
 *    A header sent with a token is ignored.
 *  - a learner token (only where a route admits one): the token's own login and nothing else.
 */
export interface ReportScope {
  organisationid: string;
  /** The schools whose learners may be covered. */
  schoolids: string[];
  /** The curricula in play, when narrower than everything the organisation owns (a school's own list). */
  curriculumids?: string[];
  /** Only this login's own rows (a learner token). */
  schooluserid?: string;
}

/** The header central sends with the organisation it is acting for (lower case: that is how Node exposes it). */
export const ORGANISATION_HEADER = "x-organisation-id";

/** The header value that asks for the platform's unscoped view (case-sensitive). */
export const PLATFORM_MARKER = "platform";

/** The user central's server sync key stands for. */
export const SERVER_USER_ID = "server";

const ORGANISATION_ID = /^[0-9a-f-]{8,36}$/i;

const refused = (): ApiError =>
  new ApiError(ErrorCode.INVALID_INPUT, { message: "The organisation header is missing or not valid.", fields: [{ field: ORGANISATION_HEADER, message: "An organisation id, or platform, is required." }] });

/** All the schools an organisation has here (a soft-deleted school's learners still belong to it). */
export async function schoolIdsOfOrganisation(organisationid: string): Promise<string[]> {
  const organisation = await organisations.findOne({
    attributes: ["organisationid", "organisationstatus", "isdeleted"],
    where: { organisationid },
  });
  if (!organisation || organisation.isdeleted || !organisation.organisationstatus) {
    return [];
  }
  const rows = await schools.scope("withOwnership").findAll({ attributes: ["schoolid"], where: { organisationid }, raw: true });
  return rows.map((r) => String((r as unknown as { schoolid: string }).schoolid));
}

/** The scope of a request, or `null` for the unscoped platform view. Throws a 400 for a header that is not valid, a 401 for a user token with no claims. */
export async function resolveReportScope(request: { headers: Record<string, unknown>; user?: Token }): Promise<ReportScope | null> {
  const user = request.user;
  if (user?.schooluserid === SERVER_USER_ID) {
    const header = request.headers[ORGANISATION_HEADER];
    if (header === PLATFORM_MARKER) {
      return null; // central acting for a platform user who is not acting as an organisation
    }
    if (typeof header !== "string" || !ORGANISATION_ID.test(header.trim())) {
      throw refused(); // absent, blank, another case of the marker, or not an identifier
    }
    const organisationid = header.trim();
    return { organisationid, schoolids: await schoolIdsOfOrganisation(organisationid) };
  }
  const claims = claimsOf(user);
  if (!user || !claims) {
    throw new ApiError(ErrorCode.SIGN_IN_REQUIRED);
  }
  if (callerKindOf(user) === "learner") {
    return { organisationid: claims.organisationid, schoolids: [claims.schoolid], curriculumids: [], schooluserid: user.schooluserid ?? "" };
  }
  return {
    organisationid: claims.organisationid,
    schoolids: [claims.schoolid],
    curriculumids: await schoolCurriculumList(claims.organisationid, claims.schoolid),
  };
}

/** The extra condition on `students` that keeps a query inside the scope (nothing when unscoped). */
export const learnersInScope = (scope: ReportScope | null | undefined): WhereOptions =>
  scope
    ? {
        schoolid: { [Op.in]: scope.schoolids },
        ...(scope.schooluserid !== undefined ? { schooluserid: scope.schooluserid } : {}),
      }
    : {};

const FILTER_KINDS: Record<string, ContentKind> = {
  curriculumid: "curriculum",
  gradeid: "grade",
  levelid: "level",
  lessonid: "lesson",
};

/**
 * Do the content ids a report body names (curriculum, grade, level, lesson) all belong to curricula in the
 * scope, and the classes it names to schools in the scope? A report shows the names of the content it is asked about, so one outside the scope must not be asked
 * about. Blank values name nothing (the reports ignore them) and are skipped. Unscoped: always yes.
 */
export async function contentFiltersInScope(scope: ReportScope | null | undefined, filters: IMultiFilter[] | undefined): Promise<boolean> {
  if (!scope) {
    return true;
  }
  for (const filter of Array.isArray(filters) ? filters : []) {
    if (filter && filter.key === "standard" && filter.value) {
      // a class is one of the scope's schools' or it is outside (a class that is not there names nothing, and reveals nothing)
      const named = (Array.isArray(filter.value) ? filter.value : [filter.value]).filter((c) => c !== "" && c !== null && c !== undefined);
      if (named.some((c) => typeof c !== "string")) {
        return false;
      }
      if (named.length > 0) {
        const found = await standards.findAll({ where: { standardid: { [Op.in]: named as string[] } }, attributes: ["standardid", "schoolid"], raw: true });
        const mine = new Set(scope.schoolids.map((id) => id.toLowerCase()));
        if (found.some((c) => !mine.has(String((c as unknown as { schoolid: string }).schoolid).toLowerCase()))) {
          return false;
        }
      }
      continue;
    }
    const kind = filter && typeof filter.key === "string" && Object.prototype.hasOwnProperty.call(FILTER_KINDS, filter.key) ? FILTER_KINDS[filter.key] : undefined;
    if (!kind || !filter.value) {
      continue;
    }
    for (const id of Array.isArray(filter.value) ? filter.value : [filter.value]) {
      if (id === "" || id === null || id === undefined) {
        continue;
      }
      if (typeof id !== "string") {
        return false;
      }
      const own = await curriculumIdsOf(kind, id);
      if (own.length === 0) {
        // names nothing here: it can only come back empty, and it reveals nothing
        continue;
      }
      const inside = new Set((await curriculaInScope({ organisationid: scope.organisationid, curriculumids: scope.curriculumids }, own)).map((x) => x.toLowerCase()));
      if (!own.every((c) => inside.has(c.toLowerCase()))) {
        return false;
      }
    }
  }
  return true;
}
