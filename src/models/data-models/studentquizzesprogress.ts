import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { lessonquizzes } from "./lessonquizzes";
import { students } from "./students";

export interface studentquizzesprogressAttributes {
  studentquizprogressid: string;
  studentid: string;
  userid?: string;
  lessonquizid: string;
  progress?: number;
  points?: number;
}

export type studentquizzesprogressPk = "studentquizprogressid";
export type studentquizzesprogressId =
  studentquizzesprogress[studentquizzesprogressPk];
export type studentquizzesprogressOptionalAttributes =
  | "studentquizprogressid"
  | "progress"
  | "points";
export type studentquizzesprogressCreationAttributes = Optional<
  studentquizzesprogressAttributes,
  studentquizzesprogressOptionalAttributes
>;

export class studentquizzesprogress
  extends Model<
    studentquizzesprogressAttributes,
    studentquizzesprogressCreationAttributes
  >
  implements studentquizzesprogressAttributes
{
  studentquizprogressid!: string;
  lessonquizid!: string;
  progress!: number;
  points!: number;
  studentid!: string;
  userid!: string;

  student!: students;
  getStudent!: Sequelize.BelongsToGetAssociationMixin<students>;

  lessonquiz!: lessonquizzes;
  getLessonquiz!: Sequelize.BelongsToGetAssociationMixin<lessonquizzes>;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentquizzesprogress {
    studentquizzesprogress.init(
      {
        studentquizprogressid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: "students",
            key: "studentid",
          },
        },
        userid: {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
        lessonquizid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: "lessonquizzes",
            key: "lessonquizid",
          },
        },
        progress: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
        points: {
          type: DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 0,
        },
      },
      {
        sequelize,
        tableName: "studentquizzesprogress",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentquizprogressid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
          {
            name: "lessonquizid",
            using: "BTREE",
            fields: [{ name: "lessonquizid" }],
          },
        ],
      }
    );
    return studentquizzesprogress;
  }
}
