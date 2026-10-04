import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";

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
   * so the app can render before it knows anything about the school. */
  getBranding = async (
    schoolname?: unknown
  ): Promise<{ uitheme: string; brandingconfig: object | null }> => {
    const school = await this.getSchoolByName(schoolname);
    return {
      uitheme: school?.uitheme ?? "kids",
      brandingconfig: school?.brandingconfig ?? null,
    };
  };

  /**
   * The school id a login is tied to, from the id columns on its rows: the
   * learner row first, then the school-login row. NULL while neither is filled
   * (a row not yet backfilled, or a login with no school), in which case the
   * caller falls back to the school's name.
   */
  getLinkedSchoolId = async (schooluserid: string): Promise<string | null> => {
    const learner = await students
      .scope("withOwnership")
      .findOne({ where: { schooluserid }, attributes: ["schoolid"] });
    if (learner?.schoolid) {
      return learner.schoolid;
    }
    const login = await schoolusers
      .scope("withOwnership")
      .findOne({ where: { schooluserid }, attributes: ["schoolid"] });
    return login?.schoolid ?? null;
  };

  /** Powers the login JWT claims (learner and teacher alike). Same fallback
   * shape as getBranding, plus the schoolid so the app can key cached branding
   * per school, plus the school's organisation. The school is found by id when
   * the caller has one, else by name (the join every row used before it had an
   * id). A school with no organisation, or no school at all, gives null, never
   * an error: nothing is refused on these claims yet. */
  getTheme = async (
    schoolname?: string,
    schoolid?: string | null
  ): Promise<{ uitheme: string; schoolid: string | null; organisationid: string | null }> => {
    const withOwnership = schools.scope("withOwnership");
    let school = schoolid ? await withOwnership.findOne({ where: { schoolid } }) : null;
    if (!school && typeof schoolname === "string" && schoolname.length > 0) {
      school = await withOwnership.findOne({ where: { schoolname } });
    }
    return {
      uitheme: school?.uitheme ?? "kids",
      schoolid: school?.schoolid ?? null,
      organisationid: school?.organisationid ?? null,
    };
  };
}
