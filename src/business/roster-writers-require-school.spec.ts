import { schools } from "src/models/data-models/school";
import { schoolusers, students } from "src/models/data-models/init-models";
import { SchoolUserBusiness } from "./schooluser.business";
import { StudentBusiness } from "./student.business";

/**
 * S4: `schoolusers.schoolid` and `students.schoolid` are required columns, so the three
 * roster writers answer a clean 400 BEFORE the write when a row names no school this server
 * has (the route-level behaviour is in src/modules/import/import.schoolid.spec.ts). Driven
 * here on the business classes themselves, so a caller other than the import controller gets
 * the same refusal.
 */
const A = "5c000000-0000-4000-8000-0000000000a1";
const tnx = { id: "the-transaction" } as never;

beforeEach(() => {
  jest.spyOn(schools, "findAll").mockImplementation((async (opts: { where: { logic: string } }) =>
    opts.where.logic.trim().toLowerCase() === "school a" ? [{ schoolid: A, schoolname: "School A", isdeleted: false }] : []) as never);
  jest.spyOn(schools, "findOne").mockImplementation((async (opts: { where: { schoolid: string } }) =>
    opts.where.schoolid === A ? { schoolid: A, schoolname: "School A" } : null) as never);
  jest.spyOn(schoolusers, "bulkCreate").mockImplementation((async (rows: unknown[]) => rows) as never);
  jest.spyOn(students, "bulkCreate").mockResolvedValue([] as never);
});
afterEach(() => jest.restoreAllMocks());

const REFUSAL = "1 row names no school this server has. A school must be here before its learners and logins. Nothing was written.";
const login = (extra: Record<string, unknown> = {}) => ({ schooluserid: "su1", schoolusername: "login1", ...extra }) as never;

describe("the roster writers refuse a row with no school before writing", () => {
  it("importschoolusers: a login that names no school this server has", async () => {
    await expect(new SchoolUserBusiness().importschoolusers([login({ schoolname: "School A" }), login({ schoolname: "Nowhere" })], tnx)).rejects.toMatchObject({
      status: 400,
      message: REFUSAL,
    });
    expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
  });

  it("importschoolteachers: a teacher that names no school this server has", async () => {
    await expect(new SchoolUserBusiness().importschoolteachers([login()], tnx)).rejects.toMatchObject({ status: 400, message: REFUSAL });
    expect(schoolusers.bulkCreate).not.toHaveBeenCalled();
  });

  it("importstudents: a learner that names no school this server has", async () => {
    const learner = (extra: Record<string, unknown>) => ({ studentid: "s1", schooluserid: "su1", ...extra }) as never;
    await expect(new StudentBusiness().importstudents([learner({ schoolname: "School A" }), learner({ schoolid: "5c000000-0000-4000-8000-0000000000ff" })], tnx)).rejects.toMatchObject({
      status: 400,
      message: REFUSAL,
    });
    expect(students.bulkCreate).not.toHaveBeenCalled();
  });

  it("a row that names a school this server has is written, with that school's id", async () => {
    await new SchoolUserBusiness().importschoolusers([login({ schoolname: "School A" })], tnx);
    await new SchoolUserBusiness().importschoolteachers([login({ schoolid: A })], tnx);
    await new StudentBusiness().importstudents([{ studentid: "s1", schooluserid: "su1", schoolname: "school a" } as never], tnx);
    expect((schoolusers.bulkCreate as jest.Mock).mock.calls.map((c) => c[0].map((r: { schoolid: string }) => r.schoolid))).toEqual([[A], [A]]);
    expect((students.bulkCreate as jest.Mock).mock.calls[0][0][0].schoolid).toBe(A);
  });

  it("no other method of the two classes writes a login or a learner", () => {
    const writers = (instance: object) =>
      Object.entries(instance)
        .filter(([, v]) => typeof v === "function")
        .map(([k]) => k)
        .filter((k) => /^(import|create|insert|add)/i.test(k))
        .sort();
    expect(writers(new SchoolUserBusiness())).toEqual(["importschoolteachers", "importschoolusers"]);
    expect(writers(new StudentBusiness())).toEqual(["importstudents"]);
  });
});
