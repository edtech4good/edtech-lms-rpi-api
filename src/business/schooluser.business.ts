/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from "@nestjs/common";
import { hashPassword } from "src/services/password.service";
import { Op, Transaction } from "sequelize";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { v4 as uuidv4 } from "uuid";
import {
  schoolusers,
  schoolusersAttributes,
  students,
} from "../models/data-models/init-models";

export class SchoolUserBusiness {
  importschooluser = async (newschooluser: schoolusers) => {
    const newschoolusersresult = await schoolusers.create({ ...newschooluser });
    return {
      ...newschooluser,
      schooluser: newschoolusersresult.get({ plain: true }),
    };
  };
  importschoolusers = async (
    newschooluser: Array<schoolusers>,
    tnx: Transaction
  ) =>
    schoolusers.bulkCreate(
      newschooluser.map((x) => ({ ...x, schooluserrole: SchoolRole.STUDENT })),
      {
        transaction: tnx,
        updateOnDuplicate: [
          "schoolusername",
          "schooluserpasswordhash",
          "schooluserrole",
          "schooluserstatus",
          "schoolname",
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
      newschooluser.map((x) => ({ ...x, schooluserrole: SchoolRole.TEACHER })),
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
          "isdisabled",
          "isdeleted",
        ],
      }
    );
  importschoolteacher = async (newteacheruser: schoolusers) => {
    const newteacherusersresult = await schoolusers.create({
      ...newteacheruser,
      schooluserrole: SchoolRole.TEACHER,
    });
    return newteacherusersresult.get({ plain: true });
  };
  deleteallteachers = () =>
    schoolusers.destroy({
      where: {
        schooluserrole: SchoolRole.TEACHER,
        schoolusername: { [Op.notLike]: "testteacher" },
      },
    });

  createUser = async (user: schoolusersAttributes) => {
    user.schooluserid = uuidv4();
    user.schooluserpasswordhash = hashPassword(user.schooluserpasswordhash);
    user.isdisabled = false;
    return schoolusers.create(user);
  };

  getuser = async (schooluserid: string) => {
    const _user = await schoolusers.findOne({ where: { schooluserid } });
    if (_user) {
      return _user.get({ plain: true });
    }
    throw new BadRequestException("Please authenticate");
  };

  getuserbyid = (schooluserid: string) =>
    schoolusers.findOne({ where: { schooluserid } });

  getuserbyname = (schoolusername: string) =>
    schoolusers.findOne({ where: { schoolusername } });

  sanitizeUser = (user: any) => ({
    ...user,
    _id: null,
    passwordhash: null,
  });

  getschoolusers = async () => {
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
      },
      attributes: {
        exclude: [],
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
