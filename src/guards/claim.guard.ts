

import { mixin, UnauthorizedException } from '@nestjs/common';
import { SchoolRole } from 'src/models/enums/school.role.enum';
import { Token } from 'src/models/token.model';
export const ClaimGuard = (tokentype: [SchoolRole]) =>
  mixin(class ClaimsGuard {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handleRequest(err: any, user: Token, _info: any) {
      // You can throw an exception based on either "info" or "err" arguments
      if (err || !user) {
        throw err || new UnauthorizedException();
      }

      if (!tokentype.find(x => x == user.schooluserrole)) {
        throw new UnauthorizedException();
      }

      return user;
    }
  });

