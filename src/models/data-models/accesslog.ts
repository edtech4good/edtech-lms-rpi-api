import { float } from "aws-sdk/clients/lightsail";
import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface accesslogAttributes {
  schooluserid: string;
  logintime: Date;
  logouttime: Date;
  timespent: float;
  status: number;
  ipaddress: string;
  accesslogid: string;
}

export type accesslogPk = "accesslogid";
export type accesslogId = accesslog[accesslogPk];
export type accesslogOptionalAttributes = "logintime" | "accesslogid";
export type accesslogCreationAttributes = Optional<
  accesslogAttributes,
  accesslogOptionalAttributes
>;

export class accesslog
  extends Model<accesslogAttributes, accesslogCreationAttributes>
  implements accesslogAttributes
{
  schooluserid!: string;
  logintime!: Date;
  logouttime!: Date;
  timespent!: float;
  status!: number;
  ipaddress!: string;
  accesslogid!: string;

  static initModel(sequelize: Sequelize.Sequelize): typeof accesslog {
    accesslog.init(
      {
        schooluserid: {
          type: DataTypes.STRING(45),
          allowNull: false,
          references: {
            model: 'schoolusers',
            key: 'schooluserid'
          }
        },
        logintime: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        logouttime: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        timespent: {
          type: DataTypes.DECIMAL,
          allowNull: true,
          defaultValue: 0,
        },
        ipaddress: {
          type: DataTypes.STRING(45),
          allowNull: false,
        },
        status: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        accesslogid: {
          type: DataTypes.STRING(45),
          allowNull: false,
          primaryKey: true,
        },
      },
      {
        sequelize,
        tableName: "accesslog",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "accesslogid" }],
          },
          {
            name: "schooluserid",
            using: "BTREE",
            fields: [
              { name: "schooluserid" },
            ]
          },
        ],
      }
    );
    return accesslog;
  }
}
