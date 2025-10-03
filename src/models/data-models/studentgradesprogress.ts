import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { lessons } from "./lessons";
import { students } from "./students";

export interface studentgradesprogressAttributes {
  studentgradeprogressid: string;
  curriculumid: string;
  studentid: string;
  gradeid: string;
  progress?: number;
  points?: number;
  scores?: number;
  lastupdated?: Date;
  completed?: boolean;
}

export type studentgradesprogressPk = "studentgradeprogressid";
export type studentgradesprogressId = studentgradesprogress[studentgradesprogressPk];
export type studentgradesprogressOptionalAttributes =
  | "studentgradeprogressid"
  | "progress"
  | "points"
export type studentgradesprogressCreationAttributes = Optional<
  studentgradesprogressAttributes,
  studentgradesprogressOptionalAttributes
>;

export class studentgradesprogress
  extends Model<studentgradesprogressAttributes, studentgradesprogressCreationAttributes>
  implements studentgradesprogressAttributes
{
  studentgradeprogressid!: string;
  curriculumid!: string;
  gradeid!: string;
  progress!: number;
  points!: number;
  scores!: number;
  studentid!: string;
  lastupdated!: Date;
  completed!: boolean;

  student!: students;
  getStudent!: Sequelize.BelongsToGetAssociationMixin<students>;

  lesson!: lessons;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentgradesprogress {
    studentgradesprogress.init(
      {
        studentgradeprogressid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        curriculumid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        gradeid: {
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
          defaultValue: 0,
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
      },
      {
        sequelize,
        tableName: "studentgradesprogress",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentgradeprogressid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [
              { name: "studentid" },
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
            name: "curriculumid",
            using: "BTREE",
            fields: [
              { name: "curriculumid" },
            ]
          },
        ],
      }
    );
    return studentgradesprogress;
  }
}
