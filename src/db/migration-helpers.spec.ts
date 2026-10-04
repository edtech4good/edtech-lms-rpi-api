import { removeColumnIfPresent, tableOptionsMatchingColumn } from "./migration-helpers";

/** The two helpers ported from the central API (same names, same behaviour). */
const TX = { id: "tx" } as never;

describe("removeColumnIfPresent", () => {
  it("removes the column, in the transaction, when it is there", async () => {
    const qi = { describeTable: jest.fn().mockResolvedValue({ a: {}, b: {} }), removeColumn: jest.fn().mockResolvedValue(undefined) };
    await removeColumnIfPresent(qi as never, "t", "b", TX);
    expect(qi.removeColumn).toHaveBeenCalledWith("t", "b", { transaction: TX });
  });

  it("does nothing when the column is already gone", async () => {
    const qi = { describeTable: jest.fn().mockResolvedValue({ a: {} }), removeColumn: jest.fn() };
    await removeColumnIfPresent(qi as never, "t", "b", TX);
    expect(qi.removeColumn).not.toHaveBeenCalled();
  });

  it("does nothing, and does not throw, when the table itself is gone", async () => {
    const qi = { describeTable: jest.fn().mockRejectedValue(new Error("No description found")), removeColumn: jest.fn() };
    await expect(removeColumnIfPresent(qi as never, "t", "b", TX)).resolves.toBeUndefined();
    expect(qi.removeColumn).not.toHaveBeenCalled();
  });
});

describe("tableOptionsMatchingColumn", () => {
  const qiReturning = (rows: unknown[]) => ({ sequelize: { query: jest.fn().mockResolvedValue([rows]) } });

  it("returns the charset and collation of the named column, asking for exactly that column", async () => {
    const qi = qiReturning([{ cs: "utf8mb4", coll: "utf8mb4_0900_ai_ci" }]);
    await expect(tableOptionsMatchingColumn(qi as never, "schools", "schoolid")).resolves.toEqual({
      charset: "utf8mb4",
      collate: "utf8mb4_0900_ai_ci",
    });
    expect(qi.sequelize.query.mock.calls[0][1]).toEqual({ replacements: ["schools", "schoolid"] });
  });

  it("falls back to utf8mb4 / utf8mb4_unicode_ci when the column is not found", async () => {
    await expect(tableOptionsMatchingColumn(qiReturning([]) as never, "x", "y")).resolves.toEqual({
      charset: "utf8mb4",
      collate: "utf8mb4_unicode_ci",
    });
  });
});
