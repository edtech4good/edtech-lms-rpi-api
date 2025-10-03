import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { lessons } from "./lessons";
import { students } from "./students";

export interface studentpracticesprogressAttributes {
  studentpracticeprogressid: string;
  studentid: string;
  userid?: string;
  lessonpracticeid: string;
  progress?: number;
  points?: number;
}

export type studentpracticesprogressPk = "studentpracticeprogressid";
export type studentpracticesprogressId = studentpracticesprogress[studentpracticesprogressPk];
export type studentpracticesprogressOptionalAttributes =
  | "studentpracticeprogressid"
  | "progress"
  | "points"
export type studentpracticesprogressCreationAttributes = Optional<
  studentpracticesprogressAttributes,
  studentpracticesprogressOptionalAttributes
>;

export class studentpracticesprogress
  extends Model<studentpracticesprogressAttributes, studentpracticesprogressCreationAttributes>
  implements studentpracticesprogressAttributes
{
  studentpracticeprogressid!: string;
  lessonpracticeid!: string;
  progress!: number;
  points!: number;
  studentid!: string;
  userid!: string;

  student!: students;
  getStudent!: Sequelize.BelongsToGetAssociationMixin<students>;

  lesson!: lessons;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentpracticesprogress {
    studentpracticesprogress.init(
      {
        studentpracticeprogressid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            primaryKey: true,
          },
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: 'students',
            key: 'studentid'
          }
        },
        userid: {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
        lessonpracticeid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: 'lessonpractices',
            key: 'lessonpracticeid'
          }
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
        tableName: "studentpracticesprogress",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentpracticeprogressid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [
              { name: "studentid" },
            ]
          },
          {
            name: "lessonpracticeid",
            using: "BTREE",
            fields: [
              { name: "lessonpracticeid" },
            ]
          },
        ],
      }
    );
    return studentpracticesprogress;
  }
}
