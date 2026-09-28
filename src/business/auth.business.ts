import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { hashPassword, verifyPassword } from "src/services/password.service";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { students } from "src/models/data-models/students";
import { Logger } from "src/config";
import { SchoolBusiness } from "./school.business";
import { SchoolUserBusiness } from "./schooluser.business";
import { StudentBusiness } from "./student.business";
import { TokenBusiness } from "./token.business";

// Computed once at module load so the "unknown user" branch still pays the
// bcrypt/md5 cost below: skipping it made unknown-user responses land much
// faster than a real account's, which is its own account-existence oracle
// even with an identical response body (docs/api-errors.md, and the 25 Sep
// audit gap: "Login leaks account existence by timing"). Mirrors
// edtech-lms-api's AuthBusiness fix (lms-api#56).
const DUMMY_PASSWORD_HASH = hashPassword("dummy-not-a-real-password");

export class AuthBusiness {
  login = async (email: string, password: string) => {
    const user = await new SchoolUserBusiness().getuserbyname(email);
    if (!user) {
      // Same LOGIN_FAILED message and shape as a wrong password below — the
      // sameness is the fix, never re-differentiate it. The real reason is
      // logged server-side only.
      verifyPassword(password, DUMMY_PASSWORD_HASH);
      Logger.info("Login blocked: unknown user", { username: email });
      throw new ApiError(ErrorCode.LOGIN_FAILED);
    }
    if (
      !verifyPassword(password, user.schooluserpasswordhash) ||
      user.isdisabled ||
      user.isdeleted ||
      !user.schooluserstatus
    ) {
      Logger.info("Login blocked: wrong password or disabled account", { username: email });
      throw new ApiError(ErrorCode.LOGIN_FAILED);
    }

    const schooluser = await new StudentBusiness().getstudentbyschooluserid(
      user.schooluserid
    );
    const schoolTheme = await new SchoolBusiness().getTheme(user.schoolname);
    if (schooluser) {
      // const studenttype = Config.fortyk.api.rpi.offline ? 'offline' : 'online';
      // Only reached after a correct password, so this can safely say more
      // than LOGIN_FAILED without leaking account existence to a guesser.
      if(!schooluser.isactive) throw new ApiError(ErrorCode.NOT_ALLOWED, { message: "This account has been removed." });
      // if(schooluser.type !== 'all' && schooluser.type !== studenttype) throw new BadRequestException("User/Password not matching");
      schooluser.schooluser = user;
      // The students row's schoolname can be null (demo seed, and any student
      // imported without it) — fall back to the schoolusers row's schoolname
      // so the JWT claim (and the app's start-time branding refresh keyed off
      // it) isn't silently empty. Same claim name/type, just a better source.
      schooluser.schoolname = this.normalizeSchoolname(schooluser.schoolname) ?? user.schoolname;
      schooluser.setDataValue('schoolTheme', schoolTheme);
      return schooluser;
    } else {
      const tempst = new students();
      tempst.schooluser = user;
      tempst.schooluserid = user.schooluserid;
      // No students row exists yet, so this already sources from schoolusers.
      tempst.schoolname = this.normalizeSchoolname(user.schoolname) ?? user.schoolname;
      tempst.setDataValue('schoolTheme', schoolTheme);
      return tempst;
    }
  };

  // null/undefined/empty-string all count as "not set".
  private normalizeSchoolname = (schoolname?: string | null): string | undefined =>
    schoolname && schoolname.trim().length > 0 ? schoolname : undefined;

  logout = async (lmsuserid: string, logouttime?: number, timespent: number = 0) => {
    const tb = new TokenBusiness();
    await rpiuseraccess.update(
      { logouttime: logouttime ? new Date(new Date(logouttime).toUTCString()) : new Date(new Date().toUTCString()), status: 2, timespent: timespent },
      { where: { userid: lmsuserid, status: 1 }}
    )
    await tb.clearAccessToken(lmsuserid);
  };
}
