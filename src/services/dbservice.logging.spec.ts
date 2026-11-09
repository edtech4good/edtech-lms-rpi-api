import { dbinstance } from "./dbservice";

// The instance is built lazily and cached; clear the cache so each case
// builds its own. Building does not open a connection.
const build = (flag: string | undefined) => {
  const previous = process.env.DB_LOG_SQL;
  if (flag === undefined) delete process.env.DB_LOG_SQL;
  else process.env.DB_LOG_SQL = flag;
  (dbinstance as unknown as { sequelize?: unknown }).sequelize = undefined;
  try {
    return (dbinstance.getdbinstance() as unknown as { options: { logging: unknown } }).options.logging;
  } finally {
    if (previous === undefined) delete process.env.DB_LOG_SQL;
    else process.env.DB_LOG_SQL = previous;
    (dbinstance as unknown as { sequelize?: unknown }).sequelize = undefined;
  }
};

describe("dbinstance logging", () => {
  it("does not print database statements when DB_LOG_SQL is unset", () => {
    expect(build(undefined)).toBe(false);
  });

  it.each(["0", "", "true", "yes"])("does not print when DB_LOG_SQL is %p", (value) => {
    expect(build(value)).toBe(false);
  });

  it("prints database statements when DB_LOG_SQL is 1", () => {
    expect(typeof build("1")).toBe("function");
  });
});
