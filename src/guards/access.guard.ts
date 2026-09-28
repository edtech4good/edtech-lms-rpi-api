import { ExecutionContext, ForbiddenException, mixin, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SchoolRole } from 'src/models/enums/school.role.enum';
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

      // Fail CLOSED. This guard no longer accepts the server sync key —
      // that bypass (a plain `===` compare, and one that skipped the role
      // check below entirely) gave a leaked key full access to every route
      // guarded by AccessGuard. Routes central legitimately calls with the
      // sync key use AccessOrServerSyncGuard (src/guards/access-or-server-sync.guard.ts)
      // instead, applied one allow-listed route at a time. See
      // edtech4good/workspace#45.
      if (err || !user) {
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

