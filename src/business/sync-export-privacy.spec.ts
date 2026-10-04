import {
  rpiuseraccess,
  studentactives,
  studentgradesprogress,
  studentlearningprogress,
  studentlessonsprogress,
  studentlevelsprogress,
  studentpoints,
  studentprogress,
  studentprogressquestions,
} from "src/models/data-models/init-models";
import { studentappusages } from "src/models/data-models/studentappusage";
import { SyncBusiness } from "./sync.business";
import { SyncReport } from "./sync.report";
import { LogBusiness } from "./log.business";

/**
 * workspace#79 step 2: the raw learner `answer` (studentprogressquestions.answer
 * — free-text JSON that can carry PII) must never leave this API via
 * `GET export/report-data` (SyncReport.getreportdata, the payload central
 * actually pulls) or `GET export/log` (LogBusiness.exportlog, the log zip).
 * `SyncBusiness.getreportdata`/`getstudentdata` are covered too, but that's
 * unused-code hygiene, not a live payload: nothing in this codebase calls
 * them (`SyncBusiness` is only ever constructed for the content-import
 * transaction in import.controller.ts, whose methods are unrelated) — see
 * the mirrored, actually-used code in sync.report.ts for the real route.
 * `clientiscorrect` and `servergrade` (also added by #94) are NOT privacy
 * sensitive and must still make the trip, same as `verified` on
 * studentprogress itself.
 *
 * studentprogressquestions.findAll is mocked to actually HONOUR the
 * `attributes.exclude` option the business code passes (the same way real
 * Sequelize would drop an excluded column before it ever reaches
 * `.get({ plain: true })`), rather than hard-coding an answer-free row. This
 * way, deleting the `exclude: ["answer"]` line from the business code is
 * exactly what turns this red — a mock that simply never included `answer`
 * would pass unconditionally and prove nothing. No DB is opened — every
 * Sequelize call below is a `jest.spyOn` mock, not a real query.
 */
jest.mock("./schooluser.business");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SchoolUserBusiness } = require("./schooluser.business");

const RAW_ROW = {
  studentprogressid: "sp1",
  studentprogressquestionid: "spq1",
  tries: 1,
  iscorrect: true,
  referencequestionid: "q1",
  answer: { v: 1, type: "choice", selected: ["a"] },
  clientiscorrect: true,
  servergrade: "correct",
};

/** Simulates Sequelize honouring `attributes: { exclude: [...] }` on findAll. */
const rowRespectingExclude = (options: any) => {
  const excluded: string[] = options?.attributes?.exclude ?? [];
  const plain = { ...RAW_ROW };
  for (const key of excluded) {
    delete (plain as any)[key];
  }
  return { get: () => plain } as never;
};

describe("sync/export payloads never carry the raw learner answer (workspace#79 step 2)", () => {
  let spqSpy: jest.SpyInstance;
  let spSpy: jest.SpyInstance;
  let raSpy: jest.SpyInstance;
  let saSpy: jest.SpyInstance;
  let slpSpy: jest.SpyInstance;
  let sgpSpy: jest.SpyInstance;
  let slvpSpy: jest.SpyInstance;
  let slspSpy: jest.SpyInstance;
  let spointsSpy: jest.SpyInstance;
  let spusagesSpy: jest.SpyInstance;

  beforeEach(() => {
    spqSpy = jest.spyOn(studentprogressquestions, "findAll").mockImplementation((options: any) =>
      Promise.resolve([rowRespectingExclude(options)]) as never,
    );
    spSpy = jest.spyOn(studentprogress, "findAll").mockResolvedValue([
      { get: () => ({ studentprogressid: "sp1", verified: true }) },
    ] as never);
    raSpy = jest.spyOn(rpiuseraccess, "findAll").mockResolvedValue([] as never);
    saSpy = jest.spyOn(studentactives, "findAll").mockResolvedValue([] as never);
    slpSpy = jest.spyOn(studentlearningprogress, "findAll").mockResolvedValue([] as never);
    sgpSpy = jest.spyOn(studentgradesprogress, "findAll").mockResolvedValue([] as never);
    slvpSpy = jest.spyOn(studentlevelsprogress, "findAll").mockResolvedValue([] as never);
    slspSpy = jest.spyOn(studentlessonsprogress, "findAll").mockResolvedValue([] as never);
    spointsSpy = jest.spyOn(studentpoints, "findAll").mockResolvedValue([] as never);
    spusagesSpy = jest.spyOn(studentappusages, "findAll").mockResolvedValue([] as never);

    (SchoolUserBusiness.prototype as any).getschoolusers = jest.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    spqSpy.mockRestore();
    spSpy.mockRestore();
    raSpy.mockRestore();
    saSpy.mockRestore();
    slpSpy.mockRestore();
    sgpSpy.mockRestore();
    slvpSpy.mockRestore();
    slspSpy.mockRestore();
    spointsSpy.mockRestore();
    spusagesSpy.mockRestore();
  });

  const assertPayloadIsClean = (payload: string) => {
    const data = JSON.parse(payload);
    const questionRows = data.studentresult.flatMap((r: any) => r.studentprogressquestions ?? []);
    expect(questionRows.length).toBeGreaterThan(0);
    for (const row of questionRows) {
      expect(row).not.toHaveProperty("answer");
      expect(row.clientiscorrect).toBe(true);
      expect(row.servergrade).toBe("correct");
    }
    // studentprogress rows keep `verified` — it's not sensitive.
    expect(data.studentresult[0].verified).toBe(true);
  };

  it("SyncReport.getreportdata() (GET export/report-data, served to central) strips answer", async () => {
    const payload = await new SyncReport().getreportdata(null);
    assertPayloadIsClean(payload);
    const options = spqSpy.mock.calls[0][0];
    expect(options.attributes).toEqual({ exclude: ["answer"] });
  });

  it("SyncBusiness.getreportdata() strips answer (unused-code hygiene: no caller uses this method today)", async () => {
    const payload = await new SyncBusiness(undefined as never).getreportdata();
    assertPayloadIsClean(payload);
    const options = spqSpy.mock.calls[0][0];
    expect(options.attributes).toEqual({ exclude: ["answer"] });
  });

  it("LogBusiness.exportlog() (the GET export/log zip) strips answer", async () => {
    const { log } = await new LogBusiness().exportlog(null);
    const questionRows = log.result.flatMap((r: any) => r.studentprogressquestions ?? []);
    expect(questionRows.length).toBeGreaterThan(0);
    for (const row of questionRows) {
      expect(row).not.toHaveProperty("answer");
      expect(row.clientiscorrect).toBe(true);
      expect(row.servergrade).toBe("correct");
    }
    const options = spqSpy.mock.calls[0][0];
    expect(options.attributes).toEqual({ exclude: ["answer"] });
  });
});
