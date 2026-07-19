import { BadRequestException } from "@nestjs/common";
import { verifyPassword } from "src/services/password.service";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { students } from "src/models/data-models/students";
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
    if (schooluser) {
      // const studenttype = Config.fortyk.api.rpi.offline ? 'offline' : 'online';
      if(!schooluser.isactive) throw new BadRequestException("Student is removed!");
      // if(schooluser.type !== 'all' && schooluser.type !== studenttype) throw new BadRequestException("User/Password not matching");
      schooluser.schooluser = user;
      return schooluser;
    } else {
      const tempst = new students();
      tempst.schooluser = user;
      tempst.schooluserid = user.schooluserid;
      tempst.schoolname = user.schoolname
      return tempst;
    }
  };

  logout = async (lmsuserid: string, logouttime?: number, timespent: number = 0) => {
    const tb = new TokenBusiness();
    await rpiuseraccess.update(
      { logouttime: logouttime ? new Date(new Date(logouttime).toUTCString()) : new Date(new Date().toUTCString()), status: 2, timespent: timespent },
      { where: { userid: lmsuserid, status: 1 }}
    )
    await tb.clearAccessToken(lmsuserid);
  };
}
