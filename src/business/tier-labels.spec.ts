import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { LABEL_PRESETS, LABEL_PRESET_NAMES, MAX_LABEL_LENGTH, TIERS } from "src/constants/tier-labels";
import { ownLabelOf, presetNameOf, resolveTierLabels, withResolvedLabels } from "./tier-labels";

/**
 * The tier labels are shared with central (edtech-lms-api), which writes them (`PUT /school/labels/:schoolid`) and
 * resolves them for its own reads. The student API resolves the same stored `brandingconfig` the same way, so the two
 * source files are copies, pinned below by hash to central's files at edtech-lms-api 9f6c5af (the files were last
 * changed there by 323692d, "A5: ... tier labels with presets", lms-api#156). When central's files change, re-copy
 * them byte for byte and update the hashes with them; a hand edit here, or a stale copy, is red.
 *
 * What the labels resolve to: the platform default, then the school's preset, then the school's own label, tier by
 * tier. The presets are English only: no Khmer is written here.
 */
const CENTRAL_CONSTANTS_SHA256 = "9d14b23ae4fe91d7dbb161859564e82af1813ea04d9d58cc80c3e518d6203704";
const CENTRAL_RESOLVER_SHA256 = "b02654f45a15e9d08900407acf409cf5861a20ef338249e1690394e54f64aedb";
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the tier labels, shared with central", () => {
  it("src/constants/tier-labels.ts is byte for byte central's (edtech-lms-api 9f6c5af)", () => {
    expect(sha256(join(__dirname, "..", "constants", "tier-labels.ts"))).toBe(CENTRAL_CONSTANTS_SHA256);
  });
  it("src/business/tier-labels.ts is byte for byte central's (edtech-lms-api 9f6c5af)", () => {
    expect(sha256(join(__dirname, "tier-labels.ts"))).toBe(CENTRAL_RESOLVER_SHA256);
  });
});

const SCHOOL = {
  curriculum: { en: { one: "Curriculum", other: "Curricula" } },
  grade: { en: { one: "Grade", other: "Grades" } },
  level: { en: { one: "Level", other: "Levels" } },
  lesson: { en: { one: "Lesson", other: "Lessons" } },
};
const COMPANY = {
  curriculum: { en: { one: "Programme", other: "Programmes" } },
  grade: { en: { one: "Track", other: "Tracks" } },
  level: { en: { one: "Module", other: "Modules" } },
  lesson: { en: { one: "Lesson", other: "Lessons" } },
};

describe("the label presets", () => {
  it("are the School and Company wordings, selectable by name, for exactly the four tiers", () => {
    expect([...LABEL_PRESET_NAMES]).toEqual(["school", "company"]);
    expect([...TIERS]).toEqual(["curriculum", "grade", "level", "lesson"]);
    expect(LABEL_PRESETS).toEqual({ school: SCHOOL, company: COMPANY });
  });
  it("carry no Khmer text: a preset is English only", () => {
    // the Khmer and Khmer Symbols blocks, written as escapes
    expect(JSON.stringify(LABEL_PRESETS)).not.toMatch(/[\u1780-\u17FF\u19E0-\u19FF]/);
    for (const preset of Object.values(LABEL_PRESETS)) for (const tier of TIERS) expect(preset[tier].km).toBeUndefined();
  });
});

describe("resolving a school's labels", () => {
  it.each([[null], [undefined], [{}], ["text"], [[]], [{ labels: "x" }], [{ labelPreset: "nonsense" }]])(
    "a school with nothing usable stored (%j) gets the platform default, which is the School preset",
    (stored) => {
      expect(resolveTierLabels(stored)).toEqual({ labelsresolved: SCHOOL, hideSingleItemTiers: false });
    },
  );
  it("a preset chosen by name replaces the default for every tier", () => {
    expect(resolveTierLabels({ labelPreset: "company" }).labelsresolved).toEqual(COMPANY);
    expect(resolveTierLabels({ labelPreset: "school" }).labelsresolved).toEqual(SCHOOL);
  });
  it("the school's own label wins over the preset for that tier only, and keeps the text it was given for the second language", () => {
    const own = { en: { one: "Stage", other: "Stages" }, km: "text typed by the school" };
    const resolved = resolveTierLabels({ labelPreset: "company", labels: { level: own } }).labelsresolved;
    expect(resolved).toEqual({ ...COMPANY, level: own });
    // and with no preset it is laid over the platform default
    expect(resolveTierLabels({ labels: { grade: { en: { one: "Strand", other: "Strands" } } } }).labelsresolved).toEqual({
      ...SCHOOL,
      grade: { en: { one: "Strand", other: "Strands" } },
    });
  });
  it("a tier is the school's own whole or not at all: a half label or a damaged one falls back to the preset", () => {
    const damaged = {
      curriculum: { en: { one: "Course" } },
      grade: { en: { one: "Strand", other: "" } },
      level: { en: "Stage" },
      lesson: { en: { one: "Part", other: "x".repeat(MAX_LABEL_LENGTH + 1) } },
    };
    expect(resolveTierLabels({ labelPreset: "company", labels: damaged }).labelsresolved).toEqual(COMPANY);
    expect(ownLabelOf({ en: { one: "  Stage ", other: " Stages " }, km: "  " })).toEqual({ en: { one: "Stage", other: "Stages" } });
  });
  it("a label for a tier that does not exist is ignored", () => {
    const resolved = resolveTierLabels({ labels: { cohort: { en: { one: "Cohort", other: "Cohorts" } } } }).labelsresolved;
    expect(Object.keys(resolved)).toEqual(["curriculum", "grade", "level", "lesson"]);
    expect(resolved).toEqual(SCHOOL);
  });
  it("the hide switch is true only when it is stored as true", () => {
    expect(resolveTierLabels({ hideSingleItemTiers: true }).hideSingleItemTiers).toBe(true);
    for (const other of [false, "true", 1, null, undefined]) expect(resolveTierLabels({ hideSingleItemTiers: other }).hideSingleItemTiers).toBe(false);
  });
  it("a result is a copy: changing it changes neither the preset nor the stored labels", () => {
    const stored = { labels: { level: { en: { one: "Stage", other: "Stages" } } } };
    const resolved = resolveTierLabels(stored).labelsresolved;
    resolved.grade.en.one = "Changed";
    resolved.level.en.one = "Changed";
    expect(LABEL_PRESETS.school.grade.en.one).toBe("Grade");
    expect(stored.labels.level.en.one).toBe("Stage");
    expect(resolveTierLabels({}).labelsresolved.grade.en.one).toBe("Grade");
  });
  it("names the preset a school has, or the default's name", () => {
    expect(presetNameOf({ labelPreset: "company" })).toBe("company");
    expect(presetNameOf({ labelPreset: "x" })).toBe("school");
    expect(presetNameOf(null)).toBe("school");
  });
  it("puts the resolved labels beside the school's own fields without changing any of them", () => {
    const school = { schoolid: "s", schoolname: "A", brandingconfig: { labelPreset: "company" } };
    expect(withResolvedLabels(school)).toEqual({ ...school, labelsresolved: COMPANY, hideSingleItemTiers: false });
  });
});
