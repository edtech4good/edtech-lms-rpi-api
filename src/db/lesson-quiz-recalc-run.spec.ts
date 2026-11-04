/* eslint-disable @typescript-eslint/no-var-requires */
import * as rules from "src/business/progress-rules";
import * as validator from "src/validators/config.validator";

const { run } = require("../../scripts/lib/lesson-quiz-recalc");
const { main } = require("../../scripts/recalc-lesson-quiz-points");

/**
 * `run()` and `main()` of the recalculation script over an in-memory stand-in for the database connection, so what
 * needs a database to see (refusals, the organisation filter, the dry run's writes, the exit code when the connection is
 * lost) is also checked with no .env and no DB. The stand-in answers the script's own statements by their table, applies the
 * organisation parameter the way the SQL does, refuses a write inside a read-only transaction like MySQL, and records writes.
 * The real thing is in lesson-quiz-recalc.db.spec.ts.
 */
type Row = Record<string, unknown>;
const ORGS: Row[] = [
  { organisationid: "O1", organisationcode: "alpha", settingsconfig: { requireLessonQuizPass: true }, isdeleted: 0 },
  { organisationid: "O2", organisationcode: "beta", settingsconfig: { requireLessonQuizPass: true }, isdeleted: 0 },
  { organisationid: "O3", organisationcode: "gone", settingsconfig: { requireLessonQuizPass: true }, isdeleted: 1 },
  { organisationid: "O4", organisationcode: "off", settingsconfig: { requireLessonQuizPass: "true" }, isdeleted: 0 },
  { organisationid: "O5", organisationcode: "café", settingsconfig: { requireLessonQuizPass: true }, isdeleted: 0 },
];
const LEARNERS: Record<string, string[]> = { O1: ["s1", "s2"], O2: ["s3"], O4: ["s4"], O5: ["s5"] };
const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

