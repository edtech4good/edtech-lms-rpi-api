import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import type { curriculums, curriculumsId } from "./curriculums";
import type { grades, gradesId } from "./grades";
import type { lessons, lessonsId } from "./lessons";
import type { levels, levelsId } from "./levels";
import { schools } from "./school";
import type { schoolusers, schoolusersId } from "./schoolusers";
import { standards } from "./standards";
import { studentprogress } from "./studentprogress";

export interface studentsAttributes {
  studentid: string;
  studentfirstname: string;
  studentlastname?: string;
  familyname?: string;
  mothername?: string;
  fathername?: string;
  contact?: string;
  dateofbirth?: Date;
  genderid: number;
  standard?: string;
  schooltype?: string;
  schoolname?: string;
  city: string;
  country: string;
  state: string;
  dateofjoin?: Date;
  curriculumid: string;
  gradeid?: string;
  startinglevelid?: string;
  studentcurrentlevelid?: string;
  studentcurrentlessonid?: string;
  isactive: number;
  schooluserid: string;
  profileimage?: string;
  type?: string;
  active?: number;

  status?: boolean;
  lastLogin?: Date;
  totalusages?: number;
  studentprogresses?: studentprogress[];
  laststudentprogress?: studentprogress;
  studentprogress?: studentprogress;
  membersince?: string;
  numbercompletedlessons?: number;
  is_teacher_acc?: boolean;

  curriculum?: curriculums;
  curriculumids?: Array<string>;
  grade?: grades;
  level?: levels;
  lesson?: lessons;
  school?: schools;
  class?: standards;

  // for search
  "$schooluser.schoolusername$"?: string;
  "$school.countryid$"?: string;

  index?: number;
  schooluser?: schoolusers;
}

export type studentsPk = "studentid";
export type studentsId = students[studentsPk];
export type studentsOptionalAttributes =
  | "studentid"
  | "studentlastname"
  | "familyname"
  | "mothername"
  | "fathername"
  | "contact"
  | "dateofbirth"
  | "standard"
  | "schooltype"
  | "schoolname"
  | "dateofjoin"
  | "gradeid"
  | "startinglevelid"
  | "studentcurrentlevelid"
  | "studentcurrentlessonid"
  | "isactive";
export type studentsCreationAttributes = Optional<
  studentsAttributes,
  studentsOptionalAttributes
>;

