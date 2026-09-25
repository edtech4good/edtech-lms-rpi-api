import { ArgumentsHost } from "@nestjs/common";
import { ConnectionError } from "sequelize";
import { lessonpractices } from "src/models/data-models/lessonpractices";
import { studentprogress } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { ResultController } from "./result.controller";

/**
 * A second unwrapped-DB-failure site (result.controller.ts's own
 * try/catch, distinct from the business-layer ones covered in
 * result.business.spec.ts): savelessonpracticeresult's catch used to wrap
 * any error — including a Sequelize connection failure — into a plain
 * `BadRequestException` (400). Rethrowing the original error lets the
 * global filter's own mapping turn a connection failure into 503, which
 * the client retries instead of dropping the submission.
 */
describe("ResultController.savelessonpracticeresult DB-failure unwrapping", () => {
  const fakeTransaction = { commit: jest.fn(), rollback: jest.fn() };

  beforeEach(() => {
    jest.spyOn(studentprogress, "count").mockResolvedValue(1 as any); // ispass() -> true
    jest.spyOn(lessonpractices, "findOne").mockResolvedValue({
      lessonpracticeid: "lp1",
      lessonid: "l1",
      points: 10,
      getLesson: jest.fn().mockResolvedValue({ practices_points: 5 }),
    } as any);
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(fakeTransaction as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rethrows the original Sequelize error (not a BadRequestException wrapping it), and rolls back the transaction", async () => {
    const dbFailure = new ConnectionError(new Error("ECONNREFUSED 10.0.0.9:3306"));
    jest
      .spyOn(studentprogress, "findOne")
      .mockResolvedValueOnce(null) // getoldpoints()
      .mockRejectedValueOnce(dbFailure); // updatePracticePoints()

    const promise = new ResultController().savelessonpracticeresult(
      "lp1",
      { starttime: new Date() } as any,
      { studentid: "s1" } as any
    );

    await expect(promise).rejects.toBe(dbFailure);
    expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(fakeTransaction.commit).not.toHaveBeenCalled();
  });

  it("end to end: that same DB failure reaches the client as 503 SERVICE_UNAVAILABLE, not a 400", async () => {
    const dbFailure = new ConnectionError(new Error("ECONNREFUSED 10.0.0.9:3306"));
    jest
      .spyOn(studentprogress, "findOne")
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(dbFailure);

    let caught: unknown;
    try {
      await new ResultController().savelessonpracticeresult(
        "lp1",
        { starttime: new Date() } as any,
        { studentid: "s1" } as any
      );
    } catch (e) {
      caught = e;
    }

    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: "POST", route: { path: "/result/lesson/practice/:lessonpracticeid" } }),
      }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(caught, host);

    expect(response.status).toHaveBeenCalledWith(503);
    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.9|ECONNREFUSED/);
  });
});
