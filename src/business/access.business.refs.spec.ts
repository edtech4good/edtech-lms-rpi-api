import { studentappusages } from "src/models/data-models/studentappusage";
import { schoolusers } from "src/models/data-models/schoolusers";
import { Token } from "src/models/token.model";
import { AccessBusiness } from "./access.business";

/**
 * `studentappusages.schooluserid` is a foreign key to `schoolusers` (20261026120000-foreign-keys-and-not-nulls). The
 * row that records a first day of usage names the caller's login; a login this server does not hold is answered as
 * not found, and nothing is written.
 */
const body = { starttime: "2026-10-26T01:00:00.000Z", endtime: "2026-10-26T01:10:00.000Z" } as never;

beforeEach(() => {
  jest.spyOn(studentappusages, "findOne").mockResolvedValue(null as never);
  jest.spyOn(studentappusages, "create").mockResolvedValue({} as never);
});
afterEach(() => jest.restoreAllMocks());

describe("AccessBusiness.updatestudentusage", () => {
  it("records the first usage of a login this server holds", async () => {
    jest.spyOn(schoolusers, "count").mockResolvedValue(1 as never);
    await new AccessBusiness().updatestudentusage(body, { schooluserid: "su-1" } as Token);
    expect(studentappusages.create).toHaveBeenCalledWith(expect.objectContaining({ schooluserid: "su-1", time_spent: 600 }));
  });

  it("a login this server does not hold is not found, and no usage row is written", async () => {
    jest.spyOn(schoolusers, "count").mockResolvedValue(0 as never);
    await expect(new AccessBusiness().updatestudentusage(body, { schooluserid: "su-gone" } as Token)).rejects.toMatchObject({ status: 404 });
    expect(studentappusages.create).not.toHaveBeenCalled();
  });

  it("does not look the login up when the day's row is already there (the key was satisfied when it was written)", async () => {
    const count = jest.spyOn(schoolusers, "count").mockResolvedValue(0 as never);
    const row = { time_spent: 5, last_updated: "", save: jest.fn() };
    (studentappusages.findOne as jest.Mock).mockResolvedValue(row);
    await new AccessBusiness().updatestudentusage(body, { schooluserid: "su-1" } as Token);
    expect(count).not.toHaveBeenCalled();
    expect(row.save).toHaveBeenCalled();
  });
});
