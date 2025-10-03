/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from "@nestjs/common";
import md5 from "crypto-js/md5";
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
    user.schooluserpasswordhash = md5(user.schooluserpasswordhash).toString();
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
