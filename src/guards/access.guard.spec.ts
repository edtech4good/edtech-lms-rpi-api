import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Config } from "src/config";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { TokenType } from "src/models/enums/tokentype.enum";
import { AccessGuard } from "./access.guard";

/**
 * Guards the hardening from #35 (role check gives 403, not a 401) and #21
 * (the request is read from handleRequest's own `context` argument, never
 * from instance state the guard mixin stored earlier). Nest instantiates one
 * guard per route, so a regression to instance state would let one
 * in-flight request's decision leak into another's — see the #21 commit
 * message for the measured 207/1000 leak this fixed.
 *
 * These call `handleRequest` directly rather than driving `canActivate`
 * through real passport/JWT verification, since no passport strategy is
 * registered in a unit test. `handleRequest` is where every access decision
 * in AccessGuard is actually made — `canActivate` only delegates to
 * `super.canActivate`, which is out of scope here (that's passport's own,
 * already-tested code).
 */
const makeContext = (headers: Record<string, string> = {}): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext);

describe("AccessGuard", () => {
  describe("no valid token", () => {
    it("throws Unauthorized (401) when there is no user and no sync-key header", () => {
      const Guard = AccessGuard(TokenType.ACCESS, SchoolRole.ADMIN);
      const guard = new Guard();
      const context = makeContext({});

      expect(() =>
        guard.handleRequest(new UnauthorizedException(), null, null, context)
      ).toThrow(UnauthorizedException);
    });

    it("throws whatever passport's err was, when there is no user", () => {
      const Guard = AccessGuard(TokenType.ACCESS);
      const guard = new Guard();
      const boom = new Error("jwt malformed");
      const context = makeContext({});

      expect(() => guard.handleRequest(boom, null, null, context)).toThrow(boom);
    });

    it("fails CLOSED (throws) when there is no context at all, rather than falling through to `return user` with no user", () => {
      // Regression guard for the 25 Sep 2026 audit's "latent, not
      // exploitable today" finding: the old handleRequest wrapped its
      // entire err/no-user branch (including the final throw) inside
      // `if (context)`. With no context AND no role list, that let a
      // missing-context call fall all the way to `return user` below with
      // `user` still null/undefined — passport would then let the request
      // through unauthenticated. `@nestjs/passport` 8 always passes a
      // context in practice, so this can't be reached today, but the guard
      // must not rely on that.
      const Guard = AccessGuard(TokenType.ACCESS);
      const guard = new Guard();

      expect(() =>
        guard.handleRequest(null, null, null, undefined as unknown as ExecutionContext)
      ).toThrow(UnauthorizedException);
    });

    it("still grants the synthetic server identity for the sync key, reading the header from the passed context (#21)", () => {
      const Guard = AccessGuard(TokenType.ACCESS, SchoolRole.ADMIN);
      const guard = new Guard();
      const context = makeContext({
        authorization: Config.fortyk.api.serversynckey,
      });

      const result = guard.handleRequest(
        new UnauthorizedException(),
        null,
        null,
        context
      );

      expect(result).toEqual({ schooluserid: "server" });
    });
  });

  describe("valid token, role check (#35)", () => {
    it("throws Forbidden (403), not Unauthorized, when the token's role is not in the allowed list", () => {
      const Guard = AccessGuard(TokenType.ACCESS, SchoolRole.ADMIN, SchoolRole.SUPERADMIN);
      const guard = new Guard();
      const user = { schooluserid: "u1", schooluserrole: SchoolRole.TEACHER };
      const context = makeContext({});

      expect(() => guard.handleRequest(null, user, null, context)).toThrow(
        ForbiddenException
      );
    });

    it("allows the request through when the token's role is in the allowed list", () => {
      const Guard = AccessGuard(TokenType.ACCESS, SchoolRole.ADMIN, SchoolRole.SUPERADMIN);
      const guard = new Guard();
      const user = { schooluserid: "u1", schooluserrole: SchoolRole.ADMIN };
      const context = makeContext({});

      expect(guard.handleRequest(null, user, null, context)).toBe(user);
    });

    it("allows any role through when no role list was passed to the guard factory", () => {
      const Guard = AccessGuard(TokenType.ACCESS);
      const guard = new Guard();
      const user = { schooluserid: "u1", schooluserrole: SchoolRole.STUDENT };
      const context = makeContext({});

      expect(guard.handleRequest(null, user, null, context)).toBe(user);
    });
  });

  describe("per-request isolation (#21)", () => {
    it("does not let one request's sync-key header answer for a request with no such header on the same guard instance", () => {
      const Guard = AccessGuard(TokenType.ACCESS, SchoolRole.ADMIN);
      const guard = new Guard();

      const withSyncKey = makeContext({
        authorization: Config.fortyk.api.serversynckey,
      });
      const withoutSyncKey = makeContext({});

      // Order matters: the sync-key request first, to prove a later,
      // unrelated request on the SAME instance can't be waved through by
      // state the first call might have left behind.
      expect(
        guard.handleRequest(new UnauthorizedException(), null, null, withSyncKey)
      ).toEqual({ schooluserid: "server" });

      expect(() =>
        guard.handleRequest(new UnauthorizedException(), null, null, withoutSyncKey)
      ).toThrow(UnauthorizedException);
    });
  });
});
