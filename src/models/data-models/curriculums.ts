/* eslint-disable camelcase */
import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import type { grades, gradesId } from "./grades";
import type { students, studentsId } from "./students";

export interface curriculumsAttributes {
  curriculumid: string;
  curriculumname: string;
  curriculumstatus?: boolean;
  curriculumdescription?: string;
  subjectid?: string;
  isdeleted?: boolean;
}

export type curriculumsPk = "curriculumid";
export type curriculumsId = curriculums[curriculumsPk];
export type curriculumsCreationAttributes = Optional<
  curriculumsAttributes,
  curriculumsPk
>;

export class curriculums
  extends Model<curriculumsAttributes, curriculumsCreationAttributes>
  implements curriculumsAttributes
{
  curriculumid!: string;
  curriculumname!: string;
  curriculumstatus!: boolean;
  curriculumdescription?: string;
  isdeleted!: boolean;
  subjectid?: string;

  // curriculums hasMany grades via curriculumid
  grades!: grades[];
  getGrades!: Sequelize.HasManyGetAssociationsMixin<grades>;
  setGrades!: Sequelize.HasManySetAssociationsMixin<grades, gradesId>;
  addGrade!: Sequelize.HasManyAddAssociationMixin<grades, gradesId>;
  addGrades!: Sequelize.HasManyAddAssociationsMixin<grades, gradesId>;
  createGrade!: Sequelize.HasManyCreateAssociationMixin<grades>;
  removeGrade!: Sequelize.HasManyRemoveAssociationMixin<grades, gradesId>;
  removeGrades!: Sequelize.HasManyRemoveAssociationsMixin<grades, gradesId>;
  hasGrade!: Sequelize.HasManyHasAssociationMixin<grades, gradesId>;
  hasGrades!: Sequelize.HasManyHasAssociationsMixin<grades, gradesId>;
  countGrades!: Sequelize.HasManyCountAssociationsMixin;
  // curriculums hasMany students via curriculumid
  students!: students[];
  getStudents!: Sequelize.HasManyGetAssociationsMixin<students>;
  setStudents!: Sequelize.HasManySetAssociationsMixin<students, studentsId>;
  addStudent!: Sequelize.HasManyAddAssociationMixin<students, studentsId>;
  addStudents!: Sequelize.HasManyAddAssociationsMixin<students, studentsId>;
  createStudent!: Sequelize.HasManyCreateAssociationMixin<students>;
  removeStudent!: Sequelize.HasManyRemoveAssociationMixin<students, studentsId>;
  removeStudents!: Sequelize.HasManyRemoveAssociationsMixin<
    students,
    studentsId
  >;
  hasStudent!: Sequelize.HasManyHasAssociationMixin<students, studentsId>;
  hasStudents!: Sequelize.HasManyHasAssociationsMixin<students, studentsId>;
  countStudents!: Sequelize.HasManyCountAssociationsMixin;

  static initModel(sequelize: Sequelize.Sequelize): typeof curriculums {
    curriculums.init(
      {
        curriculumid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        curriculumname: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        curriculumstatus: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 1,
        },
        curriculumdescription: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 0,
        },
        subjectid: {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "curriculums",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "curriculumid" }],
          },
        ],
      }
    );
    return curriculums;
  }
}
