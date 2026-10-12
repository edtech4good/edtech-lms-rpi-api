import { Sequelize } from "sequelize";
import { documents, initModels } from "./init-models";

/**
 * Media library, phase 0 (ML-1): `documents` gains a title, a licence and an attribution. No route or export
 * returns them yet, so they stay out of every query by default (like the owner column) and are read only through
 * a scope that asks for them. No database: `sequelize.query` is intercepted before it would touch a socket.
 */
describe("documents: the media-library columns", () => {
  let sequelize: Sequelize;
  let querySpy: jest.SpyInstance;

  beforeEach(() => {
    sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
    initModels(sequelize);
    querySpy = jest.spyOn(sequelize, "query").mockImplementation((sql: unknown) => {
      throw new Error(`__captured_sql__${String(sql)}`);
    });
  });
  afterEach(async () => {
    querySpy.mockRestore();
    await sequelize.close();
  });

  const select = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return message.replace("__captured_sql__", "");
    }
    throw new Error("no query was sent");
  };

  it("the default query selects the old columns only", async () => {
    const sql = await select(() => documents.findAll());
    expect(sql).toMatch(/^SELECT `documentid`, `documenttypeid`, `documentname`, `documents3meta`, `isdeleted`, `documenttags`, `lastupdated` FROM `documents`/);
    for (const column of ["documenttitle", "documentlicence", "documentattribution", "organisationid"]) expect(sql).not.toContain(column);
  });

  it("findOne keeps them out too", async () => {
    expect(await select(() => documents.findOne({ where: { documentid: "d" } }))).not.toMatch(/documenttitle|documentlicence|documentattribution/);
  });

  it("withMediaMetadata and withOwnership select every column", async () => {
    for (const scope of ["withMediaMetadata", "withOwnership"]) {
      const sql = await select(() => documents.scope(scope).findAll());
      for (const column of ["documenttitle", "documentlicence", "documentattribution", "organisationid"]) expect(sql).toContain(column);
    }
  });

  it("the columns are nullable title and attribution, and a NOT NULL licence defaulting to 'unspecified'", () => {
    const attributes = documents.getAttributes();
    expect(attributes.documenttitle).toMatchObject({ allowNull: true, defaultValue: null });
    expect(attributes.documentattribution).toMatchObject({ allowNull: true, defaultValue: null });
    expect(attributes.documentlicence).toMatchObject({ allowNull: false, defaultValue: "unspecified" });
    expect(String(attributes.documenttitle?.type)).toBe("VARCHAR(255)");
    expect(String(attributes.documentlicence.type)).toBe("VARCHAR(64)");
    expect(String(attributes.documentattribution?.type)).toBe("JSON");
  });

  it("declares no index on the new columns", () => {
    const indexed = (documents.options.indexes ?? []).flatMap((i) => (i.fields ?? []).map((f) => (typeof f === "string" ? f : (f as { name: string }).name)));
    expect(indexed).toEqual(["documentid"]);
  });

  it("a built row without a licence takes 'unspecified'", () => {
    expect(documents.build({ documentid: "d", documenttypeid: 2, documentname: "a.mp4", organisationid: "o" }).documentlicence).toBe("unspecified");
  });
});
