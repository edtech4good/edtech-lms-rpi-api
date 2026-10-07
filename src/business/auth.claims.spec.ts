import { decode } from "jsonwebtoken";
import { DatabaseError, Sequelize } from "sequelize";
import { SchoolBusiness } from "./school.business";
import { initModels } from "src/models/data-models/init-models";
import { Config } from "src/config";
import { organisations } from "src/models/data-models/organisations";
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
 * and (package 8) who is refused at sign-in: a login whose school or organisation
 * cannot be resolved, or whose organisation is suspended or deleted, gets a 401 with
 * one neutral message. That includes a school here that has no organisation: there
 * is no exception for a classroom Pi (`RPI_OFFLINE`), which refuses it as online does.
 *
 * The models are stubbed, so this proves the lookups and the claim values, not
 * the SQL; `ownership-scope.spec.ts` proves the SQL reads the new columns only
 * when asked to.
 */

const SCHOOL_X = { schoolid: "5c000000-0000-4000-8000-0000000000a1", schoolname: "School X", uitheme: "corporate", organisationid: "0a000000-0000-4000-8000-00000000000a" };
const SCHOOL_Y = { schoolid: "5c000000-0000-4000-8000-0000000000b2", schoolname: "School Y", uitheme: "kids", organisationid: "0b000000-0000-4000-8000-00000000000b" };
const SCHOOL_X_DELETED = { ...SCHOOL_X, isdeleted: true };
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
  /** Organisations that exist but are suspended / deleted (any other organisation id is active). */
  suspended?: string[];
  deleted?: string[];
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
  jest.spyOn(organisations, "findOne").mockImplementation((async (opts: { where: { organisationid: string } }) => {
    const id = opts.where.organisationid;
    return {
      organisationid: id,
      organisationstatus: !(s.suspended ?? []).includes(id),
      isdeleted: (s.deleted ?? []).includes(id),
    };
  }) as never);
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

const originalOffline = Config.fortyk.api.rpi.offline;
afterEach(() => {
  Config.fortyk.api.rpi.offline = originalOffline;
  jest.restoreAllMocks();
});

