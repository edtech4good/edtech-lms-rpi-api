import morgan from "morgan";
import type { IncomingMessage } from "http";

/** What stands in for a parameter value in the request log. */
const VALUE_MARK = "…";

/** Characters kept as they are in a logged parameter name; everything else is percent-encoded. */
const PLAIN_NAME_CHAR = /[A-Za-z0-9_.\-[\]]/;

function encodeName(name: string): string {
  let out = "";
  for (const ch of name) {
    out += PLAIN_NAME_CHAR.test(ch) ? ch : encodeURIComponent(ch);
  }
  return out;
}

/**
 * The URL as the request log writes it: the path, and when there is a query string, "?" followed by the parameter
 * names only, each as name=… (a name given more than once appears once). No parameter value and no "#" fragment is
 * written. A name is shown decoded and re-encoded, so it cannot add a line or a space to the log. If the query string
 * cannot be read, only the part before "?" is written.
 */
export function redactQuery(url: string): string {
  const withoutFragment = url.split("#", 1)[0];
  const at = withoutFragment.indexOf("?");
  if (at === -1) return withoutFragment;
  const path = withoutFragment.slice(0, at);
  try {
    const names = new Set<string>();
    for (const pair of withoutFragment.slice(at + 1).split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const raw = eq === -1 ? pair : pair.slice(0, eq);
      const name = encodeName(decodeURIComponent(raw.replace(/\+/g, " ")));
      if (name !== "") names.add(name);
    }
    return names.size === 0 ? path : `${path}?${[...names].map((n) => `${n}=${VALUE_MARK}`).join("&")}`;
  } catch {
    return path;
  }
}

/**
 * The request log runs only when the API's debug setting is on (NODE_ENV=development, or a configuration blob with debug
 * true); app.module.ts adds it then and in no other case.
 *
 * The request log keeps the "combined" layout, with the URL and the referrer written through redactQuery. Pinned in
 * request-log.spec.ts.
 */
export const REQUEST_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :req-path HTTP/:http-version" :status :res[content-length] ":req-from" ":user-agent"';

/** Registers the two tokens REQUEST_LOG_FORMAT uses, on the morgan instance nest-morgan uses. Safe to call again. */
export function registerRequestLogTokens(): void {
  morgan.token("req-path", (req: IncomingMessage & { originalUrl?: string }) => {
    const url = req.originalUrl || req.url;
    return url === undefined ? undefined : redactQuery(url);
  });
  morgan.token("req-from", (req: IncomingMessage) => {
    const from = req.headers.referer || req.headers.referrer;
    return typeof from === "string" ? redactQuery(from) : undefined;
  });
}
