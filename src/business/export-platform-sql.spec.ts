import { readFileSync } from "fs";
import { join } from "path";
import { Sequelize } from "sequelize";
import { initModels, setuprelationshipforreport } from "src/models/data-models/init-models";
import { LogBusiness } from "./log.business";
import { SyncReport } from "./sync.report";

/**
 * The whole-server view of the data exports (`GET export/report-data` with the server key and `platform`, and the
 * log zip's `log.ini`) is what it was before the exports were scoped: the very same statements, character for
 * character. The list in fixtures/report-data-platform.sql.json is what the previous build sent, captured with the
 * clock fixed; a scoped export differs from it by exactly the added conditions, never the other way round.
 *
 * No database: `sequelize.query` is intercepted before it would touch a socket, and answers no rows.
 */
const GOLDEN: string[] = JSON.parse(readFileSync(join(__dirname, "fixtures", "report-data-platform.sql.json"), "utf8"));

describe("the platform view of the data exports sends the statements it always did", () => {
  const sequelize = new Sequelize({ dialect: "mysql" });
  initModels(sequelize);
  setuprelationshipforreport(sequelize);
  const sent: string[] = [];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-04T00:00:00.000Z"));
    sent.length = 0;
    jest.spyOn(sequelize, "query").mockImplementation(((sql: unknown) => {
      sent.push(String(sql));
      return Promise.resolve([]);
    }) as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await sequelize.close();
  });

  it("GET /export/report-data for the platform: the logins and the nine progress reads are byte for byte the previous statements, in order", async () => {
    await new SyncReport().getreportdata(null);
    expect(sent).toEqual(GOLDEN);
  });

  it("GET /export/log for the platform: log.ini's reads are the same statements (the progress reads of the report data)", async () => {
    await new LogBusiness().exportlog(null);
    expect(sent).toEqual(GOLDEN.slice(1));
  });

  it("a scoped read differs from it (so the comparison above can fail): every table is limited to the scope's learners or logins", async () => {
    const keys = { studentids: ["s-1"], schooluserids: ["u-1"] };
    await new SyncReport().getstudentdata({ organisationid: "o", schoolids: ["x"] }, keys);
    const progress = sent.filter((s) => !s.includes("FROM `schoolusers`"));
    expect(progress).toHaveLength(GOLDEN.length - 1);
    for (const sql of progress) {
      if (sql.includes("FROM `studentprogressquestions`")) continue; // limited through the progress rows it follows
      expect(GOLDEN).not.toContain(sql);
      expect(sql).toMatch(/`(studentid|userid|schooluserid)` IN \('(s|u)-1'\)/);
    }
  });
});
