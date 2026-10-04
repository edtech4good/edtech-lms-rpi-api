import { CanActivate, createParamDecorator, ExecutionContext, Injectable, InternalServerErrorException, mixin, Type } from "@nestjs/common";
import { ReportScope, resolveReportScope } from "src/business/report-scope";
import { withGuardInfo } from "./guard-info";

const SCOPE = Symbol("report-scope");

/**
 * Works out whose rows a report-style route may cover (see business/report-scope.ts) and puts it on the
 * request for `@ReportScopeOf()`. It runs AFTER the route's access guard, in the same `@UseGuards(...)`:
 *
 *   @UseGuards(AccessOrServerSyncGuard(TokenType.ACCESS, ...roles), ReportScopeGuard)
 *
 * A malformed organisation header is a 400 here, before any query.
 */
@Injectable()
class ReportScopeGuardClass implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request[SCOPE] = await resolveReportScope(request);
    return true;
  }
}

export const ReportScopeGuard: Type<CanActivate> = withGuardInfo(mixin(ReportScopeGuardClass), { label: "ReportScopeGuard" });

/**
 * The scope the guard resolved: a `ReportScope`, or `null` for the platform's unscoped view. A route that
 * reads it without the guard in front of it fails (500) rather than answering unscoped.
 */
export const ReportScopeOf = createParamDecorator((_data: unknown, context: ExecutionContext): ReportScope | null => {
  const request = context.switchToHttp().getRequest();
  if (!(SCOPE in request)) {
    throw new InternalServerErrorException();
  }
  return request[SCOPE] as ReportScope | null;
});
