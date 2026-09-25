import { ArgumentsHost } from "@nestjs/common";
import { ConnectionError } from "sequelize";
import { studentprogress } from "src/models/data-models/init-models";
import { dbinstance } from "src/services/dbservice";
import { GlobalExceptionFilter } from "src/filters/global-exception.filter";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { ResultBusiness } from "./result.business";

/**
 * Guards the "unwrap wrapped errors" fix (docs/api-errors.md, and the
 * matching change in result.controller.ts / lesson.business.ts /
 * student.business.ts): a DB failure on a result save used to be caught and
 * rethrown as `new BadRequestException({ error: true, errormessage:
 * err.message })`, so the global filter saw a plain 400 HttpException and
 * the client — which treats 4xx on a result save as bad data — would
 * eventually drop the submission. Rethrowing the ORIGINAL Sequelize error
 * lets the filter's own mapping turn a connection failure into a 503,
 * which the client retries instead of discarding.
 */
describe("ResultBusiness.createbaselinequestionprogress DB-failure unwrapping", () => {
  const fakeTransaction = { commit: jest.fn(), rollback: jest.fn() };

  beforeEach(() => {
    jest.spyOn(dbinstance.getdbinstance(), "transaction").mockResolvedValue(fakeTransaction as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rethrows the original Sequelize error (not a BadRequestException wrapping it), and rolls back the transaction", async () => {
    const dbFailure = new ConnectionError(new Error("ECONNREFUSED 10.0.0.5:3306"));
    jest.spyOn(studentprogress, "create").mockRejectedValue(dbFailure);

    const promise = new ResultBusiness().createbaselinequestionprogress(
      { marks: 1, points: 1, fullpoints: 1, passpercentage: 100 },
      {} as any,
      { studentid: "s1" } as any
    );

    await expect(promise).rejects.toBe(dbFailure);
    expect(fakeTransaction.rollback).toHaveBeenCalledTimes(1);
    expect(fakeTransaction.commit).not.toHaveBeenCalled();
  });

  it("end to end: that same DB failure reaches the client as 503 SERVICE_UNAVAILABLE, not a 400", async () => {
    const dbFailure = new ConnectionError(new Error("ECONNREFUSED 10.0.0.5:3306"));
    jest.spyOn(studentprogress, "create").mockRejectedValue(dbFailure);

    let caught: unknown;
    try {
      await new ResultBusiness().createbaselinequestionprogress(
        { marks: 1, points: 1, fullpoints: 1, passpercentage: 100 },
        {} as any,
        { studentid: "s1" } as any
      );
    } catch (e) {
      caught = e;
    }

    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: "POST", route: { path: "/result/baseline/:curriculumbaselineid" } }),
      }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(caught, host);

    expect(response.status).toHaveBeenCalledWith(503);
    const body = (response.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|ECONNREFUSED/);
  });
});
