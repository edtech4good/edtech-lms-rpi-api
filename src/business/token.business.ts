/* eslint-disable @typescript-eslint/no-explicit-any */
import { addMinutes } from "date-fns";
import { sign, verify } from "jsonwebtoken";
import { Token } from "src/models/token.model";
import { LoginTokens } from "src/modules/auth";
import { v4 as uuidv4 } from "uuid";
import { Config } from "../config";
import {
  students,
  studentsAttributes,
  tokens,
} from "../models/data-models/init-models";
import { TokenType } from "../models/enums";

export class TokenBusiness {
  generateToken = (
    userId: string,
    exptime: number,
    payload: any,
    secret: string,
    claims: string,
    jti: string
  ) => {
    const newexpiery = addMinutes(new Date(), exptime);

    const localpayload = {
      sub: userId,
      iat: new Date().getTime() / 1000,
      jti,
      exp: new Date(newexpiery).getTime() / 1000,
      ...JSON.parse(JSON.stringify(payload)),
      claims,
    };
    return sign(localpayload, secret);
  };

  saveToken = async (
    token: string,
    lmsuserid: string,
    tokentype: TokenType
  ) => {
    await tokens.destroy({
      where: {
        lmsuserid,
        tokentype,
      },
    });
    const data: any = {
      token,
      lmsuserid,
      tokentype,
    };
    return tokens.create(data);
  };

  deleteToken = (lmsuserid: string, tokentype: TokenType) => {
    return tokens.destroy({
      where: {
        lmsuserid,
        tokentype,
      },
    });
  };
  tokenExists = async (token: string) => {
    const count = await tokens.count({
      where: {
        token,
      },
    });
    return count > 0;
  };

  verifyToken = (token: string): Promise<any> =>
    new Promise((resolve) => {
      verify(
        token,
        Config.fortyk.api.rpi.applicationsecret,
        async (err, decoded: any) => {
          if (err) {
            resolve(false);
          } else {
            const tokenDoc = await tokens.findOne({
              where: { token: decoded.jti },
            });
            if (!tokenDoc) {
              resolve(false);
            }
            resolve(tokenDoc);
          }
        }
      );
    });

  verifyTokenBody = (token: string): Promise<any> =>
    new Promise((resolve) => {
      verify(
        token,
        Config.fortyk.api.rpi.applicationsecret,
        async (err, decoded: any) => {
          if (err) {
            resolve(false);
          } else {
            const tokenDoc = await tokens.findOne({
              where: { token: decoded.jti },
            });
            if (!tokenDoc) {
              resolve(false);
            }
            resolve(decoded);
          }
        }
      );
    });

  clearAccessToken = (userid: string) =>
    this.deleteToken(userid, TokenType.ACCESS);

  generateAuthToken = async (
    user: students,
    baselineid: string | undefined | null = null,
    baselinepassed: boolean = false
  ): Promise<LoginTokens> => {
    const userpayload = <Token>{
      studentfirstname: user.studentfirstname,
      studentlastname: user.studentlastname,
      studentid: user.studentid,
      schooluserid: user.schooluserid,
      city: user.city,
      contact: user.contact,
      country: user.country,
      dateofbirth: (user.dateofbirth) ? (user.dateofbirth).toLocaleDateString('en-ZA') : null,
      curriculumid: user.curriculumid,
      curriculumids: user.curriculumids,
      dateofjoin: (user.dateofjoin) ? (user.dateofjoin).toLocaleDateString('en-ZA') : null,
      fathername: user.fathername,
      genderid: user.genderid,
      mothername: user.mothername,
      schoolname: user.schoolname,
      schooltype: user.schooltype,
      standard: user.standard,
      state: user.state,
      startinglevelid: user.startinglevelid,
      studentcurrentlessonid: user.studentcurrentlessonid,
      studentcurrentlevelid: user.studentcurrentlevelid,
      schoolusername: user.schooluser.schoolusername,
      schooluserrole: user.schooluser.schooluserrole,
      baselineid,
      baselinepassed,
      profileimage: user.profileimage,
      familyname: user.familyname,
      is_teacher_acc: user.is_teacher_acc ?? false
    };
    const accessid = uuidv4();
    const accessToken = this.generateToken(
      user.schooluserid,
      Config.fortyk.api.rpi.accessexpirationminutes,
      userpayload,
      Config.fortyk.api.rpi.applicationsecret,
      TokenType.ACCESS,
      accessid
    );
    await this.clearAccessToken(user.schooluserid);
    await this.saveToken(accessid, user.schooluserid, TokenType.ACCESS);
    return {
      accessToken,
    };
  };

  generateMiscToken = async (
    user: studentsAttributes,
    expiry: number,
    tokentype: TokenType,
    claim: string
  ) => {
    const misctokenid = uuidv4();
    const miscToken = this.generateToken(
      user.schooluserid,
      expiry,
      {},
      Config.fortyk.api.rpi.applicationsecret,
      claim,
      misctokenid
    );
    await this.saveToken(misctokenid, user.schooluserid, tokentype);
    return miscToken;
  };
}
