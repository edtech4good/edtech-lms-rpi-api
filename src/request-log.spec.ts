import morgan from "morgan";
import { REQUEST_LOG_FORMAT, redactQuery, registerRequestLogTokens } from "./request-log";

describe("redactQuery", () => {
  it("leaves a URL without a query string as it is", () => {
    expect(redactQuery("/auth/login")).toBe("/auth/login");
  });

  it("writes parameter names and no values", () => {
    expect(redactQuery("/auth/refreshtoken?refreshtoken=abc123")).toBe("/auth/refreshtoken?refreshtoken=…");
    expect(redactQuery("/a?x=1&y=two")).toBe("/a?x=…&y=…");
  });

  it("writes a parameter with an empty value, and one with no equals sign, as a name", () => {
    expect(redactQuery("/a?x=&y")).toBe("/a?x=…&y=…");
  });

  it("writes only the path for a bare ? or empty pairs", () => {
    expect(redactQuery("/a?")).toBe("/a");
    expect(redactQuery("/a?&&")).toBe("/a");
  });

  it("writes a repeated name once", () => {
    const out = redactQuery("/a?id=first&id=second&other=third&id=fourth");
    expect(out).toBe("/a?id=…&other=…");
    expect(out).not.toMatch(/first|second|third|fourth/);
  });

  it("drops a fragment, with or without a query string", () => {
    expect(redactQuery("/a#section")).toBe("/a");
    expect(redactQuery("/a?x=1#frag=zzz")).toBe("/a?x=…");
    expect(redactQuery("/a?#frag")).toBe("/a");
  });

  it("shows a percent-encoded name decoded and encoded again, never raw", () => {
    expect(redactQuery("/a?na%6De=v")).toBe("/a?name=…");
    expect(redactQuery("/a?my%20key=v&plus+key=v")).toBe("/a?my%20key=…&plus%20key=…");
    expect(redactQuery("/a?f%5Bo%5D=v")).toBe("/a?f[o]=…");
  });

  it("cannot be made to add a line to the log through a name", () => {
    const out = redactQuery("/a?x%0Ay%0D%22z=v");
    expect(out).not.toMatch(/[\r\n"]/);
  });

  it("does not write an encoded value", () => {
    expect(redactQuery("/a?x=%E1%9E%80%E1%9E%81&y=a%26b")).toBe("/a?x=…&y=…");
  });

  it("writes only the part before ? when the query string cannot be read", () => {
    const out = redactQuery("/a/b?bad%E0%A4%A=secretish&ok=v");
    expect(out).toBe("/a/b");
  });

  it("handles an absolute URL, as in a referrer", () => {
    expect(redactQuery("https://ui.example.org/reset?changepasswordtoken=abc&lang=km")).toBe(
      "https://ui.example.org/reset?changepasswordtoken=…&lang=…",
    );
  });
});

describe("request log format", () => {
  it("does not write :url or :referrer, and uses the two path tokens", () => {
    expect(REQUEST_LOG_FORMAT).not.toMatch(/:url\b/);
    expect(REQUEST_LOG_FORMAT).not.toMatch(/:referrer\b/);
    expect(REQUEST_LOG_FORMAT).toContain(":req-path");
    expect(REQUEST_LOG_FORMAT).toContain(":req-from");
  });

  it("keeps the combined layout apart from those two fields", () => {
    const swap = (s: string) => s.replace(":req-path", ":url").replace(":req-from", ":referrer");
    expect(swap(REQUEST_LOG_FORMAT)).toBe(
      ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',
    );
  });

  it("is what the app module hands to the request log, not the combined format", () => {
    const savedEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AppModule } = require("./app.module");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { APP_INTERCEPTOR } = require("@nestjs/core");
        const providers: Array<{ provide?: unknown; useClass?: new (...args: unknown[]) => { format: unknown } }> =
          Reflect.getMetadata("providers", AppModule);
        const logger = providers.find((p) => p.provide === APP_INTERCEPTOR);
        expect(logger).toBeDefined();
        expect(new logger!.useClass!(undefined).format).toBe(REQUEST_LOG_FORMAT);
        // The morgan this module graph uses has the token (isolateModules gives it its own copy).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const appMorgan = require("morgan");
        const probe = { method: "GET", url: "/p?v=1", headers: {} };
        expect(appMorgan.compile(":req-path")(appMorgan, probe, {})).toBe("/p?v=\u2026");
      });
    } finally {
      if (savedEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedEnv;
    }
  });

  it("writes a request line without parameter values, through the morgan the interceptor uses", () => {
    registerRequestLogTokens();
    const lines: string[] = [];
    const log = morgan(REQUEST_LOG_FORMAT, { stream: { write: (l: string) => lines.push(l) }, immediate: true });
    const req = {
      method: "POST",
      originalUrl: "/auth/refreshtoken?refreshtoken=dummyvalue&id=1#frag",
      url: "/auth/refreshtoken?refreshtoken=dummyvalue",
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      headers: { referer: "https://ui.example.org/p?changepasswordtoken=dummyvalue", "user-agent": "spec" },
      socket: { remoteAddress: "127.0.0.1" },
    };
    log(req as never, {} as never, () => undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("dummyvalue");
    expect(lines[0]).toContain("/auth/refreshtoken?refreshtoken=…&id=…");
    expect(lines[0]).toContain("https://ui.example.org/p?changepasswordtoken=…");
  });
});
