import {
  CanActivate,
  ExecutionContext,
  Injectable,
  mixin,
  Type,
} from "@nestjs/common";
import { Request } from "express";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { TokenType } from "src/models/enums/tokentype.enum";
import { Token } from "src/models/token.model";
import { AccessGuard } from "./access.guard";
import { isServerSyncKey } from "./server-sync-key.util";

/**
 * For the small, named allow-list of routes central calls server-to-server
 * with the sync key (see edtech4good/workspace#45): `report/*`,
 * `student/logintime`, and `curriculum/:id/getstudentresult`. `export/*` was
 * dropped from the allow-list after review — no caller sends the key there,
 * so it is back on plain `AccessGuard` — and `import/*` is scoped
 * separately (it already has its own `ServerSyncGuard`).
 *
 * - The server sync key (the raw Authorization header, exactly as central
 *   sends it, constant-time compared) is always accepted, and the request
 *   proceeds with the same synthetic `{schooluserid: "server"}` token the
 *   old AccessGuard bypass produced, so existing handlers on these routes
 *   keep working unchanged.
 * - Anything else — including a missing/invalid token — falls through to
 *   the route's ordinary `AccessGuard(tokentype, ...schoolrole)`, so a user
 *   token's existing role requirement for the route is preserved exactly:
 *   401 for a missing/bad token, 403 for a valid token with the wrong role.
 *
 * Do NOT apply this to a route that isn't on the allow-list above — a
 * leaked sync key must not reach anything wider than that.
 */
export const AccessOrServerSyncGuard = (
  tokentype: TokenType,
  ...schoolrole: Array<SchoolRole>
): Type<CanActivate> => {
  @Injectable()
  class AccessOrServerSyncGuardMixin implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request: Request = context.switchToHttp().getRequest();
      if (isServerSyncKey(request.headers.authorization)) {
        (request as any).user = <Token>{ schooluserid: "server" };
        return true;
      }

      const RoleGuard = AccessGuard(tokentype, ...schoolrole);
      return (await new RoleGuard().canActivate(context)) as boolean;
    }
  }
  return mixin(AccessOrServerSyncGuardMixin);
};
