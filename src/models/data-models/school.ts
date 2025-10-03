/* eslint-disable camelcase */
import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import { countries, countriesId } from './countries';

export interface schoolsAttributes {
  schoolid: string;
  schoolname: string;
  countryid: string;
  curriculums: Array<string>;
  expectedcontribution?: number;
  expectedusage?: number;
  isdeleted?: Boolean;
}

export type schoolsPk = "schoolid";
export type schoolsId = schools[schoolsPk];
export type schoolsOptionalAttributes = "schoolid" | "isdeleted";
export type schoolsCreationAttributes = Optional<schoolsAttributes, schoolsOptionalAttributes>;

export class schools extends Model<schoolsAttributes, schoolsCreationAttributes> implements schoolsAttributes {
  schoolid!: string;
  schoolname!: string;
  countryid!: string;
  curriculums!: Array<string>;
  expectedcontribution!: number;
  expectedusage!: number;
  isdeleted!: Boolean;

  // grades belongsTo curriculums via curriculumid
  countries!: countries;
  getCountry!: Sequelize.BelongsToGetAssociationMixin<countries>;
  setCountry!: Sequelize.BelongsToSetAssociationMixin<countries, countriesId>;
  createCountry!: Sequelize.BelongsToCreateAssociationMixin<countries>;

  static initModel(sequelize: Sequelize.Sequelize): typeof schools {
    schools.init({
      schoolid: {
        type: DataTypes.STRING(36),
        allowNull: false,
        primaryKey: true
      },
      schoolname: {
        type: DataTypes.STRING(45),
        allowNull: false,
        unique: true
      },
      expectedcontribution: {
        type: DataTypes.DOUBLE.UNSIGNED,
        allowNull: true,
        defaultValue: null
      },
      expectedusage: {
        type: DataTypes.DOUBLE.UNSIGNED,
        allowNull: true,
        defaultValue: null
      },
      countryid: {
        type: DataTypes.STRING(36),
        allowNull: true,
        references: {
          model: 'countries',
          key: 'countryid'
        }
      },
      curriculums: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      isdeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: 0
      },
    }, {
      sequelize,
      tableName: 'schools',
      timestamps: false,
      indexes: [
        {
          name: "PRIMARY",
          unique: true,
          using: "BTREE",
          fields: [
            { name: "schoolid" },
          ]
        },
        {
          name: "countryid",
          using: "BTREE",
          fields: [
            { name: "countryid" },
          ]
        },
      ]
    });
    return schools;
  }
}
