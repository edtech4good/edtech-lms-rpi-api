import { Op } from "sequelize";
import { sourceHash } from "src/constants/content-translations";
import * as contentAccess from "./content-access";
import { ContentTranslations } from "./content-translations";
import { StudentBusiness } from "./student.business";
import { contenttranslations } from "src/models/data-models/contenttranslations";
import { organisations } from "src/models/data-models/organisations";
import { schools } from "src/models/data-models/school";
import {
  curriculums,
  grades,
  lessonquizquestions,
  lessonquizzes,
  lessons,
  levelquizquestions,
  levels,
  studentcertificates,
  studentprogress,
} from "src/models/data-models/init-models";

/**
 * StudentBusiness.getcertificatesoverview backs the learner app's Certificates section. In-memory tables, no database:
 * every fake applies the `where` it is given (so a query that forgets the learner, or a revoked certificate, returns it here as
 * it would in MySQL). The tree is the awards overview's own selection (getenrolledtree). Nothing here ran on MySQL.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const matches = (row: Row, where: Row): boolean =>
  Object.entries(where ?? {}).every(([key, cond]) => {
    if (cond === null) return row[key] === null || row[key] === undefined;
    const list = Array.isArray(cond) ? cond : cond && typeof cond === "object" ? (cond as Record<symbol, unknown[]>)[Op.in as unknown as symbol] : undefined;
    return list ? list.includes(row[key]) : row[key] === cond;
  });

const day = (d: number) => new Date(Date.UTC(2026, 10, d));
const LESSONQUIZ = 2;
const LEVELQUIZ = 3;

describe("StudentBusiness.getcertificatesoverview", () => {
  const user = { studentid: "s1", schoolid: "sch1", organisationid: "org1", curriculumids: ["c1", "c2", "c3"] } as never;
  let curs: Row[];
  let grs: Row[];
  let lvs: Row[];
  let lsn: Row[];
  let quizzes: Row[];
  let quizQuestions: Row[];
  let levelQuizQuestions: Row[];
  let attempts: Row[];
  let certificates: Row[];
  let recognitionRows: Row[];
  let branding: unknown;
  let stored: Row[];
  let queries: string[];
  let writes: string[];

  beforeEach(() => {
    curs = [
      { curriculumid: "c1", curriculumname: "Design" },
      { curriculumid: "c2", curriculumname: "Craft" },
      { curriculumid: "c3", curriculumname: "Plain" },
    ];
    grs = [
      { gradeid: "g2", curriculumid: "c1", gradename: "Grade two", gradeorder: 2, gradestatus: true, isdeleted: false },
      { gradeid: "g1", curriculumid: "c1", gradename: "Grade one", gradeorder: 1, gradestatus: true, isdeleted: false },
      { gradeid: "g3", curriculumid: "c2", gradename: "Craft grade", gradeorder: 1, gradestatus: true, isdeleted: false },
      { gradeid: "g4", curriculumid: "c3", gradename: "Plain grade", gradeorder: 1, gradestatus: true, isdeleted: false },
    ];
    lvs = [
      { levelid: "l2", gradeid: "g1", levelname: "Level two", levelorder: 2, levelstatus: true, isdeleted: false },
      { levelid: "l1", gradeid: "g1", levelname: "Level one", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "l3", gradeid: "g2", levelname: "Level three", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "off", gradeid: "g1", levelname: "Switched off", levelorder: 3, levelstatus: false, isdeleted: false },
      { levelid: "l4", gradeid: "g3", levelname: "Craft one", levelorder: 1, levelstatus: true, isdeleted: false },
      { levelid: "l5", gradeid: "g4", levelname: "Plain one", levelorder: 1, levelstatus: true, isdeleted: false },
    ];
    // one live lesson per level, each with one lesson quiz that has an active question
    lsn = lvs.map((l) => ({ lessonid: `les-${l.levelid}`, levelid: l.levelid, lessonname: `Lesson of ${l.levelname}`, lessonorder: 1, lessonstatus: true, isdeleted: false }));
    quizzes = lvs.map((l) => ({ lessonquizid: `q-${l.levelid}`, lessonid: `les-${l.levelid}`, lessonquizname: `Quiz of ${l.levelname}`, lessonquizorder: 1, lessonquizstatus: true }));
    quizQuestions = lvs.map((l) => ({ lessonquizid: `q-${l.levelid}`, lessonquizquestionstatus: true }));
    levelQuizQuestions = [];
    attempts = [];
    certificates = [];
    recognitionRows = [
      { curriculumid: "c1", levelrecognition: "certificate", graderecognition: "none", curriculumrecognition: "none" },
      { curriculumid: "c2", levelrecognition: "none", graderecognition: "certificate", curriculumrecognition: "certificate" },
      { curriculumid: "c3", levelrecognition: "award", graderecognition: "none", curriculumrecognition: "none" },
    ];
    branding = null;
    stored = [];
    queries = [];
    writes = [];
    const count = (name: string) => queries.push(name);
    const sorted = (rows: Row[], keys: string[]) => [...rows].sort((a, b) => keys.map((k) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)).find((c) => c !== 0) ?? 0);
    jest.spyOn(contentAccess, "enrolledCurriculumIds").mockResolvedValue(["c1", "c2", "c3"]);
    jest.spyOn(curriculums, "scope").mockImplementation(((name: string) => {
      expect(name).toBe("withRecognition");
      return {
        findAll: async (o: { where: Row; attributes: string[] }) => {
          count("recognition");
          return recognitionRows.filter((r) => matches(r, o.where)).map((r) => Object.fromEntries(o.attributes.map((a) => [a, r[a]])));
        },
      };
    }) as never);
    jest.spyOn(curriculums, "findAll").mockImplementation((async () => (count("curriculums"), sorted(curs, ["curriculumname"]))) as never);
    jest.spyOn(grades, "findAll").mockImplementation((async (o: { where: Row }) => (count("grades"), sorted(grs.filter((g) => matches(g, o.where)), ["gradeorder", "gradename", "gradeid"]))) as never);
    jest.spyOn(levels, "findAll").mockImplementation((async (o: { where: Row }) => (count("levels"), sorted(lvs.filter((l) => matches(l, o.where)), ["levelorder", "levelname", "levelid"]))) as never);
    jest.spyOn(lessons, "findAll").mockImplementation((async (o: { where: Row }) => (count("lessons"), lsn.filter((l) => matches(l, o.where)))) as never);
    jest.spyOn(lessonquizzes, "findAll").mockImplementation((async (o: { where: Row }) => (count("lessonquizzes"), quizzes.filter((q) => matches(q, o.where)))) as never);
    jest.spyOn(lessonquizquestions, "findAll").mockImplementation((async (o: { where: Row }) => (count("lessonquizquestions"), quizQuestions.filter((q) => matches(q, o.where)))) as never);
    jest.spyOn(levelquizquestions, "findAll").mockImplementation((async (o: { where: Row }) => (count("levelquizquestions"), levelQuizQuestions.filter((q) => matches(q, o.where)))) as never);
    jest.spyOn(studentprogress, "findAll").mockImplementation((async (o: { where: Row }) => (count("studentprogress"), attempts.filter((a) => matches(a, o.where)))) as never);
    jest.spyOn(studentcertificates, "findAll").mockImplementation((async (o: { where: Row }) => (count("studentcertificates"), certificates.filter((c) => matches(c, o.where)).sort((a, b) => b.issuedat - a.issuedat))) as never);
    jest.spyOn(schools, "findOne").mockImplementation((async () => (count("schools"), { schoolid: "sch1", brandingconfig: branding })) as never);
    jest.spyOn(contenttranslations, "findAll").mockImplementation((async (o: { where: Row }) => (count("translations"), stored.filter((t) => matches(t, { tablename: o.where.tablename, rowid: o.where.rowid })))) as never);
    jest.spyOn(organisations, "scope").mockReturnValue({ findOne: async () => ({ contentlanguage: "en" }) } as never);
    for (const model of [studentcertificates, studentprogress, contenttranslations]) {
      for (const method of ["create", "bulkCreate", "update", "destroy", "upsert"] as const) {
        jest.spyOn(model as never, method as never).mockImplementation((async () => (writes.push(`${(model as { name: string }).name}.${method}`), 0)) as never);
      }
    }
  });

  afterEach(() => jest.restoreAllMocks());

  const certificate = (id: string, scope: string, scopeid: string, extra: Row = {}): Row => ({
    certificateid: id, shortcode: "ABCD-1234", studentid: "s1", curriculumid: scope === "curriculum" ? scopeid : scope === "grade" ? (grs.find((g) => g.gradeid === scopeid) ?? {}).curriculumid : "c1",
    scope, scopeid, issuedat: day(5), revokedat: null, checkurl: "https://check.example.org/v/ABCD-1234", snapshot: {}, ...extra,
  });
  const pass = (levelid: string, extra: Row = {}): Row => ({ studentid: "s1", progresstype: LESSONQUIZ, studentprogressreferenceid: `q-${levelid}`, resultpercentage: 90, verified: true, ...extra });
  const itemsOf = (body: { curricula: Row[] }, curriculumid: string): Row[] => body.curricula.find((c) => c.curriculumid === curriculumid)?.items ?? [];
  const ask = (u: unknown = user, translations?: ContentTranslations) => new StudentBusiness().getcertificatesoverview(u as never, translations);

  // ----- (b) which items -----------------------------------------------------------------------------------------------
  it("lists an item for each live level of a level-tier curriculum, in grade then level order, and leaves out a switched-off level and a curriculum with no certificate tier", async () => {
    const body = await ask();
    expect(body.curricula.map((c) => [c.curriculumid, c.curriculumname])).toEqual([
      ["c2", "Craft"],
      ["c1", "Design"],
    ]);
    expect(itemsOf(body, "c1").map((i) => [i.scope, i.scopeid, i.name])).toEqual([
      ["level", "l1", "Level one"],
      ["level", "l2", "Level two"],
      ["level", "l3", "Level three"],
    ]);
    expect(body.curricula.some((c) => c.curriculumid === "c3")).toBe(false);
  });

  it("lists the grades of a grade-tier curriculum and the curriculum itself for the curriculum tier, grade items first", async () => {
    const body = await ask();
    expect(itemsOf(body, "c2").map((i) => [i.scope, i.scopeid, i.name])).toEqual([
      ["grade", "g3", "Craft grade"],
      ["curriculum", "c2", "Craft"],
    ]);
  });

  it("answers an empty list when no curriculum has a certificate tier, and for a caller with no learner record", async () => {
    recognitionRows = recognitionRows.map((r) => ({ ...r, levelrecognition: "award", graderecognition: "none", curriculumrecognition: "none" }));
    expect(await ask()).toEqual({ curricula: [] });
    expect(await ask({ ...(user as object), studentid: undefined })).toEqual({ curricula: [] });
  });

  it("answers the same fields on every item, and a whole body for one", async () => {
    attempts = [pass("l1")];
    const body = await ask();
    expect(itemsOf(body, "c1")[0]).toEqual({
      scope: "level",
      scopeid: "l1",
      name: "Level one",
      tierlabel: "Level",
      status: "ready",
      reasons: [],
      quizcount: 1,
      passedcount: 1,
      certificate: null,
    });
  });

  it("labels each item with the school's singular tier label, and leaves it out when the school is not found", async () => {
    branding = { labelPreset: "company" };
    const labelled = await ask();
    expect(itemsOf(labelled, "c1")[0].tierlabel).toBe("Module");
    expect(itemsOf(labelled, "c2").map((i) => i.tierlabel)).toEqual(["Track", "Programme"]);
    (schools.findOne as jest.Mock).mockResolvedValue(null);
    const unlabelled = await ask();
    expect(itemsOf(unlabelled, "c1")[0]).not.toHaveProperty("tierlabel");
  });

  // ----- (c) statuses --------------------------------------------------------------------------------------------------
  it("shows an unrevoked certificate as issued with its fields, checkurl included, and does not compute eligibility for it", async () => {
    certificates = [certificate("cert-1", "level", "l1")];
    const body = await ask();
    expect(itemsOf(body, "c1")[0]).toEqual({
      scope: "level",
      scopeid: "l1",
      name: "Level one",
      tierlabel: "Level",
      status: "issued",
      reasons: [],
      quizcount: 0,
      passedcount: 0,
      certificate: { certificateid: "cert-1", shortcode: "ABCD-1234", issuedat: day(5), checkurl: "https://check.example.org/v/ABCD-1234" },
    });
    // the other levels are judged as ever
    expect(itemsOf(body, "c1").map((i) => i.status)).toEqual(["issued", "not_yet", "not_yet"]);
  });

  it("gives a null checkurl through when central had none", async () => {
    certificates = [certificate("cert-1", "level", "l1", { checkurl: null })];
    expect(itemsOf(await ask(), "c1")[0].certificate).toEqual({ certificateid: "cert-1", shortcode: "ABCD-1234", issuedat: day(5), checkurl: null });
  });

  it("treats a revoked certificate as if there were none: the item is judged by the learner's quizzes, and nothing of the revocation shows", async () => {
    certificates = [certificate("cert-1", "level", "l1", { revokedat: day(6) })];
    attempts = [pass("l1")];
    const body = await ask();
    expect(itemsOf(body, "c1")[0]).toMatchObject({ status: "ready", certificate: null });
    expect(JSON.stringify(body)).not.toContain("cert-1");
    expect(JSON.stringify(body)).not.toContain("revok");
  });

  it("uses the learner's newest valid certificate when there are two for one scope", async () => {
    certificates = [certificate("old", "level", "l1", { issuedat: day(2) }), certificate("new", "level", "l1", { issuedat: day(9) })];
    expect(itemsOf(await ask(), "c1")[0].certificate?.certificateid).toBe("new");
  });

  it("ready: every quiz in scope passed by a result the server marked", async () => {
    attempts = [pass("l1"), pass("l2")];
    const body = await ask();
    expect(itemsOf(body, "c1").map((i) => [i.scopeid, i.status])).toEqual([["l1", "ready"], ["l2", "ready"], ["l3", "not_yet"]]);
  });

  it("not_yet: a quiz not taken, or below the mark, with what is left", async () => {
    attempts = [pass("l1", { resultpercentage: 60 })];
    const [first, second] = itemsOf(await ask(), "c1");
    expect(first).toMatchObject({
      status: "not_yet",
      quizcount: 1,
      passedcount: 0,
      reasons: [{ quiz: { id: "q-l1", kind: "lesson", name: "Quiz of Level one" }, level: { id: "l1", name: "Level one" }, lesson: { id: "les-l1", name: "Lesson of Level one" }, state: "below", bestpercent: 60 }],
    });
    expect(second.reasons).toEqual([expect.objectContaining({ state: "not_taken", bestpercent: null })]);
  });

  it("cant_check: a result at the mark that the server did not mark, for the grade and the curriculum item alike", async () => {
    attempts = [pass("l4", { verified: false })];
    const body = await ask();
    expect(itemsOf(body, "c2").map((i) => [i.scope, i.status])).toEqual([["grade", "cant_check"], ["curriculum", "cant_check"]]);
    expect(itemsOf(body, "c2")[0].reasons).toEqual([expect.objectContaining({ state: "unverified", bestpercent: 90 })]);
  });

  it("not_yet with no_quizzes when a scope has no quiz that can be taken", async () => {
    quizQuestions = [];
    const body = await ask();
    expect(itemsOf(body, "c1")[0]).toMatchObject({ status: "not_yet", quizcount: 0, passedcount: 0, reasons: [{ reason: "no_quizzes" }] });
  });

  it("counts a level quiz with the lesson quizzes of its level", async () => {
    levelQuizQuestions = [{ levelid: "l1", levelquizquestionstatus: true }];
    attempts = [pass("l1")];
    const first = itemsOf(await ask(), "c1")[0];
    expect(first).toMatchObject({ status: "not_yet", quizcount: 2, passedcount: 1 });
    attempts = [pass("l1"), { studentid: "s1", progresstype: LEVELQUIZ, studentprogressreferenceid: "l1", resultpercentage: 100, verified: true }];
    expect(itemsOf(await ask(), "c1")[0]).toMatchObject({ status: "ready", quizcount: 2, passedcount: 2 });
  });

  // ----- (d) only this learner -----------------------------------------------------------------------------------------
  it("never shows another learner's certificate or attempts", async () => {
    certificates = [certificate("theirs", "level", "l1", { studentid: "s2" })];
    attempts = [pass("l1", { studentid: "s2" }), pass("l2", { studentid: "s2" })];
    const body = await ask();
    expect(JSON.stringify(body)).not.toContain("theirs");
    expect(itemsOf(body, "c1").map((i) => i.status)).toEqual(["not_yet", "not_yet", "not_yet"]);
    const forThem = await ask({ ...(user as object), studentid: "s2" });
    expect(itemsOf(forThem, "c1").map((i) => [i.status, i.certificate?.certificateid ?? null])).toEqual([["issued", "theirs"], ["ready", null], ["not_yet", null]]);
  });

  // ----- (e) translations ----------------------------------------------------------------------------------------------
  const tr = (tablename: string, rowid: string, field: string, base: string, text: string): Row => ({ organisationid: "org1", tablename, rowid, field, subkey: "", language: "km", text, sourcehash: sourceHash(base) });

  it("translates the names when the request asks for it, and carries nothing of the kind without", async () => {
    stored = [
      tr("curriculums", "c2", "curriculumname", "Craft", "KM Craft"),
      tr("grades", "g3", "gradename", "Craft grade", "KM Craft grade"),
      tr("levels", "l1", "levelname", "Level one", "KM Level one"),
      tr("levels", "l2", "levelname", "Changed since", "KM stale"),
    ];
    const asked = await ask(user, ContentTranslations.from("1", user as never));
    expect(asked.curricula.find((c) => c.curriculumid === "c2")?.translations).toEqual({ km: { curriculumname: "KM Craft" } });
    expect(itemsOf(asked, "c2").map((i) => i.translations)).toEqual([{ km: { gradename: "KM Craft grade" } }, { km: { curriculumname: "KM Craft" } }]);
    expect(itemsOf(asked, "c1").map((i) => i.translations)).toEqual([{ km: { levelname: "KM Level one" } }, {}, {}]);
    const plain = await ask();
    expect(JSON.stringify(plain)).not.toContain("translations");
    expect(JSON.stringify(plain)).not.toContain("KM ");
  });

  // ----- (f) read-only, fixed query count -------------------------------------------------------------------------------
  it("writes nothing", async () => {
    certificates = [certificate("cert-1", "level", "l1")];
    attempts = [pass("l2")];
    await ask();
    await ask(user, ContentTranslations.from("1", user as never));
    expect(writes).toEqual([]);
  });

  it("asks the same number of questions however many levels, grades and curricula there are", async () => {
    attempts = [pass("l1")];
    await ask();
    const small = [...queries];
    queries = [];
    // more content: another grade with three levels, each with a lesson and a quiz, and another curriculum with a certificate tier
    grs.push({ gradeid: "g9", curriculumid: "c1", gradename: "Grade nine", gradeorder: 9, gradestatus: true, isdeleted: false });
    for (const n of [91, 92, 93]) {
      lvs.push({ levelid: `l${n}`, gradeid: "g9", levelname: `Level ${n}`, levelorder: n, levelstatus: true, isdeleted: false });
      lsn.push({ lessonid: `les-l${n}`, levelid: `l${n}`, lessonname: `Lesson ${n}`, lessonorder: 1, lessonstatus: true, isdeleted: false });
      quizzes.push({ lessonquizid: `q-l${n}`, lessonid: `les-l${n}`, lessonquizname: `Quiz ${n}`, lessonquizorder: 1, lessonquizstatus: true });
      quizQuestions.push({ lessonquizid: `q-l${n}`, lessonquizquestionstatus: true });
    }
    certificates = [certificate("cert-1", "level", "l1")];
    await ask();
    expect(queries).toEqual(small);
    expect(queries.length).toBeLessThanOrEqual(14);
  });
});
