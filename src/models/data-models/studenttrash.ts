import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface studenttrashAttributes {
  studenttrashid: string;
  studentid: string;
  gradeid: string;
  trashtype: number;
  totalprogress: number;
  status: number;
  created_at?: Date | string;
}

export type studenttrashPk = "studenttrashid";
export type studenttrashId = studenttrash[studenttrashPk];
export type studenttrashOptionalAttributes =
  | "studenttrashid"
  | "gradeid"
  | "trashtype";
export type studenttrashCreationAttributes = Optional<
  studenttrashAttributes,
  studenttrashOptionalAttributes
>;

export class studenttrash
  extends Model<studenttrashAttributes, studenttrashCreationAttributes>
  implements studenttrashAttributes
{
  studenttrashid!: string;
  studentid!: string;
  gradeid!: string;
  trashtype!: number;
  totalprogress!: number;
  status!: number;
  created_at!: Date | string;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studenttrash {
    studenttrash.init(
      {
        studenttrashid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
        },
        gradeid: {
            type: DataTypes.STRING(36),
            allowNull: false,
        },
        trashtype: {
            type: DataTypes.TINYINT,
            allowNull: false,
        },
        totalprogress: {
          type: DataTypes.DOUBLE,
          allowNull: false,
          defaultValue: 0,
        },
        status: {
          type: DataTypes.TINYINT,
          allowNull: false,
          defaultValue: 1,
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
        tableName: "studenttrash",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studenttrashid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
        ],
      }
    );
    return studenttrash;
  }
}
