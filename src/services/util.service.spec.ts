import { Request } from "express";
import { TokenType } from "src/models/enums";
import { jwtoptionsbuilder } from "./util.service";

/**
 * Guards the token half of #22: the ACCESS strategy must not accept a token
 * from the URL query string (query strings land in server access logs,
 * browser history and Referer headers). Only the Authorization header and
 * the body field are legitimate carriers.
 */
describe("jwtoptionsbuilder", () => {
  const buildRequest = (overrides: Partial<Request>): Request =>
    ({
      headers: {},
      body: {},
      query: {},
      ...overrides,
    } as unknown as Request);

  it("does not extract a token from the query string, even under the extractor's usual param names", () => {
    const options = jwtoptionsbuilder(TokenType.ACCESS)!;
    const hostileRequest = buildRequest({
      query: { accesstoken: "attacker-supplied-token", access_token: "attacker-supplied-token" },
    });

    expect(options.jwtFromRequest(hostileRequest)).toBeNull();
  });

  it("still extracts a token from the Authorization header", () => {
    const options = jwtoptionsbuilder(TokenType.ACCESS)!;
    const request = buildRequest({
      headers: { authorization: "Bearer a-real-token" },
    });

    expect(options.jwtFromRequest(request)).toBe("a-real-token");
  });

  it("still extracts a token from the body field as a fallback", () => {
    const options = jwtoptionsbuilder(TokenType.ACCESS)!;
    const request = buildRequest({
      body: { accesstoken: "a-real-token" },
    });

    expect(options.jwtFromRequest(request)).toBe("a-real-token");
  });
});
