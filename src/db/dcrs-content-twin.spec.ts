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
  "dcrs-content-plan.js": "366f25ef878a6bf3e9de3403c1d875a52895025de42cca1b45acb49ad1fc56f5",
  "dcrs-content-apply.js": "eacdff9fd30183e2f5b930409d0b778120a64e83d0a326a583214bb320945145",
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
