/**
 * A classroom Pi whose own school has no organisation yet signs its staff in with
 * a token that has no `organisationid` claim. Such a token is refused everywhere
 * except on the one route that can give the school its organisation: the content
 * import. That route's guard calls `markPiBootstrapRoute` on the request before
 * the token is verified, and the JWT strategy reads the mark. The mark is a
 * property of the server-side request object, never of anything the client sends.
 */
const MARK = Symbol("pi-bootstrap-route");

export const markPiBootstrapRoute = (request: object): void => {
  (request as Record<symbol, boolean>)[MARK] = true;
};

export const isPiBootstrapRoute = (request: object | undefined): boolean =>
  Boolean(request && (request as Record<symbol, boolean>)[MARK] === true);
