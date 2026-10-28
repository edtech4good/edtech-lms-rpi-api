import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

/** The student API's half of the pin: this file is byte for byte central's src/constants/content-translations.ts (edtech-lms-api feat/content-translations). */
const CENTRAL_CONSTANTS_SHA256 = "695bd1530add6cc14d9a2378bebbb718282158dc3000d1fb1d2dc9ad9c173fdf";
describe("the translation constants, shared with central", () => {
  it("src/constants/content-translations.ts is byte for byte central's", () => {
    expect(createHash("sha256").update(readFileSync(join(__dirname, "content-translations.ts"))).digest("hex")).toBe(CENTRAL_CONSTANTS_SHA256);
  });
});
