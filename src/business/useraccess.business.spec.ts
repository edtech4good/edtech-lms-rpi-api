import { Op } from "sequelize";
import { rpiuseraccess } from "src/models/data-models/rpiuseraccess";
import { UserAccessBusiness } from "./useraccess.business";

/**
 * The access-log row's primary key is generated here with node:crypto's
 * randomUUID() (it replaced the `uuid` package). Pin what gets persisted: an
 * RFC 4122 v4 id, 36 characters, lower case, fresh per row. The model is
 * stubbed, so this needs no database.
 */
describe("UserAccessBusiness.createuseraccesslog", () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  beforeEach(() => {
    jest.spyOn(rpiuseraccess, "update").mockResolvedValue([0] as any);
    jest.spyOn(rpiuseraccess, "create").mockResolvedValue({} as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it("persists a v4 uuid as rpiuseraccessid, a new one each time", async () => {
    const business = new UserAccessBusiness();
    await business.createuseraccesslog("user-1", "127.0.0.1", Date.now());
    await business.createuseraccesslog("user-1", "127.0.0.1", Date.now());

    const rows = (rpiuseraccess.create as jest.Mock).mock.calls.map((c) => c[0]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.rpiuseraccessid).toHaveLength(36);
      expect(row.rpiuseraccessid).toMatch(V4);
    }
    expect(rows[1].rpiuseraccessid).not.toBe(rows[0].rpiuseraccessid);
  });

  it("writes the new access row before it closes the previous session, and the close leaves the new row alone", async () => {
    const calls: string[] = [];
    (rpiuseraccess.create as jest.Mock).mockImplementation(async () => { calls.push("create"); return {}; });
    (rpiuseraccess.update as jest.Mock).mockImplementation(async () => { calls.push("update"); return [1]; });
    await new UserAccessBusiness().createuseraccesslog("user-1", "127.0.0.1", Date.now());
    expect(calls).toEqual(["create", "update"]);
    const id = (rpiuseraccess.create as jest.Mock).mock.calls[0][0].rpiuseraccessid;
    const where = (rpiuseraccess.update as jest.Mock).mock.calls[0][1].where;
    expect(where).toMatchObject({ userid: "user-1", status: 1 });
    expect(where.rpiuseraccessid[Op.ne]).toBe(id);
  });

  it("a refused access row closes nothing: the previous session stays open", async () => {
    (rpiuseraccess.create as jest.Mock).mockRejectedValue(new Error("Data too long for column 'ipaddress'"));
    await expect(new UserAccessBusiness().createuseraccesslog("user-1", "x".repeat(60), Date.now())).rejects.toThrow("Data too long");
    expect(rpiuseraccess.update).not.toHaveBeenCalled();
  });
});
