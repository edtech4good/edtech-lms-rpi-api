import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface rpiuseraccessAttributes {
  userid: string;
  logintime: Date;
  logouttime?: Date;
  timespent: number;
  status: number;
  ipaddress: string;
  rpiuseraccessid: string;
}

export type rpiuseraccessPk = "rpiuseraccessid";
export type rpiuseraccessId = rpiuseraccess[rpiuseraccessPk];
export type rpiuseraccessOptionalAttributes = "logintime" | "rpiuseraccessid";
export type rpiuseraccessCreationAttributes = Optional<rpiuseraccessAttributes, rpiuseraccessOptionalAttributes>;

export class rpiuseraccess extends Model<rpiuseraccessAttributes, rpiuseraccessCreationAttributes> implements rpiuseraccessAttributes {
  userid!: string;
  logintime!: Date;
  logouttime!: Date;
  timespent!: number;
  status!: number;
  ipaddress!: string;
  rpiuseraccessid!: string;


  static initModel(sequelize: Sequelize.Sequelize): typeof rpiuseraccess {
    rpiuseraccess.init({
    userid: {
      type: DataTypes.STRING(45),
      allowNull: false
    },
    logintime: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
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
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    ipaddress: {
      type: DataTypes.STRING(45),
      allowNull: false
    },
    rpiuseraccessid: {
      type: DataTypes.STRING(45),
      allowNull: false,
      primaryKey: true
    }
  }, {
    sequelize,
    tableName: 'rpiuseraccess',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "rpiuseraccessid" },
        ]
      },
    ]
  });
  return rpiuseraccess;
  }
}
