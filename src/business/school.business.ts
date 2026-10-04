import { DatabaseError } from "sequelize";
import { ApiError } from "src/models/ApiError";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { resolveSchoolRef } from "./school-identity";

export class SchoolBusiness {
  getSchoolByName = (schoolname?: unknown) => {
    // Express's extended query parser turns `?schoolname[gt]=a` into an
    // object and repeated `?schoolname=a&schoolname=b` into an array —
    // either would reach Sequelize's `where` as a non-string and throw.
    // Treat anything but a real, non-empty string as "no school given".
    if (typeof schoolname !== "string" || schoolname.length === 0) {
      return Promise.resolve(null);
    }
    return schools.findOne({ where: { schoolname } });
  };

  /** Powers the unguarded `GET /school/branding` route. Always resolves — an
   * absent/unknown school falls back to the kids theme rather than erroring,
   * so the app can render before it knows anything about the school.
   *
   * The school is named by its name (as ever) or by its id; a name is resolved to
   * an id once and the school is read by that id. A name that matches more than
   * one school gives the default theme, like an unknown one (names are unique
   * today, so this is not reachable).
   *
   * Two levels, then the default: each of the two settings (`uitheme`,
   * `brandingconfig`) is the SCHOOL's when it has one, else its ORGANISATION's
   * (when the organisation is active), else the default (`kids`, no config). A school
   * has none of its own when the value is null (a blank theme counts as none). */
  getBranding = async (
    schoolname?: unknown,
    schoolid?: unknown
  ): Promise<{ uitheme: string; brandingconfig: object | null }> => {
    let school: schools | null = null;
    let organisation: organisations | null = null;
    try {
      const id = await resolveSchoolRef({ schoolid, schoolname });
      if (id) {
        try {
          school = await schools.scope("withOwnership").findOne({ where: { schoolid: id } });
        } catch (e) {
          if (!isUnknownColumn(e)) {
            throw e;
          }
          school = await schools.findOne({ where: { schoolid: id } });
        }
      }
      if (school?.organisationid) {
        const owner = await organisations.findOne({ where: { organisationid: school.organisationid } });
        organisation = owner && !owner.isdeleted && owner.organisationstatus ? owner : null;
      }
    } catch (e) {
      if (!(e instanceof ApiError)) {
        throw e;
      }
    }
    const given = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
    return {
      uitheme: given(school?.uitheme) ? school!.uitheme : given(organisation?.uitheme) ? organisation!.uitheme : "kids",
      brandingconfig: school?.brandingconfig ?? organisation?.brandingconfig ?? null,
    };
  };

  /**
   * The school id stored on a login's rows, for the claim lookup's fallback: the
   * school-login row first, then the learner row (central's order). NULL while
   * neither is filled.
   *
   * On a database the organisations migration has not reached the column does not
   * exist: the read answers MySQL error 1054 and this returns NULL, so a login
   * still works exactly as it did before the column (see `isUnknownColumn`).
   */
  getLinkedSchoolId = async (schooluserid: string): Promise<string | null> => {
    try {
      const login = await schoolusers
        .scope("withOwnership")
        .findOne({ where: { schooluserid }, attributes: ["schoolid"] });
      if (login?.schoolid) {
        return login.schoolid;
      }
      const learner = await students
        .scope("withOwnership")
        .findOne({ where: { schooluserid }, attributes: ["schoolid"] });
      return learner?.schoolid ?? null;
    } catch (e) {
      if (isUnknownColumn(e)) {
        return null;
      }
      throw e;
    }
  };

  /** Powers the login JWT claims (learner and teacher alike). Same fallback
   * shape as getBranding, plus the schoolid so the app can key cached branding
   * per school, plus the school's organisation.
   *
   * The school is found BY NAME first, exactly as before the ids existed: a
   * roster import updates a row's `schoolname` but not its `schoolid`, so a
   * stored id can be stale (a learner who moved school), and the claims must not
   * change for them. Only when the name finds no school is the stored id used
   * (`resolveSchoolId` is called then, and only then). A school with no
   * organisation, or no school at all, gives null, never an error: nothing is
   * refused on these claims yet.
   *
   * On a database without the organisations migration the school read answers
   * MySQL error 1054 (it selects `organisationid`); the lookup then falls back to
   * the plain by-name read, with `organisationid: null`, so login keeps working. */
  getTheme = async (
    schoolname?: string,
    resolveSchoolId?: () => Promise<string | null>
  ): Promise<{ uitheme: string; schoolid: string | null; organisationid: string | null; isdeleted: boolean }> => {
    let school: schools | null = null;
    let organisationColumn = true;
    try {
      const withOwnership = schools.scope("withOwnership");
      if (typeof schoolname === "string" && schoolname.length > 0) {
        school = await withOwnership.findOne({ where: { schoolname } });
      }
      if (!school && resolveSchoolId) {
        const schoolid = await resolveSchoolId();
        school = schoolid ? await withOwnership.findOne({ where: { schoolid } }) : null;
      }
    } catch (e) {
      if (!isUnknownColumn(e)) {
        throw e;
      }
      organisationColumn = false;
      school = await this.getSchoolByName(schoolname);
    }
    return {
      uitheme: school?.uitheme ?? "kids",
      schoolid: school?.schoolid ?? null,
      organisationid: organisationColumn ? school?.organisationid ?? null : null,
      // sign-in refuses a school that is deleted (assertCanSignIn); the token does not carry this
      isdeleted: Boolean(school?.isdeleted),
    };
  };
}

/**
 * MySQL "unknown column" (errno 1054, ER_BAD_FIELD_ERROR): what a read of a
 * column the migrations have not added yet answers. Login treats it as "no
 * ownership data here yet" rather than failing every sign-in.
 */
export const isUnknownColumn = (e: unknown): boolean => {
  const err = e as { original?: { errno?: number; code?: string }; parent?: { errno?: number; code?: string }; errno?: number };
  const cause = err?.original ?? err?.parent;
  return e instanceof DatabaseError && (cause?.errno === 1054 || cause?.code === "ER_BAD_FIELD_ERROR");
};