export class students
  extends Model<studentsAttributes, studentsCreationAttributes>
  implements studentsAttributes
{
  studentid!: string;
  studentfirstname!: string;
  studentlastname?: string;
  familyname?: string;
  mothername?: string;
  fathername?: string;
  contact?: string;
  dateofbirth?: Date;
  genderid!: number;
  standard?: string;
  schooltype?: string;
  schoolname?: string;
  city!: string;
  country!: string;
  state!: string;
  dateofjoin?: Date;
  curriculumid!: string;
  gradeid?: string;
  startinglevelid?: string;
  studentcurrentlevelid?: string;
  studentcurrentlessonid?: string;
  isactive!: number;
  schooluserid!: string;
  profileimage!: string;
  type!: string;
  active!: number;
  is_teacher_acc!: boolean;

  curriculumids?: Array<string>;
  // students belongsTo curriculums via curriculumid
  curriculum!: curriculums;
  getCurriculum!: Sequelize.BelongsToGetAssociationMixin<curriculums>;
  setCurriculum!: Sequelize.BelongsToSetAssociationMixin<
    curriculums,
    curriculumsId
  >;
  createCurriculum!: Sequelize.BelongsToCreateAssociationMixin<curriculums>;
  // students belongsTo grades via gradeid
  grade!: grades;
  getGrade!: Sequelize.BelongsToGetAssociationMixin<grades>;
  setGrade!: Sequelize.BelongsToSetAssociationMixin<grades, gradesId>;
  createGrade!: Sequelize.BelongsToCreateAssociationMixin<grades>;
  // students belongsTo lessons via studentcurrentlessonid
  studentcurrentlesson!: lessons;
  getStudentcurrentlesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;
  setStudentcurrentlesson!: Sequelize.BelongsToSetAssociationMixin<
    lessons,
    lessonsId
  >;
  createStudentcurrentlesson!: Sequelize.BelongsToCreateAssociationMixin<lessons>;
  // students belongsTo levels via startinglevelid
  startinglevel!: levels;
  getStartinglevel!: Sequelize.BelongsToGetAssociationMixin<levels>;
  setStartinglevel!: Sequelize.BelongsToSetAssociationMixin<levels, levelsId>;
  createStartinglevel!: Sequelize.BelongsToCreateAssociationMixin<levels>;
  // students belongsTo levels via studentcurrentlevelid
  studentcurrentlevel!: levels;
  getStudentcurrentlevel!: Sequelize.BelongsToGetAssociationMixin<levels>;
  setStudentcurrentlevel!: Sequelize.BelongsToSetAssociationMixin<
    levels,
    levelsId
  >;
  createStudentcurrentlevel!: Sequelize.BelongsToCreateAssociationMixin<levels>;
  // students belongsTo schoolusers via schooluserid
  schooluser!: schoolusers;
  getSchooluser!: Sequelize.BelongsToGetAssociationMixin<schoolusers>;
  setSchooluser!: Sequelize.BelongsToSetAssociationMixin<
    schoolusers,
    schoolusersId
  >;
  createSchooluser!: Sequelize.BelongsToCreateAssociationMixin<schoolusers>;

  static initModel(sequelize: Sequelize.Sequelize): typeof students {
    students.init(
      {
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentfirstname: {
          type: DataTypes.STRING(45),
          allowNull: false,
        },
        studentlastname: {
          type: DataTypes.STRING(45),
          allowNull: true,
        },
        familyname: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        mothername: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        fathername: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        contact: {
          type: DataTypes.STRING(20),
          allowNull: true,
        },
        dateofbirth: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        genderid: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        standard: {
          type: DataTypes.STRING(250),
          allowNull: true,
        },
        schooltype: {
          type: DataTypes.STRING(250),
          allowNull: true,
        },
        schoolname: {
          type: DataTypes.STRING(250),
          allowNull: true,
        },
        city: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        country: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        state: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        dateofjoin: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        curriculumid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: "curriculums",
            key: "curriculumid",
          },
        },
        curriculumids: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        gradeid: {
          type: DataTypes.STRING(36),
          allowNull: true,
          references: {
            model: "grades",
            key: "gradeid",
          },
        },
        startinglevelid: {
          type: DataTypes.STRING(36),
          allowNull: true,
          references: {
            model: "levels",
            key: "levelid",
          },
        },
        studentcurrentlevelid: {
          type: DataTypes.STRING(36),
          allowNull: true,
          references: {
            model: "levels",
            key: "levelid",
          },
        },
        studentcurrentlessonid: {
          type: DataTypes.STRING(36),
          allowNull: true,
          references: {
            model: "lessons",
            key: "lessonid",
          },
        },
        isactive: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 0,
        },
        // active: {
        //   type: DataTypes.BOOLEAN,
        //   allowNull: true
        // },
        schooluserid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: "schoolusers",
            key: "schooluserid",
          },
        },
        profileimage: {
          type: DataTypes.STRING(250),
          allowNull: true,
        },
        type: {
          type: DataTypes.STRING(10),
          allowNull: true,
        },
        is_teacher_acc: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: 0
        },
      },
      {
        sequelize,
        tableName: "students",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
          {
            name: "curriculumid",
            using: "BTREE",
            fields: [{ name: "curriculumid" }],
          },
          {
            name: "gradeid",
            using: "BTREE",
            fields: [{ name: "gradeid" }],
          },
          {
            name: "startinglevelid",
            using: "BTREE",
            fields: [{ name: "startinglevelid" }],
          },
          {
            name: "studentcurrentlevelid",
            using: "BTREE",
            fields: [{ name: "studentcurrentlevelid" }],
          },
          {
            name: "studentcurrentlessonid",
            using: "BTREE",
            fields: [{ name: "studentcurrentlessonid" }],
          },
          {
            name: "schooluserid",
            using: "BTREE",
            fields: [{ name: "schooluserid" }],
          },
        ],
      }
    );
    return students;
  }
}
