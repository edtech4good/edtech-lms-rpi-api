import { studentprogress } from "src/models/data-models/studentprogress";
import { StudentProgressBusiness } from "./studentprogress.business";

/**
 * Guards importStudentProgress against a payload that arrives pre-verified.
 *
 * bulkCreate(records, ...) with no `fields` list inserts every attribute
 * present on each record object, `verified` included — so a payload
 * assembled elsewhere (central, another Pi, or a bug/attacker upstream of
 * this route) that happens to carry `verified: true` would otherwise be
 * trusted outright. An imported row has no server-graded answers behind it
 * here (central has no grading of its own yet), so `verified` must always
 * be forced to false regardless of what the payload claims.
 */
jest.mock("src/models/data-models/studentprogress", () => ({
  studentprogress: { bulkCreate: jest.fn().mockResolvedValue(undefined) },
}));

const mockedBulkCreate = studentprogress.bulkCreate as jest.Mock;

describe("StudentProgressBusiness.importStudentProgress", () => {
  const transaction = {} as any;

  beforeEach(() => {
    mockedBulkCreate.mockClear();
  });

  it("forces verified:false even when the incoming record claims verified:true", async () => {
    const business = new StudentProgressBusiness();
    await business.importStudentProgress(
      [{ studentprogressid: "p1", verified: true } as any],
      transaction,
    );

    expect(mockedBulkCreate).toHaveBeenCalledTimes(1);
    const [records] = mockedBulkCreate.mock.calls[0];
    expect(records[0].verified).toBe(false);
  });

  it("leaves a record with no verified field at all defaulting to false", async () => {
    const business = new StudentProgressBusiness();
    await business.importStudentProgress([{ studentprogressid: "p2" } as any], transaction);

    const [records] = mockedBulkCreate.mock.calls[0];
    expect(records[0].verified).toBe(false);
  });

  it("does not let verified:true back in via updateOnDuplicate on a re-import", async () => {
    const business = new StudentProgressBusiness();
    await business.importStudentProgress(
      [{ studentprogressid: "p1", verified: true } as any],
      transaction,
    );

    const [, options] = mockedBulkCreate.mock.calls[0];
    expect(options.updateOnDuplicate).not.toContain("verified");
  });

  it("preserves every other field on the record unchanged", async () => {
    const business = new StudentProgressBusiness();
    const record = { studentprogressid: "p3", ispass: true, marks: 4, verified: true } as any;
    await business.importStudentProgress([record], transaction);

    const [records] = mockedBulkCreate.mock.calls[0];
    expect(records[0]).toMatchObject({ studentprogressid: "p3", ispass: true, marks: 4, verified: false });
  });
});
