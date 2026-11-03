import { ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";
import { BusinessValidationInterceptor } from "./businessvalidation.interceptor";

/**
 * The object a business rule is given is the request's path parameters, query and body together. Where they name
 * the same key, the path parameter takes precedence over the body and the query, and the body over the query.
 */
const contextOf = (request: { params?: unknown; query?: unknown; body?: unknown }): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

const seenBy = async (request: { params?: unknown; query?: unknown; body?: unknown }): Promise<unknown[]> => {
  const seen: unknown[] = [];
  const rule = async (_request: unknown, data: unknown) => {
    seen.push(data);
    return [];
  };
  const interceptor = new BusinessValidationInterceptor([rule as never]);
  await (await interceptor.intercept(contextOf(request), { handle: () => of("ok") })).toPromise();
  return seen;
};

describe("business validation: a path parameter takes precedence over body and query", () => {
  it("gives a rule the path's value when the query names the same key", async () => {
    expect(await seenBy({ params: { id: "from-path" }, query: { id: "from-query" }, body: {} })).toEqual([{ id: "from-path" }]);
  });

  it("gives a rule the path's value when the body names the same key", async () => {
    expect(await seenBy({ params: { id: "from-path" }, query: {}, body: { id: "from-body" } })).toEqual([{ id: "from-path" }]);
  });

  it("gives a rule the path's value when both name it", async () => {
    expect(await seenBy({ params: { id: "from-path" }, query: { id: "from-query" }, body: { id: "from-body" } })).toEqual([
      { id: "from-path" },
    ]);
  });

  it("keeps the body over the query for a key the path does not carry", async () => {
    expect(await seenBy({ params: { id: "from-path" }, query: { name: "from-query" }, body: { name: "from-body" } })).toEqual([
      { id: "from-path", name: "from-body" },
    ]);
  });

  it("still merges keys that do not collide", async () => {
    expect(await seenBy({ params: { a: 1 }, query: { b: 2 }, body: { c: 3 } })).toEqual([{ a: 1, b: 2, c: 3 }]);
  });

  it("asks no rule when the request carries nothing", async () => {
    expect(await seenBy({ params: {}, query: {}, body: undefined })).toEqual([]);
  });
});
