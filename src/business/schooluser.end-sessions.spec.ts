import { UnauthorizedException } from "@nestjs/common";
import { Op } from "sequelize";
import { schoolusers, tokens } from "src/models/data-models/init-models";
import { JwtAccessStrategy } from "src/services/auth.strategy";
import { SchoolUserBusiness } from "./schooluser.business";

/**
 * A roster import that disables or deletes an account, or changes its password, ends that account's
 * sessions: the next request made with a token issued before the import answers 401. An account the
 * import leaves as it was keeps its sessions (a roster is re-sent whole).
 *
 * The import only names the accounts (inside its transaction); the removal is `endsessions`, run once
 * after the commit, as the controller does. `importThenCommit` below is that sequence.
 *
 * No database: the login rows and the token rows are in-memory lists behind the real models' methods;
 * the import, the session removal and the strategy that answers each request are the real code.
 */
jest.mock("src/business/school-identity", () => ({
  withRequiredSchoolIds: jest.fn(async (rows: unknown[]) => rows),
}));
jest.mock("src/business/token-claims", () => ({ checkTokenClaims: jest.fn().mockResolvedValue(undefined) }));

type Row = {
  schooluserid: string;
  schoolusername: string;
  schooluserpasswordhash: string;
  schooluserstatus?: boolean;
  schoolid?: string;
  student?: { standard: string };
  isdisabled?: boolean;
  isdeleted?: boolean;
};
type Where = { [Op.or]?: Array<Record<string, { [Op.in]: string[] }>> };

let users: Row[];
let tokenRows: Array<{ token: string; lmsuserid: string; tokentype: string }>;
let destroyCalls: number;
const tnx = {} as never;
const strategy = () => new JwtAccessStrategy();

const A = "a1000000-0000-4000-8000-0000000000a1";
const B = "b2000000-0000-4000-8000-0000000000b2";
const C = "c3000000-0000-4000-8000-0000000000c3";
const SCHOOL_ONE = "51000000-0000-4000-8000-000000000001";
const SCHOOL_TWO = "52000000-0000-4000-8000-000000000002";
const row = (id: string, name: string, extra: Partial<Row> = {}): Row => ({
  schooluserid: id,
  schoolusername: name,
  schooluserpasswordhash: "hash-" + name,
  schooluserstatus: true,
  schoolid: SCHOOL_ONE,
  isdisabled: false,
  isdeleted: false,
  ...extra,
});

const signIn = (id: string) => tokenRows.push({ token: "jti-" + id, lmsuserid: id, tokentype: "access" });
/** What the API answers to a request carrying the token that `signIn` issued. */
const request = async (id: string): Promise<number> => {
  try {
    await strategy().validate({ jti: "jti-" + id, sub: id });
    return 200;
  } catch (e) {
    if (e instanceof UnauthorizedException) {
      return 401;
    }
    throw e;
  }
};

beforeEach(() => {
  users = [row(A, "ann"), row(B, "ben")];
  tokenRows = [];
  destroyCalls = 0;
  jest.spyOn(schoolusers, "findAll").mockImplementation((async (opts: { where: Where }) => {
    const [byId, byName] = opts.where[Op.or] ?? [];
    return users
      .filter((u) => byId?.schooluserid?.[Op.in].includes(u.schooluserid) || byName?.schoolusername?.[Op.in].includes(u.schoolusername))
      .map((u) => ({ ...u }));
  }) as never);
  jest.spyOn(schoolusers, "bulkCreate").mockImplementation((async (rows: Row[], opts: { updateOnDuplicate: Array<keyof Row> }) => {
    for (const r of rows) {
      // the table's keys: the id, and the unique username (a row naming an existing username updates that row)
      const existing = users.find((u) => u.schooluserid === r.schooluserid || u.schoolusername === r.schoolusername);
      if (!existing) {
        users.push({ isdisabled: false, isdeleted: false, ...r });
      } else {
        for (const f of opts.updateOnDuplicate) {
          if (f in r) {
            (existing as Record<string, unknown>)[f] = r[f];
          }
        }
      }
    }
    return rows;
  }) as never);
  jest.spyOn(tokens, "count").mockImplementation((async (opts: { where: { token: string } }) =>
    tokenRows.filter((t) => t.token === opts.where.token).length) as never);
  jest.spyOn(tokens, "destroy").mockImplementation((async (opts: { where: { lmsuserid: string | { [Op.in]: string[] } } }) => {
    destroyCalls++;
    const w = opts.where.lmsuserid;
    const ids = typeof w === "string" ? [w] : w[Op.in];
    tokenRows = tokenRows.filter((t) => !ids.includes(t.lmsuserid));
    return 0;
  }) as never);
});

/** What the controller does: import in the transaction, commit, then end the sessions once. */
const importThenCommit = async (rows: Row[], write: (b: SchoolUserBusiness, set: Set<string>) => Promise<unknown>) => {
  const business = new SchoolUserBusiness();
  const sessionsToEnd = new Set<string>();
  await write(business, sessionsToEnd);
  expect(destroyCalls).toBe(0); // nothing is deleted while the transaction is open
  await business.endsessions(sessionsToEnd);
};
const importLearners = (rows: Row[]) => importThenCommit(rows, (b, set) => b.importschoolusers(rows as never, tnx, set));
const importTeachers = (rows: Row[]) => importThenCommit(rows, (b, set) => b.importschoolteachers(rows as never, tnx, set));
const imports: Array<[string, (rows: Row[]) => Promise<unknown>]> = [
  ["learner", importLearners],
  ["teacher", importTeachers],
];

