import { readFileSync } from "fs";
import { join } from "path";
import { AWARD_HIDDEN_SQL, awardCandidatesSql } from "./level-award";

/**
 * The backfill migration keeps its own copy of the SQL that picks the levels to award and judges the hidden-tier rule
 * (a migration must not import code that may change later), and the roster import runs the business copy. They are the
 * same text, or this fails.
 */
const migration = readFileSync(join(__dirname, "..", "db", "migrations", "20261111110100-backfill-level-awards.ts"), "utf8");
const constant = (name: string): string => {
  const m = migration.match(new RegExp("const " + name + " = `([^`]*)`;"));
  if (!m) throw new Error("migration does not define " + name);
  return m[1];
};
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the roster import and the backfill migration judge awards by the same SQL", () => {
  it("the candidate levels are the same", () => {
    expect(squash(constant("CANDIDATES"))).toBe(squash(awardCandidatesSql("")));
  });
  it("the hidden-tier rule is the same", () => {
    expect(squash(constant("HIDDEN"))).toBe(squash(AWARD_HIDDEN_SQL));
  });
  it("the gradeid and curid stored are the level's current grade and that grade's curriculum in both", () => {
    expect(squash(migration)).toContain("COALESCE(lv.gradeid, c.gradeid), COALESCE(gr.curriculumid, c.curid), COALESCE(c.lastupdated, CURRENT_TIMESTAMP), 1");
  });
});
