import { ExecutionContext, ForbiddenException, mixin, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Config } from 'src/config';
import { SchoolRole } from 'src/models/enums/school.role.enum';
import { Token } from 'src/models/token.model';
import { TokenType } from './../models/enums/tokentype.enum';
const AccessGuard = (tokentype: TokenType, ...schoolrole: Array<SchoolRole>) =>
  mixin(class LocalAccessGuard extends AuthGuard(`jwt-${tokentype}`) {
    canActivate(context: ExecutionContext) {
      // Add your custom authentication logic here
      // for example, call super.logIn(request) to establish a session.
      return super.canActivate(context);
    }


    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
      // You can throw an exception based on either "info" or "err" arguments

      if (err || !user) {
        // Fail CLOSED: previously this whole branch (including the final
        // throw) lived inside `if (context)`, so a call with no context and
        // no role list fell through to `return user` below with `user`
        // still undefined/null — passport then let the request through
        // unauthenticated. `@nestjs/passport` 8 always passes a context in
        // practice, but the guard must not depend on that to deny access.
        if (context) {
          const ctx = context.switchToHttp();
          const request: Request = ctx.getRequest();
          if (request.headers.authorization) {
            if (request.headers.authorization === Config.fortyk.api.serversynckey) {
              return <Token>{
                schooluserid: "server"
              }
            }
          }
        }
        throw err || new UnauthorizedException();
      }
      if (schoolrole) {
        if (schoolrole.length > 0 && !schoolrole.find(x => x == user.schooluserrole)) {
          throw new ForbiddenException();
        }
      }
      return user;
    }
  });
export { AccessGuard };

