import { Sequelize } from "sequelize";
import { organisations } from "src/models/data-models/organisations";
import { initModels } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { mergeBrandingConfig, SchoolBusiness } from "./school.business";
import { resolveTierLabels } from "./tier-labels";

/**
 * `GET /school/branding` merges the branding config key by key: the school's `logourl`, `displayname` and `tilecolour`
 * where it has them, else its organisation's. A school that stores only tier labels must still show its organisation's
 * logo, name and tile colour. The labels are the school's alone, and come back resolved beside the stored config.
 *
 * No database: the school and organisation reads are stubbed.
 */
const SCHOOL_ID = "5c000000-0000-4000-8000-0000000000a1";
const ORG_ID = "5c000000-0000-4000-8000-0000000000c1";
const ORG_BRANDING = { logourl: "https://example.org/org.png", displayname: "The Organisation", tilecolour: "#112233" };
const OWN_LABELS = { labels: { level: { en: { one: "Stage", other: "Stages" } } } };

let sequelize: Sequelize;
let schoolRow: Record<string, unknown> | null;
let orgRow: Record<string, unknown> | null;

beforeEach(() => {
  sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
  initModels(sequelize);
  schoolRow = null;
  orgRow = { organisationid: ORG_ID, organisationstatus: true, isdeleted: false, uitheme: "corporate", brandingconfig: ORG_BRANDING };
  jest.spyOn(schools, "findOne").mockImplementation((async () => schoolRow) as never);
  jest.spyOn(organisations, "findOne").mockImplementation((async () => orgRow) as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await sequelize.close();
});

const school = (brandingconfig: object | null, extra: Record<string, unknown> = {}) => {
  schoolRow = { schoolid: SCHOOL_ID, organisationid: ORG_ID, uitheme: null, brandingconfig, ...extra };
};
const branding = () => new SchoolBusiness().getBranding(undefined, SCHOOL_ID);

describe("branding falls back per key, not per object", () => {
  it("a school that stores only labels still gets its organisation's logo, display name and tile colour", async () => {
    school({ labelPreset: "company" });
    const data = await branding();
    expect(data.brandingconfig).toEqual({ labelPreset: "company", ...ORG_BRANDING });
    expect(data.labelsresolved.grade.en).toEqual({ one: "Track", other: "Tracks" });
  });

  it("a school that stores only a logo gets its organisation's display name and tile colour, and keeps its own logo", async () => {
    school({ logourl: "https://example.org/school.png" });
    expect((await branding()).brandingconfig).toEqual({
      logourl: "https://example.org/school.png",
      displayname: "The Organisation",
      tilecolour: "#112233",
    });
  });

  it("a key the school stores wins, key by key", async () => {
    school({ displayname: "The School", tilecolour: "#445566" });
    expect((await branding()).brandingconfig).toEqual({
      displayname: "The School",
      tilecolour: "#445566",
      logourl: "https://example.org/org.png",
    });
  });

  it("a blank or non-text value counts as none, so the organisation's fills it", async () => {
    school({ logourl: "  ", displayname: "", tilecolour: 7 });
    expect((await branding()).brandingconfig).toEqual(ORG_BRANDING);
  });

  it("a school with no config of its own gets its organisation's, as before", async () => {
    school(null);
    expect((await branding()).brandingconfig).toEqual(ORG_BRANDING);
  });

  it("neither a school config nor an organisation config gives null; a school config alone is returned as it is", async () => {
    school(null);
    orgRow = { ...orgRow, brandingconfig: null };
    expect((await branding()).brandingconfig).toBeNull();
    school(OWN_LABELS);
    expect((await branding()).brandingconfig).toEqual(OWN_LABELS);
  });

  it("a suspended or deleted organisation supplies nothing", async () => {
    school(OWN_LABELS);
    orgRow = { ...orgRow, organisationstatus: false };
    expect((await branding()).brandingconfig).toEqual(OWN_LABELS);
    orgRow = { ...orgRow, organisationstatus: true, isdeleted: true };
    expect((await branding()).brandingconfig).toEqual(OWN_LABELS);
  });

  it("the organisation's labels are never inherited: only the school's decide the labels", async () => {
    school({ logourl: "https://example.org/school.png" });
    orgRow = { ...orgRow, brandingconfig: { ...ORG_BRANDING, labelPreset: "company", hideSingleItemTiers: true, labels: OWN_LABELS.labels } };
    const data = await branding();
    expect(data.brandingconfig).not.toHaveProperty("labelPreset");
    expect(data.brandingconfig).not.toHaveProperty("labels");
    expect(data.labelsresolved).toEqual(resolveTierLabels(null).labelsresolved);
    expect(data.hideSingleItemTiers).toBe(false);
  });

  it("keeps the school's theme, else the organisation's, else kids, as before", async () => {
    school({ labelPreset: "company" }, { uitheme: "kids" });
    expect((await branding()).uitheme).toBe("kids");
    school({ labelPreset: "company" });
    expect((await branding()).uitheme).toBe("corporate");
    school(null, { organisationid: null });
    expect((await branding()).uitheme).toBe("kids");
  });
});

describe("branding returns the labels as a client shows them", () => {
  it("a school with no labels stored gets the platform default (the School preset) and the hide switch off", async () => {
    school(null);
    const data = await branding();
    expect(data.labelsresolved).toEqual({
      curriculum: { en: { one: "Curriculum", other: "Curricula" } },
      grade: { en: { one: "Grade", other: "Grades" } },
      level: { en: { one: "Level", other: "Levels" } },
      lesson: { en: { one: "Lesson", other: "Lessons" } },
    });
    expect(data.hideSingleItemTiers).toBe(false);
  });

  it("a preset replaces the default for every tier it names", async () => {
    school({ labelPreset: "company" });
    expect((await branding()).labelsresolved).toEqual({
      curriculum: { en: { one: "Programme", other: "Programmes" } },
      grade: { en: { one: "Track", other: "Tracks" } },
      level: { en: { one: "Module", other: "Modules" } },
      lesson: { en: { one: "Lesson", other: "Lessons" } },
    });
  });

  it("the school's own label wins for its tier only, over the preset, and the hide switch is passed on", async () => {
    school({ labelPreset: "company", hideSingleItemTiers: true, ...OWN_LABELS });
    const data = await branding();
    expect(data.labelsresolved.level).toEqual({ en: { one: "Stage", other: "Stages" } });
    expect(data.labelsresolved.grade).toEqual({ en: { one: "Track", other: "Tracks" } });
    expect(data.hideSingleItemTiers).toBe(true);
  });

  it("an unknown school, or none, gets the defaults with null branding", async () => {
    schoolRow = null;
    expect(await branding()).toEqual({ uitheme: "kids", brandingconfig: null, ...resolveTierLabels(null) });
    expect(await new SchoolBusiness().getBranding()).toEqual({ uitheme: "kids", brandingconfig: null, ...resolveTierLabels(null) });
  });
});

describe("mergeBrandingConfig", () => {
  it("never changes either input", () => {
    const own = { labelPreset: "company" };
    const org = { ...ORG_BRANDING };
    const merged = mergeBrandingConfig(own, org);
    expect(merged).not.toBe(own);
    expect(own).toEqual({ labelPreset: "company" });
    expect(org).toEqual(ORG_BRANDING);
  });
  it.each([[null], [undefined], ["x"], [[]]])("treats %j as no config", (junk) => {
    expect(mergeBrandingConfig(junk, junk)).toBeNull();
    expect(mergeBrandingConfig(junk, ORG_BRANDING)).toEqual(ORG_BRANDING);
    expect(mergeBrandingConfig(OWN_LABELS, junk)).toEqual(OWN_LABELS);
  });
});
