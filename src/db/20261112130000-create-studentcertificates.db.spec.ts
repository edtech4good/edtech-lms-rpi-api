import { Sequelize } from "sequelize";
import { Config } from "src/config";

/**
 * The studentcertificates migration against a real MySQL. Runs ONLY when STUDENTCERTIFICATES_MIGRATION_DB_SPEC=1 is set AND
 * the configured database name contains "scratch": it creates and drops a real table, so it refuses any other database.
 * The pool holds exactly ONE connection, which is also what proves the migration reads on its own transaction (a read on
 * the pool would wait forever). The table is dropped in afterAll. It is never run by the default test command.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require("./migrations/20261112130000-create-studentcertificates");

const d = Config.fortyk.api.rpi.database;
const enabled = process.env.STUDENTCERTIFICATES_MIGRATION_DB_SPEC === "1" && /scratch/.test(d.name);
const suite = enabled ? describe : describe.skip;

suite("20261112130000-create-studentcertificates on MySQL (scratch database, one connection)", () => {
  let sequelize: Sequelize;
  const columns = async (): Promise<Array<{ Field: string; Type: string; Null: string; Collation: string | null }>> =>
    (await sequelize.query("SHOW FULL COLUMNS FROM `studentcertificates`"))[0] as never;
  const indexes = async (): Promise<string[]> =>
    ((await sequelize.query("SHOW INDEX FROM `studentcertificates`"))[0] as Array<{ Key_name: string }>).map((i) => i.Key_name).sort();

  beforeAll(async () => {
    sequelize = new Sequelize(d.name, d.user, d.password, { host: d.host, port: d.port || 3306, dialect: "mysql", logging: false, pool: { max: 1, min: 1 } });
    await sequelize.query("DROP TABLE IF EXISTS `studentcertificates`");
  });
  afterAll(async () => {
    await sequelize.query("DROP TABLE IF EXISTS `studentcertificates`");
    await sequelize.close();
  });
  jest.setTimeout(30000);

  it("creates the table with its columns, utf8mb4_unicode_ci and the studentid index; a second run changes nothing; down drops it; up restores it", async () => {
    const qi = sequelize.getQueryInterface();
    await migration.up(qi);
    const first = await columns();
    expect(first.map((c) => c.Field)).toEqual(["certificateid", "shortcode", "studentid", "curriculumid", "scope", "scopeid", "issuedat", "revokedat", "snapshot", "checkurl", "lastupdated"]);
    expect(first.find((c) => c.Field === "shortcode")).toMatchObject({ Type: "char(9)", Null: "NO", Collation: "utf8mb4_unicode_ci" });
    expect(first.find((c) => c.Field === "revokedat")).toMatchObject({ Null: "YES" });
    expect(first.find((c) => c.Field === "checkurl")).toMatchObject({ Type: "text", Null: "YES" });
    expect(await indexes()).toEqual(["PRIMARY", "idx_studentcertificates_studentid"]);
    await migration.up(qi);
    expect(await columns()).toEqual(first);
    expect(await indexes()).toEqual(["PRIMARY", "idx_studentcertificates_studentid"]);
    await migration.down(qi);
    expect((await sequelize.query("SHOW TABLES LIKE 'studentcertificates'"))[0]).toEqual([]);
    await migration.down(qi);
    await migration.up(qi);
    expect(await columns()).toEqual(first);
  });
});
