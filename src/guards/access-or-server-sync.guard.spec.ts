import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { Config } from "src/config";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { JwtAccessStrategy } from "src/services/auth.strategy";

import { ReportController } from "src/modules/report/report.controller";
import { CurriculumController } from "src/modules/curriculum/curriculum.controller";
import { StudentController } from "src/modules/student/student.controller";
import { ExportController } from "src/modules/export/export.controller";
import { GradeController } from "src/modules/grade/grade.controller";
import { LessonController } from "src/modules/lesson/lesson.controller";
import { LevelController } from "src/modules/level/level.controller";
import { QuestionController } from "src/modules/question/question.controller";
import { ResultController } from "src/modules/result/result.controller";
import { TeacherController } from "src/modules/teachers/teacher.controller";
import { AccessController } from "src/modules/access/access.controller";

/**
 * edtech4good/workspace#45: `AccessGuard`'s old bypass (`authorization ===
 * serversynckey`, a plain `===`, and one that skipped the role check
 * entirely) accepted the server sync key on every route it guarded — a
 * leaked key was full access to curriculum, grade, lesson, level, question,
 * report, result, student, teacher, access and export.
 *
 * `AccessOrServerSyncGuard` (access-or-server-sync.guard.ts) scopes that
 * down: the sync key now only works on the specific routes central actually
 * calls server-to-server. `export/*` was dropped from the allow-list after
 * review: no caller sends the key there — central never calls it, and the
 * Android teacher app and Expo call `export/log` etc. with a user token —
 * so it is back on plain `AccessGuard` and refuses the sync key like any
 * other unlisted route. This spec drives real HTTP through the real JWT
 * strategy with signed tokens, so the guards run exactly as they do in the
 * app — only the token-table lookup and the handlers' own business-layer
 * calls (which would otherwise hit a real database) are stubbed.
 *
 * Style matches src/modules/import/import.guard.spec.ts.
 */

const tokenExists = jest.fn();
jest.mock("src/business/token.business", () => ({
  TokenBusiness: jest.fn().mockImplementation(() => ({ tokenExists })),
}));

// Allow-listed handlers run for real once the guard passes, so their
// business-layer calls (which would otherwise hit a real database) are
// stubbed. Nothing here changes what the guard itself does.
//
// Each mock function is declared once, by name, so section (b) below can
// assert against the exact same reference the controller calls — not just
// infer that the handler ran from the response status. Response status
// alone is not enough: "not 401/403" also passes when the GUARD itself
// crashes (a 500 looks identical to "the handler ran and its own logic
// produced a 500"). See edtech4good/workspace#45, PR #90 second fix round —
// proven by making `AccessOrServerSyncGuard` throw a plain `Error` on the
// sync-key path, which left this describe block green before this fix.
const mockGetStudentsScoresData = jest.fn().mockResolvedValue({ rows: [], count: 0 });
const mockGetClassScoresData = jest.fn().mockResolvedValue({ rows: [], count: 0 });
const mockGetStudentLastCompletedQuiz = jest
  .fn()
  .mockResolvedValue({ lastcompletedlessonquiz: [], count: 0 });
const mockGetLevelQuizScoresData = jest.fn().mockResolvedValue({ rows: [], count: 0 });
const mockGetClassLevelQuizScoresData = jest.fn().mockResolvedValue({ rows: [], count: 0 });
const mockGetStudentStatus = jest.fn().mockResolvedValue({ rows: [], count: 0 });
const mockGetStudentGradeProgress = jest.fn().mockResolvedValue({ rows: [], count: 0 });
const mockGetStudentLevelProgress = jest
  .fn()
  .mockResolvedValue({ rows: [], count: 0, student: null });
const mockGetStudentLessonProgress = jest
  .fn()
  .mockResolvedValue({ rows: [], count: 0, student: null });
const mockGetStudentsOfflineOnline = jest.fn().mockResolvedValue([]);

jest.mock("src/business/report.business", () => ({
  ReportBusiness: jest.fn().mockImplementation(() => ({
    getStudentsScoresData: mockGetStudentsScoresData,
    getClassScoresData: mockGetClassScoresData,
    getStudentLastCompletedQuiz: mockGetStudentLastCompletedQuiz,
    getLevelQuizScoresData: mockGetLevelQuizScoresData,
    getClassLevelQuizScoresData: mockGetClassLevelQuizScoresData,
    getStudentStatus: mockGetStudentStatus,
    getStudentGradeProgress: mockGetStudentGradeProgress,
    getStudentLevelProgress: mockGetStudentLevelProgress,
    getStudentLessonProgress: mockGetStudentLessonProgress,
    getStudentsOfflineOnline: mockGetStudentsOfflineOnline,
  })),
}));

