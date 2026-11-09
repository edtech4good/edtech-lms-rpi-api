/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Op, Transaction } from "sequelize";
import { SchoolRole } from "src/models/enums/school.role.enum";
import {
  schoolusers,
  students,
  tokens,
} from "../models/data-models/init-models";
import { byLogin, ExportKeys } from "./export-scope";
import { withRequiredSchoolIds } from "./school-identity";

/**
 * Ends the sessions of every imported account that the import has just disabled, deleted or given a
 * new password. A token issued before the import is checked only against the `tokens` table, so
 * removing the account's rows there is what makes its next request answer 401.
 *
 * `before` is what the accounts' rows held before the upsert; the rows are read again here, after it,
 * so an account that is matched by its username rather than its id is still the one that is judged.
 * An account whose row is unchanged in these ways keeps its sessions: a roster is re-sent whole and
 * must not sign anyone out. It runs in the import's own transaction, so the account change and the
 * end of its sessions commit together or not at all. One read and one delete, however many accounts.
 */
const endSessionsOfChangedAccounts = async (
  rows: Array<{ schooluserid?: string; schoolusername?: string }>,
  before: Map<string, { hash: string | null }>,
  tnx: Transaction
): Promise<void> => {
  const after = await findImportedAccounts(rows, tnx);
  const ended = after
    .filter((u) => {
      if (u.isdisabled || u.isdeleted) {
        return true;
      }
      const prior = before.get(u.schooluserid);
      return prior !== undefined && prior.hash !== (u.schooluserpasswordhash ?? null);
    })
    .map((u) => u.schooluserid);
  if (ended.length > 0) {
    await tokens.destroy({ where: { lmsuserid: { [Op.in]: ended } }, transaction: tnx });
  }
};

const findImportedAccounts = async (
  rows: Array<{ schooluserid?: string; schoolusername?: string }>,
  tnx: Transaction
) => {
  const ids = rows.map((r) => r.schooluserid).filter((v): v is string => typeof v === "string");
  const names = rows.map((r) => r.schoolusername).filter((v): v is string => typeof v === "string");
  if (ids.length === 0 && names.length === 0) {
    return [];
  }
  return schoolusers.findAll({
    attributes: ["schooluserid", "schooluserpasswordhash", "isdisabled", "isdeleted"],
    where: { [Op.or]: [{ schooluserid: { [Op.in]: ids } }, { schoolusername: { [Op.in]: names } }] },
    transaction: tnx,
  });
};

const passwordHashesBefore = async (
  rows: Array<{ schooluserid?: string; schoolusername?: string }>,
  tnx: Transaction
) =>
  new Map(
    (await findImportedAccounts(rows, tnx)).map((u) => [
      u.schooluserid,
      { hash: u.schooluserpasswordhash ?? null },
    ])
  );

export class SchoolUserBusiness {
  importschoolusers = async (
    newschooluser: Array<schoolusers>,
    tnx: Transaction
  ) => {
    const before = await passwordHashesBefore(newschooluser, tnx);
    const result = await this.upsertlearners(newschooluser, tnx);
    await endSessionsOfChangedAccounts(newschooluser, before, tnx);
    return result;
  };
  private upsertlearners = async (
    newschooluser: Array<schoolusers>,
    tnx: Transaction
  ) =>
    schoolusers.bulkCreate(
      // Carry the source role from the central export (which sends the real
      // `schooluserrole` — `exclude: []`), don't force STUDENT. The online
      // student sync includes teachers (they carry a `students` row), so forcing
      // STUDENT here stored them as students and, because `schooluserrole` is in
      // `updateOnDuplicate`, a re-sync overwrote an existing teacher TEACHER->STUDENT.
      // Fall back to STUDENT only if a row arrives without a role.
      //
      // `schoolid` follows the row's school (the id it carries, else its name
      // resolved), so the id is rewritten with the name and never left stale. A row
      // with no school this server has refuses the whole write (the column is required).
      (await withRequiredSchoolIds(newschooluser, tnx)).map((x) => ({
        ...x,
        schooluserrole: x.schooluserrole ?? SchoolRole.STUDENT,
      })),
      {
        transaction: tnx,
        updateOnDuplicate: [
          "schoolusername",
          "schooluserpasswordhash",
          "schooluserrole",
          "schooluserstatus",
          "schoolname",
          "schoolid",
          "isdisabled",
          // So a learner soft-deleted on central propagates here on re-sync and
          // is then refused at login. Without this, the flag would ride the
          // export (exclude: []) but never overwrite the existing rpi row.
          "isdeleted",
        ],
      }
    );
  importschoolteachers = async (
    newschooluser: Array<schoolusers>,
    transaction: Transaction
  ) => {
    const before = await passwordHashesBefore(newschooluser, transaction);
    const result = await this.upsertteachers(newschooluser, transaction);
    await endSessionsOfChangedAccounts(newschooluser, before, transaction);
    return result;
  };
  private upsertteachers = async (
    newschooluser: Array<schoolusers>,
    transaction: Transaction
  ) =>
    schoolusers.bulkCreate(
      (await withRequiredSchoolIds(newschooluser, transaction)).map((x) => ({ ...x, schooluserrole: SchoolRole.TEACHER })),
      {
        transaction,
        // Upsert (matches importschoolusers). Without this a re-import of an
        // existing teacher throws on the duplicate PK, and a soft-deleted
        // teacher's `isdeleted` never lands here — so the login guard could not
        // block them via this path. (Teachers also ride the student re-sync
        // since they carry a `students` row, but keep this path consistent.)
        updateOnDuplicate: [
          "schoolusername",
          "schooluserpasswordhash",
          "schooluserrole",
          "schooluserstatus",
          "schoolname",
          "schoolid",
          "isdisabled",
          "isdeleted",
        ],
      }
    );
  deleteallteachers = () =>
    schoolusers.destroy({
      where: {
        schooluserrole: SchoolRole.TEACHER,
        schoolusername: { [Op.notLike]: "testteacher" },
      },
    });

  getuser = async (schooluserid: string) => {
    const _user = await schoolusers.findOne({ where: { schooluserid } });
    if (_user) {
      return _user.get({ plain: true });
    }
    throw new ApiError(ErrorCode.SIGN_IN_REQUIRED);
  };

  getuserbyid = (schooluserid: string) =>
    schoolusers.findOne({ where: { schooluserid } });

  getuserbyname = (schoolusername: string) =>
    schoolusers.findOne({ where: { schoolusername } });

  /** The active school logins with their learner rows, for the report data (`keys` limits them to a scope; `null` is every one). */
  getschoolusers = async (keys: ExportKeys | null) => {
    schoolusers.hasOne(students, {
      foreignKey: "schooluserid",
      sourceKey: "schooluserid",
    });
    students.belongsTo(schoolusers, {
      foreignKey: "schooluserid",
    });

    return schoolusers.findAll({
      where: {
        schooluserstatus: true,
        ...byLogin(keys, "schooluserid"),
      },
      attributes: {
        exclude: ["schooluserpasswordhash"],
      },
      include: [
        {
          model: students,
          required: false
        },
      ],
    });
  };
}
