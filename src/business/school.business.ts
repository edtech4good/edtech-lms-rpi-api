import { schools } from "src/models/data-models/school";

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

  /** Powers the student-login JWT claims. Same fallback shape as getBranding,
   * plus the schoolid so the app can key cached branding per school. */
  getTheme = async (
    schoolname?: string
  ): Promise<{ uitheme: string; schoolid: string | null }> => {
    const school = await this.getSchoolByName(schoolname);
    return {
      uitheme: school?.uitheme ?? "kids",
      schoolid: school?.schoolid ?? null,
    };
  };
}
