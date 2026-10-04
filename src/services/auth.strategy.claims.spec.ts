import { JwtAccessStrategy } from "./auth.strategy";

/**
 * Nothing is refused on the new claims yet (a later package does that): a token
 * issued before they existed, and one that has them, are both accepted as they
 * are, and the claims reach the request user untouched.
 */
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists: jest.fn().mockResolvedValue(true) })),
}));

describe("JwtAccessStrategy and the schoolid / organisationid claims", () => {
  const strategy = new JwtAccessStrategy();

  it("accepts an old token that has neither claim", async () => {
    const user = await strategy.validate({ jti: "j", sub: "u1", schooluserid: "u1" });
    expect(user).toEqual({ jti: "j", sub: "u1", schooluserid: "u1" });
  });

  it("accepts a token with only one of them", async () => {
    await expect(strategy.validate({ jti: "j", schoolid: "5c000000-0000-4000-8000-0000000000a1" })).resolves.toMatchObject({
      schoolid: "5c000000-0000-4000-8000-0000000000a1",
    });
  });

  it("accepts a token whose claims are null and passes them through", async () => {
    await expect(strategy.validate({ jti: "j", schoolid: null, organisationid: null })).resolves.toMatchObject({
      schoolid: null,
      organisationid: null,
    });
  });

  it("accepts a token that has both and passes them through", async () => {
    await expect(strategy.validate({ jti: "j", schoolid: "s", organisationid: "o" })).resolves.toMatchObject({
      schoolid: "s",
      organisationid: "o",
    });
  });
});
