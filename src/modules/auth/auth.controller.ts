import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Request,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import { RealIP } from "nestjs-real-ip";
import { UserAccessBusiness } from "src/business/useraccess.business";
import { Logger } from "src/config";
import { LOGTYPE } from "src/models/enums/logaccess.enum";
import { AuthBusiness } from "../../business/auth.business";
import { TokenBusiness } from "../../business/token.business";
import { SchemaValidationInterceptor } from "../../interceptors/schemavalidation.interceptor";
import { IRequest } from "../../models/IRequest";
import { replacecaseInsensitive } from "./../../services/util.service";
import { login } from "./auth.request.validator";
import { LoginRequestBody, LogoutRequestBody } from "./models/LoginRequestBody";
import { LoginResponseModel, LoginTokens } from "./models/LoginResponse";
import { LogoutResponse } from "./models/LogoutResponse";
@ApiExtraModels(LoginTokens)
@ApiExtraModels(LoginResponseModel)
@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  @Post("login")
  @ApiExtraModels(LoginTokens)
  @ApiExtraModels(LoginResponseModel)
  @ApiResponse({
    status: 200,
    schema: { $ref: getSchemaPath(LoginResponseModel) },
  })
  @ApiResponse({
    status: 400,
    description: "Error while login",
  })
  @ApiResponse({
    status: 404,
    description: "Not found",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @UseInterceptors(new SchemaValidationInterceptor(login))
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginRequestBody,
    @RealIP() ip: string
  ): Promise<LoginResponseModel> {
    const userloggedinfo = await new AuthBusiness().login(
      body.studentusername,
      body.studentpassword
    );

    await new UserAccessBusiness().createuseraccesslog(
      userloggedinfo.schooluserid,
      ip,
      body.logintime ? parseInt(body.logintime) : (new Date(new Date().toUTCString())).getTime()
    );
    Logger.info(`<${userloggedinfo.studentfirstname}> logged-in successfully`, {logaccesstype: LOGTYPE.LOGIN, userid: userloggedinfo.schooluserid});
    return {
      data: await new TokenBusiness().generateAuthToken(
        userloggedinfo,
        null,
        false,
        userloggedinfo.getDataValue('schoolTheme')
      ),
      error: false,
    };
  }
  @Post("logout")
  @ApiResponse({
    status: 200,
    description: "user logged successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Error while logout",
  })
  @ApiResponse({
    status: 404,
    description: "Not found",
  })
  @ApiResponse({
    status: 500,
    description: "Server error",
  })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  //@UseGuards(AccessGuard(TokenType.ACCESS))
  async logout(
    @Request() request: IRequest,
    @Headers("Authorization") auth?: string,
    @Body() logouttime?: LogoutRequestBody,
  ): Promise<LogoutResponse> {
    if ((auth || "").trim().length > 0) {
      const authtoken = replacecaseInsensitive(auth || "", "bearer").trim();
      const _body = await new TokenBusiness().verifyTokenBody(authtoken || "");
      if (_body) {
        await new AuthBusiness().logout(_body.sub, logouttime?.logouttime, logouttime?.timespent);
        Logger.info(`<${_body.studentfirstname}> logged-out successfully`, {logaccesstype: LOGTYPE.LOGOUT, userid: _body.sub});
        return {
          data: true,
          error: false,
        };
      }
    }
    return {
      data: false,
      error: true,
    };
  }
}