class FakeConn {
  writes: { sql: string; params: unknown[] }[] = [];
  queries: { sql: string; params: unknown[] }[] = [];
  readOnly = false;
  lost = false;
  ended = false;
  constructor(private opts: { dieOn?: RegExp; endHangs?: boolean; endThrows?: boolean } = {}) {}
  async beginTransaction() { this.readOnly = false; }
  async commit() { /* nothing */ }
  async rollback() { /* nothing */ }
  async end(): Promise<void> {
    this.ended = true;
    if (this.opts.endThrows) throw new Error("Can't add new command when connection is in closed state");
    if (this.opts.endHangs) return new Promise(() => undefined);
  }
  destroy() { /* nothing */ }
  async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    this.queries.push({ sql, params });
    if (this.lost || (this.opts.dieOn && this.opts.dieOn.test(sql))) {
      this.lost = true;
      throw Object.assign(new Error("Connection lost: The server closed the connection."), { code: "PROTOCOL_CONNECTION_LOST", fatal: true });
    }
    if (/^START TRANSACTION READ ONLY/.test(sql)) { this.readOnly = true; return [[]]; }
    if (/^(UPDATE|INSERT|DELETE)/.test(sql)) {
      if (this.readOnly) throw Object.assign(new Error("read only"), { code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" });
      this.writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    }
    if (/FROM organisations/.test(sql)) return [ORGS.filter((o) => fold(String(o.organisationcode)) === fold(String(params[0])))];
    if (/FROM students s JOIN schools/.test(sql)) {
      const ids = /organisationid = \?/.test(sql) ? LEARNERS[String(params[0])] || [] : Object.values(LEARNERS).flat();
      return [ids.map((studentid) => ({ studentid }))];
    }
    if (/FROM lessonpractices/.test(sql) || /FROM studentlearningsprogress/.test(sql)) return [[]];
    if (/FROM studentprogress WHERE studentid/.test(sql)) {
      return [[{ studentprogressid: `a-${params[0]}`, quizid: "Q1", ispass: 0, verified: 0, points: 40, starttime: new Date(Date.UTC(2026, 10, 1)) }]];
    }
    if (/FROM lessonquizzes/.test(sql)) return [[{ lessonquizid: "Q1", lessonid: "L1", lessonquizstatus: 1 }]];
    if (/FROM lessons WHERE/.test(sql)) return [[{ lessonid: "L1", levelid: "V1", total_points: 60, passing_points: 60 }]];
    if (/FROM levels WHERE/.test(sql)) return [[{ levelid: "V1", gradeid: "G1", points: 160 }]];
    if (/FROM grades WHERE/.test(sql)) return [[{ gradeid: "G1", points: 160 }]];
    const row = (id: string, k: string, points: number, progress: number, completed: number) => ({ id: `${id}-${params[0]}`, k, points, progress, completed, added_completed_scores: 0 });
    if (/FROM studentlessonsprogress/.test(sql)) return [[row("pl", "L1", 60, 100, 1)]];
    if (/FROM studentlevelsprogress/.test(sql)) return [[row("pv", "V1", 60, 37.5, 0)]];
    if (/FROM studentgradesprogress/.test(sql)) return [[row("pg", "G1", 60, 37.5, 0)]];
    throw new Error(`the stand-in has no answer for: ${sql.slice(0, 60)}`);
  }
}

const NOW = new Date(Date.UTC(2026, 10, 5, 9, 0, 0));
const go = async (conn: FakeConn, over: Record<string, unknown> = {}) => {
  const lines: string[] = [];
  const res = await run({ conn, organisationcode: "alpha", apply: false, apiStopped: false, rules, countedPassNeedsVerified: false, ruleDeployed: true, dbname: "x", now: NOW, out: (l: string) => lines.push(l), ...over });
  return { ...res, lines };
};
const attemptQueries = (c: FakeConn) => c.queries.filter((q) => /FROM studentprogress WHERE studentid/.test(q.sql)).map((q) => q.params[0]);

describe("run() over a stand-in connection", () => {
  it("a dry run reads the organisation's learners only and writes nothing", async () => {
    const c = new FakeConn();
    const r = await go(c);
    expect(r.exitCode).toBe(0);
    expect(c.writes).toEqual([]);
    expect(attemptQueries(c)).toEqual(["s1", "s2"]);
    expect(r.counts).toMatchObject({ learners: 2, attemptRowsToZero: 2, lessonsChanged: 2 });
  });

  it("prints the line for credit that did not fully come off", async () => {
    const r = await go(new FakeConn());
    expect(r.lines).toContain("lessons where less than the whole credit came off, because the lesson had not counted all of it (it overflowed its total, or its rows were changed by hand): 0");
  });

  it("--apply writes the attempts, lesson, level and grade rows, each progress row with lastupdated set", async () => {
    const c = new FakeConn();
    const r = await go(c, { apply: true, apiStopped: true });
    expect(r.exitCode).toBe(0);
    const tables = c.writes.map((w) => w.sql.split(" ")[1]);
    expect(tables.filter((t) => t === "studentprogress")).toHaveLength(2);
    for (const t of ["studentlessonsprogress", "studentlevelsprogress", "studentgradesprogress"]) expect(tables.filter((x) => x === t)).toHaveLength(2);
    for (const w of c.writes.filter((x) => !x.sql.startsWith("UPDATE studentprogress "))) {
      expect(w.sql).toContain("lastupdated = ?");
      expect(w.params).toContain(NOW);
    }
    const lesson = c.writes.find((w) => w.sql.startsWith("UPDATE studentlessonsprogress"))!;
    expect(lesson.params.slice(0, 3)).toEqual([20, 33.33, 0]);
  });

  it("the dry run prints the same counts as the apply", async () => {
    const dry = await go(new FakeConn());
    const applied = await go(new FakeConn(), { apply: true, apiStopped: true });
    const body = (l: string[]) => l.filter((x) => !/^recalc-lesson-quiz-points|^Dry run|^Applied|^Nothing to change/.test(x));
    expect(body(applied.lines)).toEqual(body(dry.lines));
  });

  it("--apply without --api-stopped refuses before any query, and says why", async () => {
    const c = new FakeConn();
    const r = await go(c, { apply: true });
    expect(r.exitCode).toBe(1);
    expect(c.queries).toEqual([]);
    expect(r.lines.join("\n")).toMatch(/--api-stopped.*API must be stopped/);
  });

  it("--api-stopped without --apply is refused", async () => {
    const c = new FakeConn();
    expect((await go(c, { apiStopped: true })).exitCode).toBe(1);
    expect(c.queries).toEqual([]);
  });

  it("a setting that is not strictly true refuses and reads no learner", async () => {
    const c = new FakeConn();
    const r = await go(c, { organisationcode: "off", apply: true, apiStopped: true });
    expect(r.exitCode).toBe(1);
    expect(c.writes).toEqual([]);
    expect(attemptQueries(c)).toEqual([]);
  });

  it("the organisation code is matched exactly: case, trailing space and accents do not match", async () => {
    for (const code of ["ALPHA", "alpha ", "café".normalize("NFD").replace(/[̀-ͯ]/g, ""), "Café"]) {
      const c = new FakeConn();
      const r = await go(c, { organisationcode: code });
      expect(r.exitCode).toBe(1);
      expect(attemptQueries(c)).toEqual([]);
    }
    expect((await go(new FakeConn(), { organisationcode: "café" })).exitCode).toBe(0);
  });

  it("a deleted organisation is refused", async () => {
    const c = new FakeConn();
    expect((await go(c, { organisationcode: "gone", apply: true, apiStopped: true })).exitCode).toBe(1);
    expect(c.writes).toEqual([]);
  });

  it("a build without the rule refuses", async () => {
    const c = new FakeConn();
    expect((await go(c, { ruleDeployed: false })).exitCode).toBe(1);
    expect(c.queries).toEqual([]);
  });

  it("a lost connection stops at once: exit 2, the rest are counted as not reached, no query goes on failing", async () => {
    const c = new FakeConn({ dieOn: /FROM studentprogress WHERE studentid/ });
    const r = await go(c);
    expect(r.exitCode).toBe(2);
    expect(r.counts).toMatchObject({ learnersFailed: 1, learnersNotReached: 1 });
    expect(attemptQueries(c)).toEqual(["s1"]);
    expect(r.lines.join("\n")).toContain("the database connection was lost; stopping here");
  });
});

describe("main(): the exit code survives a connection that cannot be closed", () => {
  afterEach(() => { process.exitCode = undefined; });
  const env = { RPI_DB_USER: "u", RPI_DB_PASSWORD: "p", RPI_DB_NAME: "n" };
  const start = (conn: FakeConn, argv: string[]) => main({ argv, env, connect: async () => conn, rules, validator, ruleDeployed: true, closeTimeoutMs: 50, out: () => undefined });

  it("a lost connection whose end() never settles still gives 2, and it is already set on process.exitCode", async () => {
    const c = new FakeConn({ dieOn: /FROM studentprogress WHERE studentid/, endHangs: true });
    expect(await start(c, ["--org", "alpha"])).toBe(2);
    expect(process.exitCode).toBe(2);
    expect(c.ended).toBe(true);
  });

  it("a lost connection whose end() throws still gives 2", async () => {
    const c = new FakeConn({ dieOn: /FROM studentprogress WHERE studentid/, endThrows: true });
    expect(await start(c, ["--org", "alpha"])).toBe(2);
  });

  it("a clean run gives 0 and a refusal gives 1", async () => {
    expect(await start(new FakeConn(), ["--org", "alpha"])).toBe(0);
    process.exitCode = undefined;
    expect(await start(new FakeConn(), ["--org", "alpha", "--apply"])).toBe(1);
  });
});