describe.each(imports)("the %s roster import and sessions", (_name, run) => {
  it("keeps every session when a roster is re-sent unchanged", async () => {
    signIn(A);
    signIn(B);
    await run([row(A, "ann"), row(B, "ben")]);
    expect(await request(A)).toBe(200);
    expect(await request(B)).toBe(200);
    expect(destroyCalls).toBe(0);
  });

  it("an import that disables an account ends its sessions and only its", async () => {
    signIn(A);
    signIn(B);
    await run([row(A, "ann", { isdisabled: true }), row(B, "ben")]);
    expect(await request(A)).toBe(401);
    expect(await request(B)).toBe(200);
  });

  it("an import that enables an account ends nobody's sessions", async () => {
    users = [row(A, "ann", { isdisabled: true }), row(B, "ben")];
    signIn(B);
    await run([row(A, "ann", { isdisabled: false }), row(B, "ben")]);
    expect(await request(B)).toBe(200);
    expect(destroyCalls).toBe(0);
  });

  it("an import that changes a password hash ends that account's sessions and only its", async () => {
    signIn(A);
    signIn(B);
    await run([row(A, "ann", { schooluserpasswordhash: "a-new-hash" }), row(B, "ben")]);
    expect(await request(A)).toBe(401);
    expect(await request(B)).toBe(200);
  });

  it("an import that deletes an account ends its sessions", async () => {
    signIn(A);
    signIn(B);
    await run([row(A, "ann", { isdeleted: true }), row(B, "ben")]);
    expect(await request(A)).toBe(401);
    expect(await request(B)).toBe(200);
  });

  it("an import that adds an account is fine and ends nobody's sessions", async () => {
    signIn(A);
    await run([row(A, "ann"), row(C, "cat")]);
    expect(users.map((u) => u.schooluserid)).toContain(C);
    expect(await request(A)).toBe(200);
    expect(destroyCalls).toBe(0);
  });

  it("ends the sessions of every changed account with one removal", async () => {
    users = [row(A, "ann"), row(B, "ben"), row(C, "cat")];
    signIn(A);
    signIn(B);
    signIn(C);
    await run([row(A, "ann", { isdisabled: true }), row(B, "ben", { schooluserpasswordhash: "new" }), row(C, "cat")]);
    expect(destroyCalls).toBe(1);
    expect([await request(A), await request(B), await request(C)]).toEqual([401, 401, 200]);
  });

  it("an import that switches an account's login off (status) ends its sessions", async () => {
    signIn(A);
    signIn(B);
    await run([row(A, "ann", { schooluserstatus: false }), row(B, "ben")]);
    expect(await request(A)).toBe(401);
    expect(await request(B)).toBe(200);
  });

  it("a row with a new id and an existing username, disabled, ends the sessions of the account that username belongs to", async () => {
    signIn(A);
    signIn(B);
    await run([row(C, "ann", { isdisabled: true })]);
    expect(users.find((u) => u.schooluserid === A)?.isdisabled).toBe(true);
    expect(await request(A)).toBe(401);
    expect(await request(B)).toBe(200);
  });

  it("an account that stays disabled in a re-sent roster stays without sessions", async () => {
    users = [row(A, "ann", { isdisabled: true })];
    signIn(A);
    await run([row(A, "ann", { isdisabled: true })]);
    expect(await request(A)).toBe(401);
  });

  it("an import that moves an account to another school ends its sessions", async () => {
    signIn(A);
    await run([row(A, "ann", { schoolid: SCHOOL_TWO })]);
    expect(users.find((u) => u.schooluserid === A)?.schoolid).toBe(SCHOOL_TWO);
    expect(await request(A)).toBe(401);
  });

  it("an import that keeps the school and only changes the class keeps the sessions", async () => {
    signIn(A);
    await run([row(A, "ann", { student: { standard: "class-two" } })]);
    expect(await request(A)).toBe(200);
    expect(destroyCalls).toBe(0);
  });

  it("a mixed roster, one moved and one not, ends only the moved account's sessions", async () => {
    signIn(A);
    signIn(B);
    await run([row(A, "ann", { schoolid: SCHOOL_TWO }), row(B, "ben")]);
    expect([await request(A), await request(B)]).toEqual([401, 200]);
  });

  it("an account that is moved and disabled in the same import is ended once", async () => {
    signIn(A);
    await run([row(A, "ann", { schoolid: SCHOOL_TWO, isdisabled: true })]);
    expect(await request(A)).toBe(401);
    expect(destroyCalls).toBe(1);
  });

  it("an account that is new in the import is not treated as moved", async () => {
    signIn(A);
    await run([row(A, "ann"), row(C, "cat", { schoolid: SCHOOL_TWO })]);
    expect(users.map((u) => u.schooluserid)).toContain(C);
    expect(await request(A)).toBe(200);
    expect(destroyCalls).toBe(0);
  });
});
