import { schoolusers } from "src/models/data-models/schoolusers";
import { schools } from "src/models/data-models/school";
import { students } from "src/models/data-models/students";
import * as passwordService from "src/services/password.service";
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { AuthBusiness } from "./auth.business";

/**
 * Guards the login half of the 25 Sep 2026 error contract
 * (docs/api-errors.md): AuthBusiness.login must give the exact same
 * ApiError (code, status, message) for an unknown user and for a wrong
 * password, and must not skip the password-verify step for an unknown
 * user — skipping it is what let a response's TIMING (not its body) reveal
 * whether an account exists (25 Sep audit gap #2).
 */
describe("AuthBusiness.login (equal-time, equal-message)", () => {
  let findUserSpy: jest.SpyInstance;
  let verifySpy: jest.SpyInstance;

  beforeEach(() => {
    findUserSpy = jest.spyOn(schoolusers, "findOne");
    verifySpy = jest.spyOn(passwordService, "verifyPassword");
    // getTheme() -> getSchoolByName() -> schools.findOne — never a real DB
    // call in a unit test, and not the point of any test in this file.
    jest.spyOn(schools, "findOne").mockResolvedValue(null as any);
  });

  afterEach(() => {
    findUserSpy.mockRestore();
    verifySpy.mockRestore();
  });

  const expectLoginFailed = async (promise: Promise<unknown>) => {
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.LOGIN_FAILED,
      status: 400,
      message: "The username or password is incorrect.",
    });
  };

  it("rejects an unknown user with LOGIN_FAILED, and still calls verifyPassword (against a dummy hash)", async () => {
    findUserSpy.mockResolvedValue(null);

    await expectLoginFailed(new AuthBusiness().login("nobody@example.com", "whatever"));

    // The whole point of the dummy-hash call: an unknown-user response
    // must pay the same bcrypt cost as a real one, or its timing alone
    // tells an attacker the account doesn't exist even though the body is
    // identical to a wrong-password response.
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const [, storedHash] = verifySpy.mock.calls[0];
    expect(storedHash).not.toBe(""); // a real (dummy) hash was compared against, not skipped
  });

  it("rejects a wrong password with the exact same code/status/message as an unknown user", async () => {
    findUserSpy.mockResolvedValue({
      schooluserid: "u1",
      schoolusername: "real@example.com",
      schooluserpasswordhash: passwordService.hashPassword("correct-password"),
      isdisabled: false,
      isdeleted: false,
      schooluserstatus: true,
      schoolname: "Demo School",
    } as any);

    await expectLoginFailed(new AuthBusiness().login("real@example.com", "wrong-password"));
  });

  it("rejects a disabled account the same way, without saying it's disabled (still not enumerable, since a wrong password looks identical)", async () => {
    findUserSpy.mockResolvedValue({
      schooluserid: "u1",
      schoolusername: "real@example.com",
      schooluserpasswordhash: passwordService.hashPassword("correct-password"),
      isdisabled: true,
      isdeleted: false,
      schooluserstatus: true,
      schoolname: "Demo School",
    } as any);

    await expectLoginFailed(new AuthBusiness().login("real@example.com", "correct-password"));
  });

  it("rejects a removed student with NOT_ALLOWED (only reachable after a correct password, so this is safe to say)", async () => {
    findUserSpy.mockResolvedValue({
      schooluserid: "u1",
      schoolusername: "real@example.com",
      schooluserpasswordhash: passwordService.hashPassword("correct-password"),
      isdisabled: false,
      isdeleted: false,
      schooluserstatus: true,
      schoolname: "Demo School",
    } as any);
    jest.spyOn(students, "findOne").mockResolvedValue({
      isactive: false,
      setDataValue: jest.fn(),
    } as any);

    const promise = new AuthBusiness().login("real@example.com", "correct-password");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.NOT_ALLOWED,
      status: 403,
    });
  });
});