const REFUSED = { code: "SIGN_IN_REQUIRED", status: 401, message: "This account can't sign in right now." };

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

  it("when the name finds no school and the stored id matches none either, the login cannot sign in (401), online or on a Pi", async () => {
    stub({ studentSchoolId: "5c000000-0000-4000-8000-00000000dead", user: { schoolname: "Nowhere" }, schools: [SCHOOL_Y] });
    for (const offline of [false, true]) {
      Config.fortyk.api.rpi.offline = offline;
      await expect(signIn()).rejects.toMatchObject(REFUSED);
    }
  });

  it("a teacher (no learner row) gets the same claims from the school-login row", async () => {
    stub({ student: null, user: { schooluserrole: SchoolRole.TEACHER, schoolname: "School X" }, userSchoolId: SCHOOL_X.schoolid, schools: [SCHOOL_X] });
    const claims = await signIn();
    expect(claims.schoolid).toBe(SCHOOL_X.schoolid);
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
    expect(claims.schooluserrole).toBe(SchoolRole.TEACHER);
  });

  it("a login whose school has no organisation cannot sign in, online or on a classroom Pi (401, one neutral message)", async () => {
    for (const offline of [false, true]) {
      stub({ user: { schoolname: "School Z" }, schools: [SCHOOL_NO_ORG] });
      Config.fortyk.api.rpi.offline = offline;
      const refusal = await signIn().catch((e) => e);
      expect({ code: refusal.code, status: refusal.status, message: refusal.message }).toEqual(REFUSED);
      jest.restoreAllMocks();
    }
  });

  it("a school with no organisation, reached through the stored id, cannot sign in either, online or on a Pi", async () => {
    for (const offline of [false, true]) {
      stub({ userSchoolId: SCHOOL_NO_ORG.schoolid, user: { schoolname: "Nowhere" }, schools: [SCHOOL_NO_ORG] });
      Config.fortyk.api.rpi.offline = offline;
      await expect(signIn()).rejects.toMatchObject(REFUSED);
      jest.restoreAllMocks();
    }
  });

  it("a login with no resolvable school at all cannot sign in, online or on a Pi ", async () => {
    stub({ studentSchoolId: null, userSchoolId: null, user: { schoolname: "Nowhere" }, schools: [SCHOOL_X] });
    for (const offline of [false, true]) {
      Config.fortyk.api.rpi.offline = offline;
      await expect(signIn()).rejects.toMatchObject(REFUSED);
    }
  });

  it("a teacher with no learner row and no school cannot sign in", async () => {
    stub({ student: null, user: { schooluserrole: SchoolRole.TEACHER, schoolname: "" }, schools: [] });
    await expect(signIn()).rejects.toMatchObject(REFUSED);
  });

  it("a login whose organisation is suspended, or deleted, cannot sign in, online or on a Pi, and the message does not say which", async () => {
    const cases: Array<[string, Partial<Stubs>]> = [
      ["suspended", { suspended: [SCHOOL_X.organisationid] }],
      ["deleted", { deleted: [SCHOOL_X.organisationid] }],
    ];
    for (const [name, extra] of cases) {
      stub({ user: { schoolname: "School X" }, schools: [SCHOOL_X], ...extra });
      for (const offline of [false, true]) {
        Config.fortyk.api.rpi.offline = offline;
        const refusal = await signIn().catch((e) => e);
        expect({ name, code: refusal.code, status: refusal.status, message: refusal.message }).toEqual({ name, ...REFUSED });
      }
      jest.restoreAllMocks();
    }
  });

  it("a login whose school is deleted cannot sign in, online or on a Pi, with the answer for a school that is not here; the same school not deleted does sign in", async () => {
    // the reference answer: a login whose school is not here at all
    stub({ studentSchoolId: null, userSchoolId: null, user: { schoolname: "Nowhere" }, schools: [SCHOOL_X] });
    Config.fortyk.api.rpi.offline = false;
    const missing = await signIn().catch((e) => e);
    jest.restoreAllMocks();
    for (const [school, name] of [[SCHOOL_X_DELETED, "School X"]] as const) {
      stub({ user: { schoolname: name }, schools: [school] });
      for (const offline of [false, true]) {
        Config.fortyk.api.rpi.offline = offline;
        const refusal = await signIn().catch((e) => e);
        expect({ code: refusal.code, status: refusal.status, message: refusal.message, hint: refusal.hint }).toEqual({
          code: missing.code, status: missing.status, message: missing.message, hint: missing.hint,
        });
        expect(refusal).toMatchObject(REFUSED);
      }
      jest.restoreAllMocks();
    }
    // the same owned school, not deleted: it signs in, so the refusal above is the deletion
    for (const offline of [false, true]) {
      stub({ user: { schoolname: "School X" }, schools: [SCHOOL_X] });
      Config.fortyk.api.rpi.offline = offline;
      expect((await signIn()).schoolid).toBe(SCHOOL_X.schoolid);
      jest.restoreAllMocks();
    }
  });

  it("a login of an active organisation's school signs in on a Pi too", async () => {
    stub({ user: { schoolname: "School X" }, schools: [SCHOOL_X] });
    Config.fortyk.api.rpi.offline = true;
    const claims = await signIn();
    expect(claims.organisationid).toBe(SCHOOL_X.organisationid);
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
      isdeleted: false,
    });
    expect(plain).toHaveBeenCalledWith({ where: { schoolname: "School X" } });
  });

  it("getTheme: any other database error is still raised", async () => {
    jest.spyOn(schools, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(new DatabaseError(Object.assign(new Error("deadlock"), { errno: 1213 }) as never)) } as never);
    await expect(new SchoolBusiness().getTheme("School X")).rejects.toThrow("deadlock");
  });

  it("a whole login on such a database (no organisation to read) is refused, online and on a classroom Pi", async () => {
    stub({ user: { schoolname: "School X" }, schools: [SCHOOL_X] });
    jest.spyOn(schools, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(unknownColumn()) } as never);
    jest.spyOn(schoolusers, "scope").mockReturnValue({ findOne: jest.fn().mockRejectedValue(unknownColumn()) } as never);
    jest.spyOn(schools, "findOne").mockResolvedValue({ schoolid: SCHOOL_X.schoolid, uitheme: "corporate" } as never);
    for (const offline of [true, false]) {
      Config.fortyk.api.rpi.offline = offline;
      await expect(signIn()).rejects.toMatchObject(REFUSED);
    }
  });
});
