/**
 * The four files behind `seed:dcrs -- --content` that the central API and the student API
 * share are verbatim twins (scripts/lib/dcrs-content-plan.js, -apply.js, -cli.js, and the plan's spec
 * src/db/dcrs-content-plan.spec.ts): a change to one without the other leaves the two databases seeded
 * differently, or one of them tested against rules the other does not have. Each repo pins the same
 * hashes. Change a twin, copy it to the other repo, and update the hash here in both (the hashes are
 * of the files as written, so this file is not one of them). The converter and parser are central only.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const TWINS: Record<string, string> = {
  "dcrs-content-plan.js": "2f989dc23f434548216c6331dc75ef9c58adbc070efa63e2eef0790347c33e27",
  "dcrs-content-apply.js": "e7f7357d611e8b453e4bce40f4e5e00eb6c350611208b21276ef70cc1f924810",
  "dcrs-content-cli.js": "8b49d6e9d2d66d7753811aad4377b532000c37f6b4d11959ec93825693301661",
};
// The plan's spec is a twin too: it runs the same plan against the same rules in each repo.
const SPEC_TWINS: Record<string, string> = {
  "dcrs-content-plan.spec.ts": "f91c3c19f6f25437cda8b76eb6642188925c8e40258a73ff6929c9df4c940e98",
};

describe("the files shared with the other API", () => {
  for (const [file, hash] of Object.entries(TWINS)) {
    it(`scripts/lib/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "lib", file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
  for (const [file, hash] of Object.entries(SPEC_TWINS)) {
    it(`src/db/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
});
