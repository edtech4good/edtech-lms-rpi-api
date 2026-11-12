import { Sequelize } from "sequelize";
import { Config } from "src/config";
import { importCertificates, parseCertificatesPayload } from "src/business/certificates-import";
import { initModels } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";

/**
 * `PUT /import/certificates`'s business code against a real MySQL: upsert, a later revokedat on the same id,
 * replaceForStudents deleting only the missing ones, and the JSON snapshot read back. Runs ONLY when
 * STUDENTCERTIFICATES_IMPORT_DB_SPEC=1 is set AND the configured database name contains "scratch" (it creates and drops a real
 * `studentcertificates` table, through the migration). `students` is a TEMPORARY table (visible to this one connection only).
 * The pool holds ONE connection, so a read made off the import's transaction would wait forever. It is never run by the default
 * test command.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261112130000-create-studentcertificates");

const d = Config.fortyk.api.rpi.database;
const enabled = process.env.STUDENTCERTIFICATES_IMPORT_DB_SPEC === "1" && /scratch/.test(d.name);
const suite = enabled ? describe : describe.skip;

suite("importCertificates on MySQL (scratch database, one connection)", () => {
  let sequelize: Sequelize;
  const scope = { organisationid: "org-1", schoolids: ["sch-1"] };
  const row = (n: number, studentid: string, extra: Record<string, unknown> = {}) => ({
    certificateid: `cert-${n}`,
    shortcode: `ABCD-${1000 + n}`,
    studentid,
    curriculumid: "cur-1",
    scope: "level",
    scopeid: "lvl-1",
    issuedat: "2026-11-01T08:00:00.000Z",
    revokedat: null,
    snapshot: { learnername: "Learner One", quizcount: 3, nested: { a: [1, 2] } },
    checkurl: `https://check.example.org/v/ABCD-${1000 + n}`,
    ...extra,
  });
  const run = (body: unknown) => importCertificates(parseCertificatesPayload(body), scope);
  const stored = async () =>
    (await sequelize.query("SELECT certificateid, studentid, revokedat, checkurl, snapshot FROM `studentcertificates` ORDER BY certificateid"))[0] as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    sequelize = new Sequelize(d.name, d.user, d.password, { host: d.host, port: d.port || 3306, dialect: "mysql", logging: false, pool: { max: 1, min: 1 } });
    initModels(sequelize);
    jest.spyOn(dbinstance, "getdbinstance").mockReturnValue(sequelize as never);
    await sequelize.query("DROP TABLE IF EXISTS `studentcertificates`");
    await migration.up(sequelize.getQueryInterface());
    await sequelize.query("CREATE TEMPORARY TABLE `students` (studentid VARCHAR(36) NOT NULL PRIMARY KEY, schoolid VARCHAR(36) NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    await sequelize.query("INSERT INTO `students` (studentid, schoolid) VALUES ('st-1','sch-1'),('st-2','sch-1'),('st-3','sch-other')");
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await sequelize.query("DROP TEMPORARY TABLE IF EXISTS `students`");
    await sequelize.query("DROP TABLE IF EXISTS `studentcertificates`");
    await sequelize.close();
  });
  jest.setTimeout(60000);

  it("upserts, overwrites revokedat on the same id, replaces only the named learners' missing certificates, and reads the JSON snapshot back", async () => {
    expect(await run({ certificates: [row(1, "st-1"), row(2, "st-1"), row(3, "st-2")] })).toEqual({ upserted: 3, deleted: 0 });
    const first = await stored();
    expect(first.map((r) => r.certificateid)).toEqual(["cert-1", "cert-2", "cert-3"]);
    expect(first[0].revokedat).toBeNull();
    const snapshot = typeof first[0].snapshot === "string" ? JSON.parse(first[0].snapshot) : first[0].snapshot;
    expect(snapshot).toEqual({ learnername: "Learner One", quizcount: 3, nested: { a: [1, 2] } });

    expect(await run({ certificates: [row(1, "st-1", { revokedat: "2026-11-05T00:00:00.000Z", checkurl: null })] })).toEqual({ upserted: 1, deleted: 0 });
    const second = await stored();
    expect(second).toHaveLength(3);
    expect(second[0].checkurl).toBeNull();
    expect(new Date(second[0].revokedat).toISOString()).toBe("2026-11-05T00:00:00.000Z");

    // st-1's set becomes exactly cert-1; st-2's cert-3 is not named, so it stays
    expect(await run({ certificates: [row(1, "st-1")], replaceForStudents: ["st-1"] })).toEqual({ upserted: 1, deleted: 1 });
    expect((await stored()).map((r) => r.certificateid)).toEqual(["cert-1", "cert-3"]);
  });

  it("refuses a learner of another school and writes nothing", async () => {
    await expect(run({ certificates: [row(9, "st-1"), row(10, "st-3")] })).rejects.toMatchObject({ fields: [{ field: "certificates row 2 studentid" }] });
    expect((await stored()).map((r) => r.certificateid)).toEqual(["cert-1", "cert-3"]);
  });
});
