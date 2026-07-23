import { BadRequestException } from "@nestjs/common";
import { verifyPassword } from "src/services/password.service";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { students } from "src/models/data-models/students";
import { SchoolBusiness } from "./school.business";
import { SchoolUserBusiness } from "./schooluser.business";
import { StudentBusiness } from "./student.business";
import { TokenBusiness } from "./token.business";

export class AuthBusiness {
  login = async (email: string, password: string) => {
    const user = await new SchoolUserBusiness().getuserbyname(email);
    if (!user) {
      throw new BadRequestException("User/Password not matching");
    }
    if (
      !verifyPassword(password, user.schooluserpasswordhash) ||
      user.isdisabled ||
      user.isdeleted ||
      !user.schooluserstatus
    ) {
      throw new BadRequestException("User/Password not matching");
    }

    const schooluser = await new StudentBusiness().getstudentbyschooluserid(
      user.schooluserid
    );
    const schoolTheme = await new SchoolBusiness().getTheme(user.schoolname);
    if (schooluser) {
      // const studenttype = Config.fortyk.api.rpi.offline ? 'offline' : 'online';
      if(!schooluser.isactive) throw new BadRequestException("Student is removed!");
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
