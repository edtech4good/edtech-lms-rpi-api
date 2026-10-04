import { decode } from "jsonwebtoken";
import { Sequelize } from "sequelize";
import { initModels } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { tokens } from "src/models/data-models/tokens";
import { SchoolRole } from "src/models/enums/school.role.enum";
import * as passwordService from "src/services/password.service";
import { AuthBusiness } from "./auth.business";
import { TokenBusiness } from "./token.business";

/**
 * Learner and teacher tokens carry the school id and the school's organisation
 * (organisations package, step 5a). Pinned here: where each claim comes from,
 * that a school with no organisation (or no school at all) still signs in, and
 * that nothing is refused on these claims yet.
 *
 * The models are stubbed, so this proves the lookups and the claim values, not
 * the SQL; `ownership-scope.spec.ts` proves the SQL reads the new columns only
 * when asked to.
 */

const SCHOOL_X = { schoolid: "5c000000-0000-4000-8000-0000000000a1", schoolname: "School X", uitheme: "corporate", organisationid: "0a000000-0000-4000-8000-00000000000a" };
const SCHOOL_Y = { schoolid: "5c000000-0000-4000-8000-0000000000b2", schoolname: "School Y", uitheme: "kids", organisationid: "0b000000-0000-4000-8000-00000000000b" };
const SCHOOL_NO_ORG = { schoolid: "5c000000-0000-4000-8000-0000000000c3", schoolname: "School Z", uitheme: "kids", organisationid: null };

type Stubs = {
  /** The school-login row, as the default read returns it. */
  user?: Record<string, unknown>;
  /** The learner row as the default read returns it (undefined: a teacher with no learner row). */
  student?: Record<string, unknown> | null;
  /** What the `withOwnership` reads return for the two link tables. */
  studentSchoolId?: string | null;
  userSchoolId?: string | null;
  /** The schools that exist, by id and by name. */
  schools: Array<{ schoolid: string; schoolname: string; uitheme: string; organisationid: string | null }>;
};

let schoolFindOne: jest.Mock;

const stub = (s: Stubs) => {
  const user = {
    schooluserid: "u1",
    schoolusername: "someone",
    schooluserrole: SchoolRole.STUDENT,
    schooluserpasswordhash: "irrelevant",
    schoolname: "School Y",
    isdisabled: false,
    isdeleted: false,
    schooluserstatus: true,
    ...s.user,
  };
  jest.spyOn(passwordService, "verifyPassword").mockReturnValue(true);
  jest.spyOn(schoolusers, "findOne").mockResolvedValue(user as never);
  jest.spyOn(students, "findOne").mockResolvedValue(
    (s.student === null
      ? null
      : {
          studentid: "st1",
          studentfirstname: "Stu",
          schooluserid: "u1",
          isactive: true,
          schoolname: "School Y",
          setDataValue(k: string, v: unknown) {
            (this as Record<string, unknown>)[k] = v;
          },
          getDataValue(k: string) {
            return (this as Record<string, unknown>)[k];
          },
          ...s.student,
        }) as never,
  );
  jest.spyOn(students, "scope").mockReturnValue({
    findOne: jest.fn().mockResolvedValue(s.studentSchoolId === undefined ? null : { schoolid: s.studentSchoolId }),
  } as never);
  jest.spyOn(schoolusers, "scope").mockReturnValue({
    findOne: jest.fn().mockResolvedValue(s.userSchoolId === undefined ? null : { schoolid: s.userSchoolId }),
  } as never);
  schoolFindOne = jest.fn(async (opts: { where: { schoolid?: string; schoolname?: string } }) => {
    const found = s.schools.find((x) =>
      opts.where.schoolid !== undefined ? x.schoolid === opts.where.schoolid : x.schoolname === opts.where.schoolname,
    );
    return found ?? null;
  });
  jest.spyOn(schools, "scope").mockReturnValue({ findOne: schoolFindOne } as never);
  jest.spyOn(tokens, "destroy").mockResolvedValue(0 as never);
  jest.spyOn(tokens, "create").mockResolvedValue({} as never);
};

