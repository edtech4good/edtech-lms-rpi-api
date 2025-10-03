import { ExecutionContext, mixin, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Config } from 'src/config';
import { SchoolRole } from 'src/models/enums/school.role.enum';
import { Token } from 'src/models/token.model';
import { TokenType } from './../models/enums/tokentype.enum';
const AccessGuard = (tokentype: TokenType, ...schoolrole: Array<SchoolRole>) =>
  mixin(class LocalAccessGuard extends AuthGuard(`jwt-${tokentype}`) {
    _context?: ExecutionContext;
    canActivate(context: ExecutionContext) {
      this._context = context;
      // Add your custom authentication logic here
      // for example, call super.logIn(request) to establish a session.
      return super.canActivate(context);
    }


    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleRequest(err: any, user: any, _info: any) {
      // You can throw an exception based on either "info" or "err" arguments

      if (err || !user) {
        if (this._context) {
          const ctx = this._context.switchToHttp();
          const request: Request = ctx.getRequest();
          if (request.headers.authorization) {
            if (request.headers.authorization === Config.fortyk.api.serversynckey) {
              return <Token>{
                schooluserid: "server"
              }
            }
          }
          throw err || new UnauthorizedException();
        }
      }
      if (schoolrole) {
        if (schoolrole.length > 0 && !schoolrole.find(x => x == user.schooluserrole)) {
          throw new UnauthorizedException();
        }
      }
      return user;
    }
  });
export { AccessGuard };

