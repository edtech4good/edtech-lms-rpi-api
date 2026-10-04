import { decode } from "jsonwebtoken";
import { DatabaseError, Sequelize } from "sequelize";
import { SchoolBusiness } from "./school.business";
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
  it("resolves the school by NAME, as before ids existed, and takes organisationid from it", async () => {
    stub({ user: { schoolname: "School X" }, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
    expect(claims.uitheme).toBe("corporate");
  });

  it("the name wins over a stored id: a stale id (the learner moved school; the roster import updates the name, not the id) does not change the claims", async () => {
    // The learner row and the login row still point at the OLD school X; the name says Y.
    stub({ studentSchoolId: SCHOOL_X.schoolid, userSchoolId: SCHOOL_X.schoolid, user: { schoolname: "School Y" }, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_Y.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_Y.organisationid);
    expect(claims.uitheme).toBe("kids");
    // the stored id was never even needed
    expect(schoolFindOne.mock.calls.every((c) => c[0].where.schoolid === undefined)).toBe(true);
  });

  it("when the name finds no school, falls back to the stored id: the school-login row's first", async () => {
    stub({ studentSchoolId: SCHOOL_Y.schoolid, userSchoolId: SCHOOL_X.schoolid, user: { schoolname: "Renamed Nowhere" }, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
  });

  it("when the name finds no school and the login row has no id, falls back to the learner row's", async () => {
    stub({ studentSchoolId: SCHOOL_Y.schoolid, userSchoolId: null, user: { schoolname: "Renamed Nowhere" }, schools: [SCHOOL_X, SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_Y.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_Y.organisationid);
  });

  it("when the name finds no school and the stored id matches none either, both claims are null and it still signs in", async () => {
    stub({ studentSchoolId: "5c000000-0000-4000-8000-00000000dead", user: { schoolname: "Nowhere" }, schools: [SCHOOL_Y] });
    const claims = await signIn();
    expect(claims.schoolid).toBeNull();
    expect(claims.organisationid).toBeNull();
  });

  it("a teacher (no learner row) gets the same claims from the school-login row", async () => {
    stub({ student: null, user: { schooluserrole: SchoolRole.TEACHER, schoolname: "School X" }, userSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
    expect(claims.schooluserrole).toBe(SchoolRole.TEACHER);
  });

  it("a login whose school has no organisation still signs in, with organisationid null", async () => {
    stub({ user: { schoolname: "School Z" }, schools: [SCHOOL_NO_ORG] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_NO_ORG.schoolid);
    expect(claims.organisationid).toBeNull();
    expect(claims.sub).toBe("u1");
  });

  it("a school with no organisation, reached through the stored id, also signs in with organisationid null", async () => {
    stub({ userSchoolId: SCHOOL_NO_ORG.schoolid, user: { schoolname: "Nowhere" }, schools: [SCHOOL_NO_ORG] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_NO_ORG.schoolid);
    expect(claims.organisationid).toBeNull();
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

  it("a removed learner is still refused with NOT_ALLOWED, before any school or organisation lookup", async () => {
    stub({ student: { isactive: false }, studentSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X] });
    await expect(new AuthBusiness().login("someone", "pw")).rejects.toMatchObject({ code: "NOT_ALLOWED", status: 403 });
    expect(schoolFindOne).not.toHaveBeenCalled();
  });

  it("changes no other claim: the token still carries everything it did before", async () => {
    stub({ studentSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X] });
    const claims = await signIn();
    for (const key of ["sub", "jti", "iat", "exp", "claims", "studentid", "studentfirstname", "schooluserid", "schoolusername", "schooluserrole", "schoolname", "uitheme", "schoolid", "baselinepassed", "is_teacher_acc"]) {
      expect(claims).toHaveProperty(key);
    }
  });
});

describe("a database the organisations migration has not reached (MySQL 1054 on the new columns)", () => {
  const unknownColumn = () =>
    new DatabaseError(Object.assign(new Error("Unknown column 'organisationid' in 'field list'"), { errno: 1054, code: "ER_BAD_FIELD_ERROR" }) as never);

  it("getLinkedSchoolId: answers null instead of failing", async () => {
    jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(unknownColumn()) } as never);
    await expect(new SchoolBusiness().getLinkedSchoolId("u1")).resolves.toBeNull();
  });

  it("getLinkedSchoolId: any other database error is still raised", async () => {
    jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(new DatabaseError(Object.assign(new Error("deadlock"), { errno: 1213 }) as never)) } as never);
    await expect(new SchoolBusiness().getLinkedSchoolId("u1")).rejects.toThrow("deadlock");
  });

  it("getTheme: falls back to the plain by-name read, with organisationid null", async () => {
    jest.spyOn(schools, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(unknownColumn()) } as never);
    const plain = jest.spyOn(schools, "findOne").mockResolvedValue({ schoolid: SCHOOL_X.schoolid, uitheme: "corporate", organisationid: SCHOOL_X.organisationid } as never);
    await expect(new SchoolBusiness().getTheme("School X")).resolves.toEqual({
      uitheme: "corporate",
      schoolid: SCHOOL_X.schoolid,
      organisationid: null,
    });
    expect(plain).toHaveBeenCalledWith({ where: { schoolname: "School X" } });
  });

  it("getTheme: any other database error is still raised", async () => {
    jest.spyOn(schools, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(new DatabaseError(Object.assign(new Error("deadlock"), { errno: 1213 }) as never)) } as never);
    await expect(new SchoolBusiness().getTheme("School X")).rejects.toThrow("deadlock");
  });

  it("a whole login on such a database still signs in, with the claims it had before (schoolid by name, no organisation)", async () => {
    stub({ user: { schoolname: "School X" }, schools: [SCHOOL_X] });
    jest.spyOn(schools, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(unknownColumn()) } as never);
    jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(unknownColumn()) } as never);
    jest.spyOn(schools, "findOne").mockResolvedValue({ schoolid: SCHOOL_X.schoolid, uitheme: "corporate" } as never);
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.uitheme).toBe("corporate");
    expect(claims.organisationid).toBeNull();
  });
});
