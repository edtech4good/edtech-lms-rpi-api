/* eslint-disable camelcase */
import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import type { grades, gradesId } from "./grades";
import type { students, studentsId } from "./students";
import { RECOGNITION_FIELDS } from "../../constants/recognition";

export interface curriculumsAttributes {
  curriculumid: string;
  curriculumname: string;
  curriculumstatus?: boolean;
  curriculumdescription?: string;
  subjectid?: string;
  isdeleted?: boolean;
  organisationid: string;
  levelrecognition?: string;
  graderecognition?: string;
  curriculumrecognition?: string;
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
  organisationid!: string;
  levelrecognition?: string;
  graderecognition?: string;
  curriculumrecognition?: string;

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
        // See ownership-scope.ts; no `references` (the migration owns the key).
        organisationid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        // The per-tier recognition setting (see constants/recognition.ts). allowNull: false with NO model
        // defaultValue, on purpose: the database holds the defaults, so a bulkCreate of rows without these keys omits
        // them from the INSERT and the column defaults apply. A future curriculums.create() or save() of a NEW
        // instance must therefore set all three explicitly.
        levelrecognition: { type: DataTypes.STRING(16), allowNull: false },
        graderecognition: { type: DataTypes.STRING(16), allowNull: false },
        curriculumrecognition: { type: DataTypes.STRING(16), allowNull: false },
      },
      {
        sequelize,
        tableName: "curriculums",
        timestamps: false,
        // A new column stays out of every query unless it is asked for (outward payloads keep their shape).
        defaultScope: { attributes: { exclude: ['organisationid', ...RECOGNITION_FIELDS] } },
        scopes: { withOwnership: {}, withRecognition: {} },
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
