/**
 * The three files behind `seed:dcrs -- --content` that the central API and the student API
 * share are verbatim twins (scripts/lib/dcrs-content-plan.js, -apply.js, -cli.js): a change to
 * one without the other leaves the two databases seeded differently. Each repo pins the same
 * hashes. Change a twin, copy it to the other repo, and update the hash here in both.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const TWINS: Record<string, string> = {
  "dcrs-content-plan.js": "ea67ca8961f29c60a8f54780ee5d247a83ddd1ad949c3aedc770a8f44d7a6390",
  "dcrs-content-apply.js": "fe231f58dcd348d8424a09c6f3cf4cb5ecda323da63e54d7f600913f02e49e57",
  "dcrs-content-cli.js": "93148a7c33dcb4465d063b938c281e513ad2262f85bde98ae727abd0448a6e84",
};

describe("the files shared with the other API", () => {
  for (const [file, hash] of Object.entries(TWINS)) {
    it(`scripts/lib/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "lib", file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
});
