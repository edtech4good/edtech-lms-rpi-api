import { Op } from "sequelize";
import { sourceHash } from "src/constants/content-translations";
import * as contentAccess from "./content-access";
import { ContentTranslations } from "./content-translations";
import { StudentBusiness } from "./student.business";
import { contenttranslations } from "src/models/data-models/contenttranslations";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { curriculums, grades, lessons, levels, studentawards, studentlessonsprogress, studentlevelsprogress } from "src/models/data-models/init-models";

/**
 * StudentBusiness.getawardsoverview backs the learner app's Awards screen. In-memory tables, no database: every
 * fake applies the `where` it is given (so a query that forgets the learner returns another learner's rows here as it
 * would in MySQL). The tree (curricula, grades, levels, order) is the progress summary's own selection.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where).every(([key, cond]) => {
    const list = Array.isArray(cond) ? cond : cond && typeof cond === "object" ? (cond as Record<symbol, unknown[]>)[Op.in as unknown as symbol] : undefined;
    return list ? list.includes(row[key]) : row[key] === cond;
  });

const day = (d: number) => new Date(Date.UTC(2026, 10, d));

describe("StudentBusiness.getawardsoverview", () => {
  const user = { studentid: "s1", schoolid: "sch1", organisationid: "org1", curriculumids: ["c1", "c2"] } as never;
  let curs: Row[];
  let grs: Row[];
  let lvs: Row[];
  let progress: Row[];
  let awards: Row[];
  let branding: unknown;
  let stored: Row[];
  let counts: number;
  let recognitionRows: Row[];
  let recognitionQueries: Row[];

  beforeEach(() => {
    curs = [
      { curriculumid: "c1", curriculumname: "Design" },
      { curriculumid: "c2", curriculumname: "Craft" },
    ];
    grs = [
      { gradeid: "g2", curriculumid: "c1", gradename: "Grade two", gradeorder: 2, gradestatus: true, isdeleted: false },
      { gradeid: "g1", curriculumid: "c1", gradename: "Grade one", gradeorder: 1, gradestatus: true, isdeleted: false },
      { gradeid: "g3", curriculumid: "c2", gradename: "Craft grade", gradeorder: 1, gradestatus: true, isdeleted: false },
    ];
    lvs = [
      { levelid: "l1", gradeid: "g1", levelname: "Level one", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "l2", gradeid: "g1", levelname: "Level two", levelorder: 2, levelstatus: true, isdeleted: false },
      { levelid: "l3", gradeid: "g2", levelname: "Only level", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "l4", gradeid: "g3", levelname: "Craft one", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "l5", gradeid: "g3", levelname: "Craft two", levelorder: 2, levelstatus: true, isdeleted: false },
      { levelid: "old", gradeid: "g1", levelname: "Retired", levelorder: 9, levelstatus: false, isdeleted: false },
    ];
    progress = [];
    awards = [];
    branding = null;
    stored = [];
    counts = 0;
    recognitionRows = [
      { curriculumid: "c1", levelrecognition: "award", graderecognition: "certificate", curriculumrecognition: "none" },
      { curriculumid: "c2", levelrecognition: "award", graderecognition: "none", curriculumrecognition: "certificate" },
    ];
    recognitionQueries = [];
    const sorted = (rows: Row[], keys: string[]) => [...rows].sort((a, b) => keys.map((k) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)).find((c) => c !== 0) ?? 0);
    jest.spyOn(contentAccess, "enrolledCurriculumIds").mockResolvedValue(["c1", "c2"]);
    // the recognition columns are read only through their own scope
    jest.spyOn(curriculums, "scope").mockImplementation(((name: string) => {
      expect(name).toBe("withRecognition");
      return {
        findAll: async (o: { where: Row; attributes: string[] }) => {
          recognitionQueries.push(o);
          return recognitionRows.filter((r) => matches(r, o.where)).map((r) => Object.fromEntries(o.attributes.map((a) => [a, r[a]])));
        },
      };
    }) as never);
    jest.spyOn(curriculums, "findAll").mockImplementation((async () => sorted(curs, ["curriculumname"])) as never);
    jest.spyOn(grades, "findAll").mockImplementation((async (o: { where: Row }) => sorted(grs.filter((g) => matches(g, o.where)), ["gradeorder", "gradename", "gradeid"])) as never);
    jest.spyOn(levels, "findAll").mockImplementation((async (o: { where: Row }) => sorted(lvs.filter((l) => matches(l, o.where)), ["levelorder", "levelname", "levelid"])) as never);
    jest.spyOn(levels, "count").mockImplementation((async (o: { where: Row; group?: string[] }) => {
      counts += 1;
      const live = lvs.filter((l) => matches(l, o.where));
      if (!o.group) return live.length;
      return [...new Set(live.map((l) => l.gradeid))].map((gradeid) => ({ gradeid, count: live.filter((l) => l.gradeid === gradeid).length }));
    }) as never);
    jest.spyOn(lessons, "findAll").mockResolvedValue([] as never);
    jest.spyOn(studentlessonsprogress, "findAll").mockResolvedValue([] as never);
    jest.spyOn(schools, "findOne").mockImplementation((async () => ({ schoolid: "sch1", brandingconfig: branding })) as never);
    jest.spyOn(studentlevelsprogress, "findAll").mockImplementation((async (o: { where: Row }) => progress.filter((p) => matches(p, o.where))) as never);
    jest.spyOn(studentawards, "findAll").mockImplementation((async (o: { where: Row }) => awards.filter((a) => matches(a, o.where))) as never);
    jest.spyOn(contenttranslations, "findAll").mockImplementation((async (o: { where: Row }) => stored.filter((t) => matches(t, o.where))) as never);
    jest.spyOn(organisations, "scope").mockReturnValue({ findOne: async () => ({ contentlanguage: "en" }) } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  const award = (id: string, levelid: string, studentid = "s1", extra: Row = {}): Row => {
    const level = lvs.find((l) => l.levelid === levelid);
    const grade = grs.find((g) => g.gradeid === (level?.gradeid ?? "g1"));
    return { studentawardid: id, studentid, levelid, gradeid: level?.gradeid ?? "g1", curid: grade?.curriculumid ?? "c1", earnedat: day(5), earnedat_approximate: false, ...extra };
  };
  const levelsOf = (body: { curricula: Row[] }) => body.curricula.flatMap((c) => c.grades.flatMap((g: Row) => g.levels as Row[]));
  const levelById = (body: { curricula: Row[] }, id: string) => levelsOf(body).find((l) => l.levelid === id)!;

  it("lists exactly the summary's curricula, grades and levels, in its order (no retired level)", async () => {
    const overview = await new StudentBusiness().getawardsoverview(user);
    const summary = await new StudentBusiness().getprogresssummary(user);
    expect(overview.curricula.map((c) => [c.curid, c.grades.map((g) => [g.gradeid, g.levels.map((l) => l.levelid)])])).toEqual(
      summary.curricula.map((c) => [c.curriculumid, c.grades.map((g) => [g.gradeid, g.levels.map((l) => l.levelid)])]),
    );
    expect(overview.curricula.map((c) => [c.curid, c.curriculumname, c.grades.map((g) => [g.gradeid, g.levels.map((l) => l.levelid)])])).toEqual([
      ["c2", "Craft", [["g3", ["l4", "l5"]]]],
      ["c1", "Design", [["g1", ["l1", "l2"]], ["g2", ["l3"]]]],
    ]);
    expect(overview.earnedelsewhere).toEqual([]);
  });

  it("takes progress from the level progress row, 0 without one, and only the learner's own", async () => {
    progress = [
      { studentid: "s1", levelid: "l1", progress: 62.5 },
      { studentid: "s2", levelid: "l2", progress: 99 },
    ];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(levelById(body, "l1").progress).toBe(62.5);
    expect(levelById(body, "l2").progress).toBe(0);
  });

  it("carries an earned level's award, and no award on the others", async () => {
    awards = [award("a1", "l1", "s1", { earnedat: day(7), earnedat_approximate: true })];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(levelById(body, "l1").award).toEqual({ studentawardid: "a1", earnedat: day(7), earnedat_approximate: true });
    expect(levelById(body, "l2").award).toBeNull();
    expect(levelById(body, "l1").awardable).toBe(true);
  });

  it("marks a hidden single-item level not awardable, still shows an award earned before the switch, and counts levels in one grouped query", async () => {
    branding = { hideSingleItemTiers: true };
    awards = [award("a3", "l3")];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(levelById(body, "l3")).toMatchObject({ awardable: false, award: { studentawardid: "a3" } });
    expect(levelById(body, "l1").awardable).toBe(true); // two live levels: shown as a tier
    expect(levelById(body, "l4").awardable).toBe(true);
    expect(counts).toBe(1); // one count for every grade, not one per level
    branding = null;
    const off = await new StudentBusiness().getawardsoverview(user);
    expect(levelById(off, "l3").awardable).toBe(true);
  });

  it("gives each curriculum its stored recognition { level, grade, curriculum }, read in one query through the scope", async () => {
    recognitionRows = [
      { curriculumid: "c1", levelrecognition: "certificate", graderecognition: "none", curriculumrecognition: "certificate" },
      { curriculumid: "c2", levelrecognition: "award", graderecognition: "certificate", curriculumrecognition: "none" },
    ];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(body.curricula.map((c) => [c.curid, c.recognition])).toEqual([
      ["c2", { level: "award", grade: "certificate", curriculum: "none" }],
      ["c1", { level: "certificate", grade: "none", curriculum: "certificate" }],
    ]);
    expect(recognitionQueries).toHaveLength(1);
    expect(recognitionQueries[0].attributes).toEqual(["curriculumid", "levelrecognition", "graderecognition", "curriculumrecognition"]);
  });

  it.each([["none"], ["certificate"]])("a level is not awardable when its curriculum's levelrecognition is %s, and an earned award is still listed", async (setting) => {
    recognitionRows[0].levelrecognition = setting; // c1 (Design); c2 (Craft) stays 'award'
    awards = [award("a1", "l1"), award("a9", "old", "s1", { earnedat: day(9) })];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(levelsOf(body).map((l) => [l.levelid, l.awardable])).toEqual([["l4", true], ["l5", true], ["l1", false], ["l2", false], ["l3", false]]);
    expect(levelById(body, "l1").award).toMatchObject({ studentawardid: "a1" });
    expect(body.earnedelsewhere.map((a) => a.studentawardid)).toEqual(["a9"]);
  });

  it("lists an award on a level that is no longer live in earnedelsewhere, not in the curricula", async () => {
    awards = [award("a1", "l1"), award("a9", "old", "s1", { earnedat: day(9) }), award("a8", "gone", "s1", { earnedat: day(8), gradeid: "g1", curid: "c1" })];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(body.earnedelsewhere.map((a) => a.studentawardid)).toEqual(["a9", "a8"]);
    expect(body.earnedelsewhere[0]).toMatchObject({ levelname: "Retired", gradename: "Grade one", curriculumname: "Design" });
    expect(levelsOf(body).map((l) => l.award?.studentawardid).filter(Boolean)).toEqual(["a1"]);
  });

  it("never shows another learner's award", async () => {
    awards = [award("b1", "l1", "s2"), award("b2", "old", "s2"), award("a1", "l2")];
    const body = await new StudentBusiness().getawardsoverview(user);
    expect(levelById(body, "l1").award).toBeNull();
    expect(body.earnedelsewhere).toEqual([]);
    expect(levelsOf(body).map((l) => l.award?.studentawardid).filter(Boolean)).toEqual(["a1"]);
  });

  describe("translations", () => {
    const tr = (tablename: string, rowid: string, field: string, base: string, text: string, over: Row = {}): Row => ({
      organisationid: "org1", tablename, rowid, field, subkey: "", language: "km", text, sourcehash: sourceHash(base), ...over,
    });

    it("adds the translations of every curriculum, grade and level name when the header asks, and the content language at the root", async () => {
      stored = [
        tr("curriculums", "c1", "curriculumname", "Design", "KM Design"),
        tr("grades", "g1", "gradename", "Grade one", "KM Grade one"),
        tr("levels", "l1", "levelname", "Level one", "KM Level one"),
        tr("levels", "l2", "levelname", "OLD base", "KM stale"), // stale: the base text has changed
        tr("levels", "l1", "levelname", "Level one", "Other org", { organisationid: "org2" }),
      ];
      awards = [award("a9", "old")];
      stored.push(tr("levels", "old", "levelname", "Retired", "KM Retired"), tr("grades", "g1", "gradename", "Grade one", "KM Grade one"));
      const t = ContentTranslations.from("1", { organisationid: "org1" } as never);
      const body = await new StudentBusiness().getawardsoverview(user, t);
      const design = body.curricula.find((c) => c.curid === "c1")!;
      expect(design.translations).toEqual({ km: { curriculumname: "KM Design" } });
      expect(design.grades.find((g) => g.gradeid === "g1")!.translations).toEqual({ km: { gradename: "KM Grade one" } });
      expect(levelById(body, "l1").translations).toEqual({ km: { levelname: "KM Level one" } });
      expect(levelById(body, "l2").translations).toEqual({}); // stale
      expect(body.curricula.find((c) => c.curid === "c2")!.translations).toEqual({});
      expect(body.earnedelsewhere[0].translations).toEqual({ km: { levelname: "KM Retired", gradename: "KM Grade one", curriculumname: "KM Design" } });
    });

    it("adds nothing without the header", async () => {
      stored = [tr("levels", "l1", "levelname", "Level one", "KM Level one")];
      const body = await new StudentBusiness().getawardsoverview(user);
      expect(JSON.stringify(body)).not.toContain("translations");
      expect(contenttranslations.findAll).not.toHaveBeenCalled();
    });
  });

  it("answers a body that serialises under the route's envelope", async () => {
    progress = [{ studentid: "s1", levelid: "l1", progress: 62.5 }];
    awards = [award("a1", "l1", "s1", { earnedat: day(7) }), award("a9", "old", "s1", { earnedat: day(5) })];
    const body = await new StudentBusiness().getawardsoverview(user);
    process.stdout.write(`EXAMPLE ${JSON.stringify({ data: body, error: false })}\n`);
    expect(Object.keys(body)).toEqual(["curricula", "earnedelsewhere"]);
  });
});
