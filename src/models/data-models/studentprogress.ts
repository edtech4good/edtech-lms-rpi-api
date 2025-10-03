import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import { lessonpractices } from './lessonpractices';
import { lessonquizzes } from './lessonquizzes';
import type { studentprogressquestions, studentprogressquestionsId } from './studentprogressquestions';

export interface studentprogressAttributes {
  studentid: string;
  ispass: number;
  studentprogressreferenceid: string;
  starttime: Date;
  endtime?: Date;
  studentprogressid: string;
  progresstype: number;
  resultpercentage: number;
  actualanswers?: object;
  marks: number;
  points: number;
  fullpoints: number;
  scores: number;

  totalquestions?: number;
}

export type studentprogressPk = "studentprogressid";
export type studentprogressId = studentprogress[studentprogressPk];
export type studentprogressOptionalAttributes = "starttime" | "endtime" | "studentprogressid";
export type studentprogressCreationAttributes = Optional<studentprogressAttributes, studentprogressOptionalAttributes>;

export class studentprogress extends Model<studentprogressAttributes, studentprogressCreationAttributes> implements studentprogressAttributes {
  studentid!: string;
  ispass!: number;
  studentprogressreferenceid!: string;
  starttime!: Date;
  endtime?: Date;
  studentprogressid!: string;
  progresstype!: number;
  resultpercentage!: number;
  marks!: number;
  points!: number;
  fullpoints!: number;
  scores!: number;

  totalquestions?: number;

  // studentprogress hasMany studentprogressquestions via studentprogressid
  studentprogressquestions!: studentprogressquestions[];
  lessonquiz!: lessonquizzes;
  lessonpractice!: lessonpractices;
  getStudentprogressquestions!: Sequelize.HasManyGetAssociationsMixin<studentprogressquestions>;
  setStudentprogressquestions!: Sequelize.HasManySetAssociationsMixin<studentprogressquestions, studentprogressquestionsId>;
  addStudentprogressquestion!: Sequelize.HasManyAddAssociationMixin<studentprogressquestions, studentprogressquestionsId>;
  addStudentprogressquestions!: Sequelize.HasManyAddAssociationsMixin<studentprogressquestions, studentprogressquestionsId>;
  createStudentprogressquestion!: Sequelize.HasManyCreateAssociationMixin<studentprogressquestions>;
  removeStudentprogressquestion!: Sequelize.HasManyRemoveAssociationMixin<studentprogressquestions, studentprogressquestionsId>;
  removeStudentprogressquestions!: Sequelize.HasManyRemoveAssociationsMixin<studentprogressquestions, studentprogressquestionsId>;
  hasStudentprogressquestion!: Sequelize.HasManyHasAssociationMixin<studentprogressquestions, studentprogressquestionsId>;
  hasStudentprogressquestions!: Sequelize.HasManyHasAssociationsMixin<studentprogressquestions, studentprogressquestionsId>;
  countStudentprogressquestions!: Sequelize.HasManyCountAssociationsMixin;

  static initModel(sequelize: Sequelize.Sequelize): typeof studentprogress {
    studentprogress.init({
    studentid: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    ispass: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    studentprogressreferenceid: {
      type: DataTypes.STRING(36),
      allowNull: false
    },
    starttime: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    endtime: {
      type: DataTypes.DATE,
      allowNull: true
    },
    studentprogressid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    progresstype: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    resultpercentage: {
      type: DataTypes.DOUBLE,
      allowNull: true,
      defaultValue: null
    },
    marks: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    scores: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
    fullpoints: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null,
    },
  }, {
    sequelize,
    tableName: 'studentprogress',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "studentprogressid" },
        ]
      },
    ]
  });
  return studentprogress;
  }
}
