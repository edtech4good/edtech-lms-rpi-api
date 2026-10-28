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
  "dcrs-content-plan.js": "036fe73809daa19a1c26a1c1628358d50126ea1642496343d152601a0dc74ebd",
  "dcrs-content-apply.js": "ae6de381e48bfd43d385c5b7f6c33b4c9ba323525f6b14b4d3de3de4514940dd",
  "dcrs-content-cli.js": "b2721a32e1164c7dc7e42d9868402855b6f6e37c8eb49dbbf300e0730b0abafe",
};

describe("the files shared with the other API", () => {
  for (const [file, hash] of Object.entries(TWINS)) {
    it(`scripts/lib/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "lib", file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
});
