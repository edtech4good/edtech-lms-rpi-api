import { CanActivate, ExecutionContext, Injectable, mixin, Type, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { canAccessContent, ContentKind, notFound } from "src/business/content-access";
import { Token } from "src/models/token.model";
import { withGuardInfo } from "./guard-info";

/**
 * Stands in front of a route that names a piece of content in its path: the content must be in the
 * caller's scope (see business/content-access.ts), else the answer is the 404 of content that does not
 * exist, whoever owns it. It runs AFTER the route's access guard (which has put the user on the request);
 * with no user it fails closed.
 *
 *   @UseGuards(AccessGuard(TokenType.ACCESS), ContentAccessGuard("lesson", "lessonid"))
 *
 * `param` is the name of the path parameter that holds the id.
 */
export const ContentAccessGuard = (kind: ContentKind, param: string): Type<CanActivate> => {
  @Injectable()
  class ContentAccessGuardMixin implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request: Request & { user?: Token } = context.switchToHttp().getRequest();
      if (!request.user) {
        throw new UnauthorizedException();
      }
      if (!(await canAccessContent(request.user, kind, request.params?.[param]))) {
        throw notFound();
      }
      return true;
    }
  }
  return withGuardInfo(mixin(ContentAccessGuardMixin), { label: `ContentAccessGuard(${kind}:${param})` });
};
