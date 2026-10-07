/* eslint-disable @typescript-eslint/no-explicit-any */
import { ApiError } from "src/models/ApiError";
import { ErrorCode } from "src/models/enums/errorcode.enum";
import { Op, Transaction } from "sequelize";
import { SchoolRole } from "src/models/enums/school.role.enum";
import {
  schoolusers,
  students,
} from "../models/data-models/init-models";
import { byLogin, ExportKeys } from "./export-scope";
import { withRequiredSchoolIds } from "./school-identity";

export class SchoolUserBusiness {
  importschoolusers = async (
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
