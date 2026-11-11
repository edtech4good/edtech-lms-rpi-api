import { Op } from "sequelize";
import { CONTENT_TRANSLATIONS_HEADER_VALUE, sourceHash } from "src/constants/content-translations";
import { contenttranslations } from "src/models/data-models/contenttranslations";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import { studentawards } from "src/models/data-models/studentawards";
import { LEARNER, ORG_X, asJson, installContentFakes } from "src/test-support/content-routes-fixture";
import { StudentController } from "./student.controller";

/**
 * GET student/awards and GET student/awards/overview through the real controller over the content fixture
 * (src/test-support/content-routes-fixture.ts): the names carry their translations when the request asks for them
 * (as GET student/progress/summary does), and the response is exactly what it was before when it does not.
 * Translated text is a Latin placeholder.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ON = CONTENT_TRANSLATIONS_HEADER_VALUE;
const tr = (tablename: string, rowid: string, field: string, base: string, text: string): Row => ({
  organisationid: ORG_X, tablename, rowid, field, subkey: "", language: "km", text, sourcehash: sourceHash(base),
});
const day = (d: number) => new Date(Date.UTC(2026, 10, d));

let awards: Row[];
beforeEach(() => {
  installContentFakes();
  awards = [
    { studentawardid: "a1", studentid: "s1", levelid: "lv1", gradeid: "g1", curid: "c1", earnedat: day(7), earnedat_approximate: false },
    { studentawardid: "a2", studentid: "s2", levelid: "lv1", gradeid: "g1", curid: "c1", earnedat: day(8), earnedat_approximate: false },
  ];
  const stored = [
    tr("curriculums", "c1", "curriculumname", "Mathematics", "KM Mathematics"),
    tr("grades", "g1", "gradename", "Grade One", "KM Grade One"),
    tr("levels", "lv1", "levelname", "Level A", "KM Level A"),
  ];
  jest.spyOn(studentawards, "findAll").mockImplementation((async (o: { where: Row }) =>
    awards.filter((a) => Object.entries(o.where).every(([k, v]) => (v && typeof v === "object" ? (v as Record<symbol, unknown[]>)[Op.in as unknown as symbol]?.includes(a[k]) : a[k] === v)))) as never);
  jest.spyOn(schools, "findOne").mockResolvedValue({ schoolid: "school-x", brandingconfig: null } as never);
  jest.spyOn(contenttranslations, "findAll").mockImplementation((async (o: { where: Row }) =>
    stored.filter((t) => t.tablename === o.where.tablename && o.where.rowid[Op.in as unknown as symbol].includes(t.rowid))) as never);
  jest.spyOn(organisations, "scope").mockReturnValue(organisations as never);
  jest.spyOn(organisations, "findOne").mockImplementation((async () => ({ contentlanguage: "en" })) as never);
});
afterEach(() => jest.restoreAllMocks());

describe("GET student/awards", () => {
  it("carries the level, grade and curriculum name translations, and the content language, when asked", async () => {
    const body = asJson(await new StudentController().getStudentAwards(LEARNER, ON));
    expect(body.contentlanguage).toBe("en");
    expect(body.data.map((a: Row) => a.studentawardid)).toEqual(["a1"]);
    expect(body.data[0].translations).toEqual({ km: { levelname: "KM Level A", gradename: "KM Grade One", curriculumname: "KM Mathematics" } });
    expect(body.data[0].levelname).toBe("Level A"); // the base text is still the base text
  });

  it("answers exactly what it did before without the header", async () => {
    const body = asJson(await new StudentController().getStudentAwards(LEARNER));
    expect(Object.keys(body).sort()).toEqual(["data", "error"]);
    expect(Object.keys(body.data[0]).sort()).toEqual(["curid", "curriculumname", "earnedat", "earnedat_approximate", "gradeid", "gradename", "levelid", "levelname", "levelorder", "studentawardid"]);
    expect(contenttranslations.findAll).not.toHaveBeenCalled();
  });
});

describe("GET student/awards/overview", () => {
  it("answers the learner's own overview in the progress summary's envelope, translated when asked", async () => {
    const body = asJson(await new StudentController().getStudentAwardsOverview(LEARNER, ON));
    expect(body.error).toBe(false);
    expect(body.contentlanguage).toBe("en");
    const cur = body.data.curricula[0];
    expect(cur).toMatchObject({ curid: "c1", curriculumname: "Mathematics", translations: { km: { curriculumname: "KM Mathematics" } } });
    expect(cur.grades[0].translations).toEqual({ km: { gradename: "KM Grade One" } });
    expect(cur.grades[0].levels[0]).toMatchObject({ levelid: "lv1", progress: 0, awardable: true, award: { studentawardid: "a1" }, translations: { km: { levelname: "KM Level A" } } });
    expect(body.data.earnedelsewhere).toEqual([]);
  });

  it("answers without translations or content language when the header is absent", async () => {
    const body = asJson(await new StudentController().getStudentAwardsOverview(LEARNER));
    expect(Object.keys(body).sort()).toEqual(["data", "error"]);
    expect(JSON.stringify(body)).not.toContain("translations");
  });
});
