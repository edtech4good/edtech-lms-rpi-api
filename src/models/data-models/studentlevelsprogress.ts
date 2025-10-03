import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { lessons } from "./lessons";
import { students } from "./students";

export interface studentlevelsprogressAttributes {
  studentlevelprogressid: string;
  studentid: string;
  levelid: string;
  gradeid: string;
  curid: string;
  progress?: number;
  points?: number;
  quizpoints?: number;
  scores?: number;
  lastupdated?: Date;
  completed?: boolean;
  added_default_score?: boolean;
}

export type studentlevelsprogressPk = "studentlevelprogressid";
export type studentlevelsprogressId = studentlevelsprogress[studentlevelsprogressPk];
export type studentlevelsprogressOptionalAttributes =
  | "studentlevelprogressid"
  | "progress"
  | "points"
export type studentlevelsprogressCreationAttributes = Optional<
  studentlevelsprogressAttributes,
  studentlevelsprogressOptionalAttributes
>;

export class studentlevelsprogress
  extends Model<studentlevelsprogressAttributes, studentlevelsprogressCreationAttributes>
  implements studentlevelsprogressAttributes
{
  studentlevelprogressid!: string;
  levelid!: string;
  gradeid!: string;
  curid!: string;
  progress!: number;
  points!: number;
  quizpoints!: number;
  scores!: number;
  studentid!: string;
  lastupdated!: Date;
  completed!: boolean;
  added_default_score!: boolean;

  student!: students;
  getStudent!: Sequelize.BelongsToGetAssociationMixin<students>;

  lesson!: lessons;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentlevelsprogress {
    studentlevelsprogress.init(
      {
        studentlevelprogressid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        levelid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        gradeid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        curid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        progress: {
          type: DataTypes.DOUBLE,
          allowNull: true,
          defaultValue: 0,
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
        lastupdated: {
          type: DataTypes.DATE,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
          allowNull: true
        },
        completed: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: 0
        },
        added_default_score: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: 0
        },
      },
      {
        sequelize,
        tableName: "studentlevelsprogress",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentlevelprogressid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [
              { name: "studentid" },
            ]
          },
          {
            name: "levelid",
            using: "BTREE",
            fields: [
              { name: "levelid" },
            ]
          },
          {
            name: "gradeid",
            using: "BTREE",
            fields: [
              { name: "gradeid" },
            ]
          },
          {
            name: "curid",
            using: "BTREE",
            fields: [
              { name: "curid" },
            ]
          },
        ],
      }
    );
    return studentlevelsprogress;
  }
}
