/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Exports ONE organisation's content (a format-3 payload) from a central API and saves it as JSON, ready for
 * `npm run provision -- --content <file>`. This is the only step of the offline recipe that talks to central, and
 * it is done on a machine of yours, once; the classroom server never does.
 *
 *   CENTRAL_URL=http://127.0.0.1:3011 CENTRAL_USER=<platform user> CENTRAL_PASSWORD=<its password> \
 *     node scripts/provision/export-from-central.js <organisation id> <output.json>
 *
 * It signs in as a platform user, switches to the organisation (POST /auth/organisation), downloads
 * GET /sync/content (a zip with one file) and writes that file, pretty-printed, to the output path. Credentials
 * come from the environment only; nothing is printed but status lines. Central keeps one token per user, so signing
 * in here ends that account's other session (a browser, say); that cannot be avoided. At the end the script signs
 * out, which only drops its own token, so no token is left lying around.
 */
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const base = (process.env.CENTRAL_URL || "").replace(/\/+$/, "");
const user = process.env.CENTRAL_USER;
const password = process.env.CENTRAL_PASSWORD;
const [organisationid, output] = process.argv.slice(2);

if (!base || !user || !password || !organisationid || !output) {
  console.error("Usage: CENTRAL_URL=… CENTRAL_USER=… CENTRAL_PASSWORD=… node scripts/provision/export-from-central.js <organisation id> <output.json>");
  process.exit(1);
}

const call = async (route, options = {}) => {
  const response = await fetch(base + route, options);
  if (!response.ok) throw new Error(`${options.method || "GET"} ${route} answered ${response.status}`);
  return response;
};
const json = { "content-type": "application/json" };

(async () => {
  let token = null;
  const login = await (await call("/auth/login", { method: "POST", headers: json, body: JSON.stringify({ lmsusername: user, lmsuserpassword: password }) })).json();
  token = login.data.accessToken;
  const switched = await (
    await call("/auth/organisation", {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${login.data.accessToken}` },
      body: JSON.stringify({ organisationid }),
    })
  ).json();
  // Switching organisation issues a new token and ends the old one: this is the one to sign out with.
  token = switched.data.accessToken;
  const zip = Buffer.from(await (await call("/sync/content", { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
  const entries = new AdmZip(zip).getEntries();
  if (entries.length === 0) throw new Error("the export holds no file");
  const payload = JSON.parse(entries[0].getData().toString("utf8"));
  if (payload.format !== 3) throw new Error("the export is not a format-3 payload");
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(payload, null, 2) + "\n");
  const rows = Object.entries(payload).filter(([, v]) => Array.isArray(v)).reduce((n, [, v]) => n + v.length, 0);
  console.log(`Saved ${rows} rows of organisation ${payload.organisationcode} to ${output}`);
})()
  .catch((e) => {
    console.error(`Export failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Signing in already ended the account's other sessions; this only drops this script's own token.
    if (token) {
      await fetch(`${base}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    }
  });
