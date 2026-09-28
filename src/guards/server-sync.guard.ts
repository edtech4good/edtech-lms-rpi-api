import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  mixin,
  Type,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { Request } from "express";
import { Config } from "src/config";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { TokenType } from "src/models/enums/tokentype.enum";
import { Token } from "src/models/token.model";
import { AccessGuard } from "./access.guard";

const isServerSyncKey = (authorization: string | undefined): boolean => {
  const key = Config.fortyk.api.serversynckey;
  if (!authorization || !key) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

/**
 * For endpoints that central pushes to server-to-server: the bulk imports
 * that wipe and rebuild content or roster tables.
 *
 * - The server sync key (the raw Authorization header, exactly as central's
 *   Sync Content / Sync Students send it) is always accepted.
 * - On a classroom Pi (`RPI_OFFLINE=true`), a user token whose role is in
 *   `offlineRoles` is also accepted. This keeps the Android teacher app's
 *   content load working: it carries central's zip onto a Pi with no
 *   internet and uploads it with the teacher's own Pi token.
 * - Everywhere else a user token is refused: 401 if it doesn't verify, 403 if
 *   it does. An online deployment (the default; `RPI_OFFLINE` unset) never
 *   accepts a user token, so an ordinary app login can't replace content or
 *   bulk-import learners on the shared student API.
 *
 * The offline flag is read per request, not when the route is decorated.
 */
export const ServerSyncGuard = (
  ...offlineRoles: Array<SchoolRole>
): Type<CanActivate> => {
  @Injectable()
  class ServerSyncGuardMixin implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request: Request = context.switchToHttp().getRequest();
      if (isServerSyncKey(request.headers.authorization)) {
        (request as any).user = <Token>{ schooluserid: "server" };
        return true;
      }

      const offline = Config.fortyk.api.rpi.offline;
      if (offline && offlineRoles.length > 0) {
        const RoleGuard = AccessGuard(TokenType.ACCESS, ...offlineRoles);
        return (await new RoleGuard().canActivate(context)) as boolean;
      }

      // Authenticate first so a missing or bad token is still a 401 (clients
      // clear the session on 401), then refuse the valid one.
      const AuthOnly = AccessGuard(TokenType.ACCESS);
      await new AuthOnly().canActivate(context);
      throw new ForbiddenException();
    }
  }
  return mixin(ServerSyncGuardMixin);
};