const mockGetStudentBaselineEndlineResults = jest.fn().mockResolvedValue({ data: [] });
const mockGetCurriculumBaseline = jest.fn().mockResolvedValue(null);
const mockGetStudentBaseline = jest.fn().mockResolvedValue(null);
jest.mock("src/business/curriculumbaseline.business", () => ({
  CurriculumBaseLineBusiness: jest.fn().mockImplementation(() => ({
    getStudentBaselineEndlineResults: mockGetStudentBaselineEndlineResults,
    getCurriculumBaseline: mockGetCurriculumBaseline,
    GetStudentBaseline: mockGetStudentBaseline,
  })),
}));

const mockGetlogintime = jest.fn().mockResolvedValue([]);
jest.mock("src/business/student.business", () => ({
  StudentBusiness: jest.fn().mockImplementation(() => ({
    getlogintime: mockGetlogintime,
  })),
}));

jest.mock("src/business/log.business", () => ({
  LogBusiness: jest.fn().mockImplementation(() => ({
    exportlog: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("src/business/sync.report", () => ({
  SyncReport: jest.fn().mockImplementation(() => ({
    getreportdata: jest.fn().mockResolvedValue("{}"),
  })),
}));

// exportlog/exportfiles also read the log directory directly with `fs`,
// outside any business class.
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readdirSync: jest.fn().mockReturnValue([]),
}));

const tokenFor = (schooluserrole: SchoolRole) =>
  `Bearer ${sign(
    { jti: "test-jti", schooluserid: `u-${schooluserrole}`, schooluserrole },
    Config.fortyk.api.rpi.applicationsecret,
    { expiresIn: "5m" }
  )}`;

describe("AccessOrServerSyncGuard (edtech4good/workspace#45)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ReportController,
        CurriculumController,
        StudentController,
        ExportController,
        GradeController,
        LessonController,
        LevelController,
        QuestionController,
        ResultController,
        TeacherController,
        AccessController,
      ],
      providers: [JwtAccessStrategy],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    tokenExists.mockResolvedValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  const syncKey = () => Config.fortyk.api.serversynckey;

  const call = (method: "get" | "post", path: string, authorization?: string) => {
    const req = request(app.getHttpServer())[method](path);
    return authorization ? req.set("Authorization", authorization) : req;
  };

  describe("(a) the sync key on a NON-allow-listed route, one per controller, gives 401", () => {
    const NON_ALLOWLISTED: Array<["get" | "post", string]> = [
      ["get", "/curriculum"],
      ["get", "/grade/all"],
      ["get", "/Lesson/all"],
      ["get", "/level/library"],
      ["get", "/question/lesson/some-id"],
      ["post", "/result/lesson/practice/some-id"],
      ["get", "/student/all"],
      ["get", "/teacher/standards"],
      ["get", "/access"],
      // export/* dropped after review: no caller sends the key; every real
      // caller uses a user token (edtech4good/workspace#45 follow-up).
      ["get", "/export/log"],
      ["get", "/export/system-log/files"],
      ["get", "/export/report-data"],
    ];

    it.each(NON_ALLOWLISTED)("%s %s refuses the sync key with 401", async (method, path) => {
      await call(method, path, syncKey()).expect(401);
    });
  });

  describe("(b) the sync key on EVERY allow-listed route passes the guard and the handler actually runs", () => {
    // Not just "not 401/403" — that alone also passes when the GUARD itself
    // crashes on the sync-key path (a 500 is indistinguishable from a
    // handler that ran and then failed on its own). Every allow-listed
    // handler below has its business-layer call stubbed to resolve cleanly
    // (see the jest.mock blocks above), so a guard that actually lets the
    // request through always ends in a clean 200 — and the stubbed business
    // method is only ever called if the handler body itself ran. Asserting
    // both closes the gap: a crashing guard fails on the exact-status check
    // (no longer a bare "not 401/403"), and a guard that returns 200 through
    // some other route (e.g. short-circuiting before the handler) fails on
    // the call-count check.
    const ALLOWLISTED: Array<["get" | "post", string, jest.Mock]> = [
      ["post", "/report/studentprogress", mockGetStudentsScoresData],
      ["post", "/report/studentprogress/class", mockGetClassScoresData],
      ["post", "/report/studentlastcompletedquiz", mockGetStudentLastCompletedQuiz],
      ["post", "/report/studentlevelquiz", mockGetLevelQuizScoresData],
      ["post", "/report/studentlevelquiz/class", mockGetClassLevelQuizScoresData],
      ["post", "/report/studentstatus", mockGetStudentStatus],
      ["post", "/report/student-grade-progress", mockGetStudentGradeProgress],
      ["post", "/report/student-level-progress", mockGetStudentLevelProgress],
      ["post", "/report/student-lesson-progress", mockGetStudentLessonProgress],
      ["post", "/report/studentprogress/download", mockGetStudentsScoresData],
      ["post", "/report/studentlastcompletedquiz/download", mockGetStudentLastCompletedQuiz],
      ["post", "/report/studentlevelquiz/download", mockGetLevelQuizScoresData],
      ["post", "/report/studentlevelquiz/class/download", mockGetClassLevelQuizScoresData],
      ["post", "/report/studentstatus/download", mockGetStudentStatus],
      ["post", "/report/studentprogress/class/download", mockGetClassScoresData],
      ["get", "/curriculum/some-baseline-id/getstudentresult", mockGetStudentBaselineEndlineResults],
      ["post", "/student/logintime", mockGetlogintime],
    ];

    it.each(ALLOWLISTED)(
      "%s %s: sync key reaches the handler (status 200, business call proven, not inferred from status alone)",
      async (method, path, businessMock) => {
        const res = await call(method, path, syncKey());
        expect(res.status).toBe(200);
        expect(businessMock).toHaveBeenCalledTimes(1);
      }
    );

    // `offlineonline` is central's one report route that is NOT proxied
    // (commented out in report.controller.ts there — see report.controller.ts
    // here), so it must still refuse the sync key.
    it("get /report/offlineonline refuses the sync key with 401 (not proxied by central)", async () => {
      await call("get", "/report/offlineonline", syncKey()).expect(401);
    });
  });

  describe("(c) a valid user token still enforces the route's existing roles", () => {
    it("a TEACHER token passes report/studentprogress (allow-listed, role preserved)", async () => {
      const res = await call("post", "/report/studentprogress", tokenFor(SchoolRole.TEACHER));
      expect(res.status).toBe(200);
      expect(mockGetStudentsScoresData).toHaveBeenCalledTimes(1);
    });

    it("a STUDENT token is refused on report/studentprogress with 403 (wrong role)", async () => {
      await call("post", "/report/studentprogress", tokenFor(SchoolRole.STUDENT)).expect(403);
    });

    it("an ADMIN token passes curriculum/:id/getstudentresult", async () => {
      const res = await call(
        "get",
        "/curriculum/some-baseline-id/getstudentresult",
        tokenFor(SchoolRole.ADMIN)
      );
      expect(res.status).toBe(200);
      expect(mockGetStudentBaselineEndlineResults).toHaveBeenCalledTimes(1);
    });

    it("a STUDENT token is refused on curriculum/:id/getstudentresult with 403 (wrong role)", async () => {
      await call(
        "get",
        "/curriculum/some-baseline-id/getstudentresult",
        tokenFor(SchoolRole.STUDENT)
      ).expect(403);
    });

    it("any authenticated token passes student/logintime (no role restriction, unchanged)", async () => {
      const res = await call("post", "/student/logintime", tokenFor(SchoolRole.STUDENT));
      expect(res.status).toBe(200);
      expect(mockGetlogintime).toHaveBeenCalledTimes(1);
    });

    it("a missing token still gives 401 on an allow-listed route", async () => {
      await call("post", "/report/studentprogress").expect(401);
    });
  });

  describe("(d) only the exact sync key works, not a prefix/suffix, and not sent as Bearer", () => {
    it("refuses a suffixed key", async () => {
      await call("post", "/report/studentprogress", `${syncKey()}x`).expect(401);
    });

    it("refuses a truncated (prefix) key", async () => {
      await call("post", "/report/studentprogress", syncKey().slice(0, -1)).expect(401);
    });

    it("refuses the key sent as a Bearer token (central sends it raw, no Bearer)", async () => {
      await call("post", "/report/studentprogress", `Bearer ${syncKey()}`).expect(401);
    });
  });
});
