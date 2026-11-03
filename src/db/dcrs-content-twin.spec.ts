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
  "dcrs-content-plan.js": "91906553f15284d2c0982f5b7d72f7ac1d1f4b03811f42eefff62f0cbf384a5c",
  "dcrs-content-apply.js": "6f5dc7388a62a97ef3f36546675ef40b9e1a141c4860931ba37eafaede21e713",
  "dcrs-content-cli.js": "0e9a71f08b484666a453f7d049fecad40e87b5da26e742cb0b53f353eb07a2cf",
};

describe("the files shared with the other API", () => {
  for (const [file, hash] of Object.entries(TWINS)) {
    it(`scripts/lib/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "lib", file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
});
