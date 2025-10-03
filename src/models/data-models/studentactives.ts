import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface studentactivesAttributes {
  studentactiveid: string;
  studentid: string;
  referenceid: string;
  referencetype: number;
  created_at?: Date | string;
}

export type studentactivesPk = "studentactiveid";
export type studentactivesId = studentactives[studentactivesPk];
export type studentactivesOptionalAttributes =
  | "studentactiveid"
  | "referenceid"
  | "referencetype";
export type studentactivesCreationAttributes = Optional<
  studentactivesAttributes,
  studentactivesOptionalAttributes
>;

export class studentactives
  extends Model<studentactivesAttributes, studentactivesCreationAttributes>
  implements studentactivesAttributes
{
  studentactiveid!: string;
  studentid!: string;
  referenceid!: string;
  referencetype!: number;
  created_at!: Date | string;

  static initModel(
    sequelize: Sequelize.Sequelize
  ): typeof studentactives {
    studentactives.init(
      {
        studentactiveid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
        },
        referenceid: {
            type: DataTypes.STRING(36),
            allowNull: false,
        },
        referencetype: {
            type: DataTypes.TINYINT,
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
        tableName: "studentactives",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentactiveid" }],
          },
          {
            name: "studentid",
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
        ],
      }
    );
    return studentactives;
  }
}
