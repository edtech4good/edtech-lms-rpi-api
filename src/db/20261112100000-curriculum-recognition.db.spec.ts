import { Sequelize } from "sequelize";
import { Config } from "src/config";

/**
 * The recognition migration against a real MySQL. Runs ONLY when RECOGNITION_MIGRATION_DB_SPEC=1 is set AND the
 * configured database name contains "_scratch_". It never touches a real table: a TEMPORARY `curriculums` (visible to
 * one connection only, and shadowing nothing that persists) stands in, on a pool of exactly ONE connection, which is
 * also what proves the migration reads on its own transaction (a read on the pool would wait forever).
 * Everything it creates is dropped in afterAll.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261112100000-curriculum-recognition");

const d = Config.fortyk.api.rpi.database;
const enabled = process.env.RECOGNITION_MIGRATION_DB_SPEC === "1" && /_scratch_/.test(d.name);
const suite = enabled ? describe : describe.skip;

suite("20261112100000-curriculum-recognition on MySQL (temporary table, one connection)", () => {
  let sequelize: Sequelize;
  const columns = async (): Promise<Array<{ Field: string; Type: string; Null: string; Default: string }>> =>
    (await sequelize.query("SHOW FULL COLUMNS FROM `curriculums`"))[0] as never;
  const recognition = async () => (await columns()).filter((c) => /recognition$/.test(c.Field)).map((c) => [c.Field, c.Type, c.Null, c.Default]);

  beforeAll(async () => {
    sequelize = new Sequelize(d.name, d.user, d.password, { host: d.host, port: d.port || 3306, dialect: "mysql", logging: false, pool: { max: 1, min: 1 } });
    await sequelize.query(
      "CREATE TEMPORARY TABLE `curriculums` (curriculumid VARCHAR(36) NOT NULL PRIMARY KEY, curriculumname VARCHAR(250) NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    );
    await sequelize.query("INSERT INTO `curriculums` (curriculumid, curriculumname) VALUES ('t-1', 'a')");
  });
  afterAll(async () => {
    await sequelize.query("DROP TEMPORARY TABLE IF EXISTS `curriculums`");
    await sequelize.close();
  });
  jest.setTimeout(30000);

  const expected = [
    ["levelrecognition", "varchar(16)", "NO", "award"],
    ["graderecognition", "varchar(16)", "NO", "certificate"],
    ["curriculumrecognition", "varchar(16)", "NO", "none"],
  ];

  it("adds the columns, existing rows take the defaults, a second run changes nothing, down drops them, up restores them", async () => {
    const qi = sequelize.getQueryInterface();
    await migration.up(qi);
    expect(await recognition()).toEqual(expected);
    expect((await sequelize.query("SELECT levelrecognition, graderecognition, curriculumrecognition FROM `curriculums`"))[0]).toEqual([
      { levelrecognition: "award", graderecognition: "certificate", curriculumrecognition: "none" },
    ]);
    await migration.up(qi);
    expect(await recognition()).toEqual(expected);
    await migration.down(qi);
    expect(await recognition()).toEqual([]);
    await migration.up(qi);
    expect(await recognition()).toEqual(expected);
  });
});
