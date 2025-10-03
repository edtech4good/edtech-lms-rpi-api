import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { students } from "./students";

export interface studentlearningprogressAttributes {
  studentlearningprogressid: string;
  studentid: string;
  userid?: string;
  lessonlearningid: string;
  progress_percentage?: number;
  progress?: number;
  content_length?: number;
  viewed?: number;
  points?: number;
  lastupdated?: Date;
}

export type studentlearningprogressPk = "studentlearningprogressid";
export type studentlearningprogressId = studentlearningprogress[studentlearningprogressPk];
export type studentlearningprogressOptionalAttributes =
  | "studentlearningprogressid"
  | "progress"
  | "viewed";
export type studentlearningprogressCreationAttributes = Optional<
  studentlearningprogressAttributes,
  studentlearningprogressOptionalAttributes
>;

export class studentlearningprogress
  extends Model<studentlearningprogressAttributes, studentlearningprogressCreationAttributes>
  implements studentlearningprogressAttributes
{
  studentlearningprogressid!: string;
  lessonlearningid!: string;
  progress_percentage!: number;
  progress!: number;
  content_length!: number;
  viewed!: number;
  points!: number;
  studentid!: string;
  userid!: string;
  lastupdated!: Date;

  student!: students;
  getStudent!: Sequelize.BelongsToGetAssociationMixin<students>;

  // lessonlearning!: lessonlearnings;
  // getLessonlearning!: Sequelize.BelongsToGetAssociationMixin<lessonlearnings>;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentlearningprogress {
    studentlearningprogress.init(
      {
        studentlearningprogressid: {
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
        lessonlearningid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          // references: {
          //   model: "lessonlearnings",
          //   key: "lessonlearningid",
          // },
          // onDelete: 'no action'
        },
        points: {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        progress: {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        progress_percentage: {
          type: DataTypes.DOUBLE,
          allowNull: true,
          defaultValue: null,
        },
        content_length: {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: null,
        },
        viewed: {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: true,
          defaultValue: 0,
        },
        lastupdated: {
          type: DataTypes.DATE,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
          allowNull: true
        },
      },
      {
        sequelize,
        // charset: "utf8mb4",
        // collate: "utf8mb4_0900_ai_ci",
        tableName: "studentlearningsprogress",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentlearningprogressid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
          {
            name: "lessonlearningid",
            using: "BTREE",
            fields: [{ name: "lessonlearningid" }],
          },
        ],
      }
    );
    return studentlearningprogress;
  }
}
