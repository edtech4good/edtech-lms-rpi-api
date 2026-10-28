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
  "dcrs-content-plan.js": "4c7b6780e3744c440356d35c491bd17dd810cfc5ff48f450e9419f05da1973bc",
  "dcrs-content-apply.js": "ab4c702a7b0dd9a84f25f38a4c6fcd83c58bfca544b37aa1d733527e47022047",
  "dcrs-content-cli.js": "486f2c0ec9c1c6f7b5871f88665766105e7d3b9c965fa5db7839fd36d294308d",
};

describe("the files shared with the other API", () => {
  for (const [file, hash] of Object.entries(TWINS)) {
    it(`scripts/lib/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "lib", file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
});
