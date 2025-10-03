/* eslint-disable camelcase */
import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface standardsAttributes {
  standardid: string;
  standardname: string;
  schoolid: string;
  schoolname: string;
  isdeleted: Boolean;
  created_at?: Date;
}

export type standardsPk = "standardid";
export type standardsId = standards[standardsPk];
export type standardsOptionalAttributes = "standardid" | "isdeleted";
export type standardsCreationAttributes = Optional<standardsAttributes, standardsOptionalAttributes>;

export class standards extends Model<standardsAttributes, standardsCreationAttributes> implements standardsAttributes {
  standardid!: string;
  standardname!: string;
  schoolid!: string;
  schoolname!: string;
  isdeleted!: Boolean;
  created_at!: Date;

  // standards hasMany standardmap via standardid

  countQuestiontagmaps!: Sequelize.HasManyCountAssociationsMixin;

  static initModel(sequelize: Sequelize.Sequelize): typeof standards {
    standards.init({
      standardid: {
        type: DataTypes.STRING(36),
        allowNull: false,
        primaryKey: true
      },
      standardname: {
        type: DataTypes.STRING(45),
        allowNull: false
      },
      schoolname: {
        type: DataTypes.STRING(255),
        allowNull: true
      },
      schoolid: {
        type: DataTypes.STRING(36),
        allowNull: true
      },
      isdeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: 0
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true
      },
    }, {
      sequelize,
      tableName: 'standards',
      timestamps: false,
      indexes: [
        {
          name: "PRIMARY",
          unique: true,
          using: "BTREE",
          fields: [
            { name: "standardid" },
          ]
        },
      ]
    });
    return standards;
  }
}
