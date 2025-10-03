import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { lessons } from "./lessons";
import { students } from "./students";

export interface studentlessonsprogressAttributes {
  studentlessonprogressid: string;
  studentid: string;
  userid?: string;
  lessonid: string;
  levelid: string;
  gradeid: string;
  curid: string;
  progress?: number;
  points?: number;
  scores?: number;
  lastupdated?: Date;
  completed?: boolean;
  added_completed_scores?: boolean;
}

export type studentlessonsprogressPk = "studentlessonprogressid";
export type studentlessonsprogressId = studentlessonsprogress[studentlessonsprogressPk];
export type studentlessonsprogressOptionalAttributes =
  | "studentlessonprogressid"
  | "progress"
  | "points"
export type studentlessonsprogressCreationAttributes = Optional<
  studentlessonsprogressAttributes,
  studentlessonsprogressOptionalAttributes
>;

export class studentlessonsprogress
  extends Model<studentlessonsprogressAttributes, studentlessonsprogressCreationAttributes>
  implements studentlessonsprogressAttributes
{
  studentlessonprogressid!: string;
  lessonid!: string;
  levelid!: string;
  gradeid!: string;
  curid!: string;
  progress!: number;
  points!: number;
  scores!: number;
  studentid!: string;
  userid!: string;
  lastupdated!: Date;
  completed!: boolean;
  added_completed_scores!: boolean;

  student!: students;
  getStudent!: Sequelize.BelongsToGetAssociationMixin<students>;

  lesson!: lessons;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentlessonsprogress {
    studentlessonsprogress.init(
      {
        studentlessonprogressid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        lessonid: {
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
        added_completed_scores: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
          defaultValue: 0
        },
      },
      {
        sequelize,
        tableName: "studentlessonsprogress",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentlessonprogressid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [
              { name: "studentid" },
            ]
          },
          {
            name: "lessonid",
            using: "BTREE",
            fields: [
              { name: "lessonid" },
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
    return studentlessonsprogress;
  }
}
