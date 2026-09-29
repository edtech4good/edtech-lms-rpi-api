import { Sequelize } from "sequelize";
import { initModels } from "./init-models";

/**
 * workspace#79 step 2 (defence in depth): `studentprogressquestions` gets a
 * `defaultScope` that excludes the raw learner `answer` column from every
 * query, on top of the explicit per-query `attributes: { exclude: ["answer"] }`
 * already added to sync.business.ts/sync.report.ts/log.business.ts — so a
 * future caller that forgets the per-query exclude still can't leak it. A
 * named `withAnswer` scope (Sequelize scopes REPLACE the default scope, they
 * don't merge with it) is the explicit escape hatch for the one caller that
 * would ever need the raw column — there is none today.
 *
 * This proves the SQL Sequelize actually generates never selects `answer`
 * (or `studentprogressquestions`.`answer` through the association) unless
 * `.scope('withAnswer')` is used — a stronger guarantee than asserting on
 * the `attributes` option a call site passes, since it can't be fooled by a
 * scope/option merge order that behaves differently than expected. No DB
 * connection is opened: a `Sequelize` instance's constructor doesn't
 * connect until a query actually runs a socket call, and `sequelize.query`
 * is intercepted here before that would happen — the "connection" is never
 * used for anything but SQL string generation.
 */
describe("studentprogressquestions defaultScope excludes answer (workspace#79 step 2)", () => {
  let sequelize: Sequelize;
  let querySpy: jest.SpyInstance;

  beforeEach(() => {
    sequelize = new Sequelize("test", "test", "test", { dialect: "mysql", logging: false });
    initModels(sequelize);
    // Intercept right before Sequelize would hit the (nonexistent) socket:
    // capture the generated SQL and hand back an empty result set instead
    // of actually running anything.
    querySpy = jest.spyOn(sequelize, "query").mockImplementation((sql: unknown) => {
      throw new Error(`__captured_sql__${String(sql)}`);
    });
  });

  afterEach(async () => {
    querySpy.mockRestore();
    await sequelize.close();
  });

  const sqlThrown = async (run: () => Promise<unknown>): Promise<string> => {
    try {
      await run();
      throw new Error("expected the mocked sequelize.query to throw, but the call under test did not reach it");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const match = message.match(/^__captured_sql__([\s\S]*)$/);
      if (!match) throw e;
      return match[1];
    }
  };

  it("studentprogressquestions.findAll({}) never selects answer", async () => {
    const { studentprogressquestions } = require("./init-models");
    const sql = await sqlThrown(() => studentprogressquestions.findAll({}));
    expect(sql.toLowerCase()).not.toContain("answer");
  });

  it("studentprogress.findAll with an included studentprogressquestions association never selects answer", async () => {
    const { studentprogress } = require("./init-models");
    const { studentprogressquestions } = require("./init-models");
    const sql = await sqlThrown(() =>
      studentprogress.findAll({
        include: [{ model: studentprogressquestions, as: "studentprogressquestions" }],
      }),
    );
    expect(sql.toLowerCase()).not.toContain("answer");
  });

  it("studentprogressquestions.scope('withAnswer').findAll({}) DOES select answer", async () => {
    const { studentprogressquestions } = require("./init-models");
    const sql = await sqlThrown(() => studentprogressquestions.scope("withAnswer").findAll({}));
    expect(sql.toLowerCase()).toContain("answer");
  });
});
