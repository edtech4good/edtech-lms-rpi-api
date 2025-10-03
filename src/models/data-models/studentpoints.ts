import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface studentpointsAttributes {
  studentpointid: string;
  studentid: string;
  levelid: string;
  lessonid: string;
  gradepoints: number;
  totalgradepoints: number;
  levelpoints: number;
  totallevelpoints: number;
  lessonpoints: number;
  levelquizscores: number;
  learningpoints: number;
  practicepoints: number;
  quizpoints: number;
  totallearningpoints: number;
  totalpracticepoints: number;
  totalquizpoints: number;
  scores?: number;
  created_at?: Date | string;
}

export type studentpointsPk = "studentpointid";
export type studentpointsId = studentpoints[studentpointsPk];
export type studentpointsOptionalAttributes =
  | "studentpointid"
  | "studentid"
  | "levelid"
  | "lessonid"
  | "gradepoints"
  | "levelpoints"
  | "lessonpoints";
export type studentpointsCreationAttributes = Optional<
  studentpointsAttributes,
  studentpointsOptionalAttributes
>;

export class studentpoints
  extends Model<studentpointsAttributes, studentpointsCreationAttributes>
  implements studentpointsAttributes
{
  studentpointid!: string;
  studentid!: string;
  levelid!: string;
  lessonid!: string;
  gradepoints!: number;
  totalgradepoints!: number;
  levelpoints!: number;
  totallevelpoints!: number;
  lessonpoints!: number;
  levelquizscores!: number;
  learningpoints!: number;
  practicepoints!: number;
  quizpoints!: number;
  totallearningpoints!: number;
  totalpracticepoints!: number;
  totalquizpoints!: number;
  scores!: number;
  created_at!: Date | string;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentpoints {
    studentpoints.init(
      {
        studentpointid: {
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
        lessonid: {
            type: DataTypes.STRING(36),
            allowNull: false,
        },
        gradepoints: {
            type: DataTypes.DOUBLE,
            allowNull: false,
        },
        totalgradepoints: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        levelpoints: {
            type: DataTypes.DOUBLE,
            allowNull: false,
        },
        totallevelpoints: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        levelquizscores: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        lessonpoints: {
            type: DataTypes.DOUBLE,
            allowNull: false,
        },
        learningpoints: {
            type: DataTypes.DOUBLE,
            allowNull: false,
        },
        practicepoints: {
            type: DataTypes.DOUBLE,
            allowNull: false,
        },
        quizpoints: {
            type: DataTypes.DOUBLE,
            allowNull: false,
        },
        totallearningpoints: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        totalpracticepoints: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        totalquizpoints: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        scores: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: Sequelize.Sequelize.fn("NOW"),
            allowNull: true
        },
      },
      {
        sequelize,
        // charset: "utf8mb4",
        // collate: "utf8mb4_0900_ai_ci",
        tableName: "studentpoints",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentpointid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
          {
            name: "lessonid",
            using: "BTREE",
            fields: [{ name: "lessonid" }],
          },
        ],
      }
    );
    return studentpoints;
  }
}
