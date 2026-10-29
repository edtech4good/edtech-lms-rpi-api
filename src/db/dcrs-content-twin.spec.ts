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
  "dcrs-content-plan.js": "4dc573554395023451c028be9fc2a961b870cf7ebe29fb324e5fd9cf078e2027",
  "dcrs-content-apply.js": "320138d5efbd96c41fda83b37e2241656d3260ef26f3f9fbbca093e05aeb1226",
  "dcrs-content-cli.js": "20d2fbe511af22f4220ffe3f6b4fa59a120d22d88936f57a5cdce34ea2e9abfb",
};

describe("the files shared with the other API", () => {
  for (const [file, hash] of Object.entries(TWINS)) {
    it(`scripts/lib/${file} is the twin both repos pin`, () => {
      const text = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "lib", file));
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
    });
  }
});