const signIn = async () => {
  const learner = await new AuthBusiness().login("someone", "pw");
  const { accessToken } = await new TokenBusiness().generateAuthToken(
    learner as never,
    null,
    false,
    learner.getDataValue("schoolTheme"),
  );
  return decode(accessToken) as Record<string, unknown>;
};

// A teacher has no learner row, so login builds a bare `students` instance, which needs the model initialised.
// No connection is opened: every read below is stubbed.
let sequelize: Sequelize;
beforeAll(() => {
  sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  initModels(sequelize);
});
afterAll(async () => {
  await sequelize.close();
});

afterEach(() => jest.restoreAllMocks());

describe("login token claims: schoolid and organisationid", () => {
  it("takes schoolid from the learner row and organisationid from that school", async () => {
    stub({ studentSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
    expect(claims.uitheme).toBe("corporate");
  });

  it("the id wins over the name: a learner whose row points at X but whose school name says Y is X's", async () => {
    stub({ studentSchoolId: SCHOOL_X.schoolid, user: { schoolname: "School Y" }, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
    // and the name was never needed
    expect(schoolFindOne.mock.calls.every((c) => c[0].where.schoolname === undefined)).toBe(true);
  });

  it("falls back to the school-login row's schoolid when the learner row has none", async () => {
    stub({ studentSchoolId: null, userSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
  });

  it("falls back to the name join while both ids are NULL, and still gets the organisation", async () => {
    stub({ studentSchoolId: null, userSchoolId: null, user: { schoolname: "School Y" }, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_Y.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_Y.organisationid);
    expect(claims.uitheme).toBe("kids");
  });

  it("falls back to the name when the stored id no longer matches any school", async () => {
    stub({ studentSchoolId: "5c000000-0000-4000-8000-00000000dead", user: { schoolname: "School Y" }, schools: [SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_Y.schoolid);
  });

  it("a teacher (no learner row) gets the same claims from the school-login row", async () => {
    stub({ student: null, user: { schooluserrole: SchoolRole.TEACHER, schoolname: "School X" }, userSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
    expect(claims.schooluserrole).toBe(SchoolRole.TEACHER);
  });

  it("a login whose school has no organisation still signs in, with organisationid null", async () => {
    stub({ studentSchoolId: SCHOOL_NO_ORG.schoolid, schools: [SCHOOL_NO_ORG] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_NO_ORG.schoolid);
    expect(claims.organisationid).toBeNull();
    expect(claims.sub).toBe("u1");
  });

  it("a login with no resolvable school at all still signs in: both claims null, theme kids", async () => {
    stub({ studentSchoolId: null, userSchoolId: null, user: { schoolname: "Nowhere" }, schools: [SCHOOL_X] });
    const claims = await signIn();
    expect(claims.schoolid).toBeNull();
    expect(claims.organisationid).toBeNull();
    expect(claims.uitheme).toBe("kids");
    expect(claims.studentid).toBe("st1");
  });

  it("a teacher with no learner row and no school still signs in", async () => {
    stub({ student: null, user: { schooluserrole: SchoolRole.TEACHER, schoolname: "" }, schools: [] });
    const claims = await signIn();
    expect(claims.schoolid).toBeNull();
    expect(claims.organisationid).toBeNull();
  });

  it("changes no other claim: the token still carries everything it did before", async () => {
    stub({ studentSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X] });
    const claims = await signIn();
    for (const key of ["sub", "jti", "iat", "exp", "claims", "studentid", "studentfirstname", "schooluserid", "schoolusername", "schooluserrole", "schoolname", "uitheme", "schoolid", "baselinepassed", "is_teacher_acc"]) {
      expect(claims).toHaveProperty(key);
    }
  });
});
