/* eslint-disable camelcase */
import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface studentappusagesAttributes {
  studentappusageid: string;
  schooluserid: string;
  time_spent: number;
  last_updated?: Date | string;
  created_at?: Date | string;
}

export type studentappusagesPk = "studentappusageid";
export type studentappusagesId = studentappusages[studentappusagesPk];
export type studentappusagesCreationAttributes = Optional<
  studentappusagesAttributes,
  studentappusagesPk
>;

export class studentappusages
  extends Model<studentappusagesAttributes, studentappusagesCreationAttributes>
  implements studentappusagesAttributes
{
  studentappusageid!: string;
  schooluserid!: string;
  time_spent!: number;
  last_updated!: Date | string;
  created_at!: Date | string;

  static initModel(sequelize: Sequelize.Sequelize): typeof studentappusages {
    studentappusages.init(
      {
        studentappusageid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        schooluserid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        time_spent: {
          type: DataTypes.DOUBLE,
          allowNull: false,
          defaultValue: 0,
        },
        last_updated: {
          type: DataTypes.DATE,
          defaultValue: Sequelize.Sequelize.fn("NOW"),
          allowNull: true
        },
        created_at: {
          type: DataTypes.DATE,
          defaultValue: Sequelize.Sequelize.fn("NOW"),
          allowNull: true
        },
      },
      {
        sequelize,
        tableName: "studentappusages",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentappusageid" }],
          },
          {
            name: "schooluserid",
            using: "BTREE",
            fields: [{ name: "schooluserid" }],
          },
        ],
      }
    );
    return studentappusages;
  }
}
