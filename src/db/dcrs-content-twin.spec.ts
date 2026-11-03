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
  "dcrs-content-plan.js": "c1fa628b326e36a92083a0e605d74676f401925ea168c8688e0170dbb348342c",
  "dcrs-content-apply.js": "ffdcb63db6b742d2a530d45e4a4f3d18932ebdd2bff0c30887cee82a31cd13f8",
  "dcrs-content-cli.js": "0e9a71f08b484666a453f7d049fecad40e87b5da26e742cb0b53f353eb07a2cf",
};
// The plan's spec is a twin too: it runs the same plan against the same rules in each repo.
const SPEC_TWINS: Record<string, string> = {
  "dcrs-content-plan.spec.ts": "b6beed543ca7aa58b7d38ee12b12331e9cde4675abca09567679773eeafe3dc7",
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
