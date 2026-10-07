/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Provisions a classroom server with no network and no central: an organisation, a school, the first staff
 * logins and (optionally) a content payload, all on this server's own database, in one transaction.
 *
 *   npm run build
 *   RPI_OFFLINE=true npm run provision -- --organisation "<name>" --code <code> --school "<name>" \
 *     --country "<country>" --admin <username> [--teacher <username>] [--class "<name>"] \
 *     [--content scripts/provision/sample-content.json] [--credentials-file <path>] [--apply]
 *
 * Without --apply it prints the plan and writes nothing. See scripts/provision/README.md.
 * The logic is in src/provisioning/ (compiled to build/provisioning/): the same models, the same password
 * hashing and the same content import the server runs, so a login made here is exactly one the server accepts.
 */
const path = require("path");
const fs = require("fs");

const cli = path.join(__dirname, "..", "build", "provisioning", "cli.js");
if (!fs.existsSync(cli)) {
  console.error("The server is not built yet. Run `npm run build` first (the same build `npm start` runs).");
  process.exit(1);
}

require(cli)
  .main(process.argv.slice(2))
  .then((code) => process.exit(code));
