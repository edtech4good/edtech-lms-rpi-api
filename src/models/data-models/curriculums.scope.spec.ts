import { Sequelize } from "sequelize";
import { initModels } from "./init-models";
import { curriculums } from "./curriculums";

/**
 * The per-tier recognition columns stay out of every query on `curriculums` unless the `withRecognition` scope is
 * used (outward payloads keep their shape), and a write that does not name them does not mention them. The SQL
 * Sequelize generates is captured; no connection is opened.
 */
describe("curriculums: the recognition columns are read only through withRecognition", () => {
  let sequelize: Sequelize;
  let spy: jest.SpyInstance;
  const sqlOf = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (e) {
      const m = /__captured_sql__([\s\S]*)/.exec(String((e as Error).message));
      if (m) return m[1];
      throw e;
    }
    throw new Error("no SQL captured");
  };

  beforeEach(() => {
    sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
    initModels(sequelize);
    spy = jest.spyOn(sequelize, "query").mockImplementation((sql: unknown) => {
      throw new Error(`__captured_sql__${String(sql)}`);
    });
  });
  afterEach(async () => {
    spy.mockRestore();
    await sequelize.close();
  });

  it("a plain findAll selects no recognition column (nor the owner)", async () => {
    const sql = await sqlOf(() => curriculums.findAll());
    expect(sql).toContain("`curriculumname`");
    expect(sql).not.toMatch(/recognition/);
    expect(sql).not.toContain("organisationid");
  });

  it("a findAll that names attributes still gets no recognition column it did not name", async () => {
    const sql = await sqlOf(() => curriculums.findAll({ where: { curriculumid: "c1" } }));
    expect(sql).not.toMatch(/recognition/);
  });

  it("withRecognition selects exactly what it is asked for", async () => {
    const sql = await sqlOf(() => curriculums.scope("withRecognition").findAll({ attributes: ["curriculumid", "levelrecognition", "graderecognition", "curriculumrecognition"] }));
    expect(sql).toMatch(/SELECT `curriculumid`, `levelrecognition`, `graderecognition`, `curriculumrecognition` FROM `curriculums`/);
  });

  it("a row created without the keys leaves the three columns out of its INSERT (the database default applies)", async () => {
    const sql = await sqlOf(() => curriculums.bulkCreate([{ curriculumid: "c1", curriculumname: "n", organisationid: "o" }] as never));
    expect(sql).toMatch(/INSERT INTO `curriculums`/);
    expect(sql).not.toMatch(/recognition/);
  });
});
