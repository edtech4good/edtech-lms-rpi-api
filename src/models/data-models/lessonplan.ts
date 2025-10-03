/* eslint-disable camelcase */
import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import { documents, documentsId } from './documents';
import type { lessons, lessonsId } from './lessons';
import { FileMeta } from '../filemeta.model';

export interface lessonplansAttributes {
  lessonplanid: string;
  lessonplanname: string;
  lessonplandescription: string;
  lessonplanstatus: boolean;
  lessonid: string;
  lessonplanorder: number;
  documentid: string;
  points?: number;
  lessonlearningfileobject?: FileMeta;
}

export type lessonplansPk = "lessonplanid";
export type lessonplansId = lessonplans[lessonplansPk];
export type lessonplansOptionalAttributes = "lessonplanid" | "lessonplanstatus";
export type lessonplansCreationAttributes = Optional<lessonplansAttributes, lessonplansOptionalAttributes>;

export class lessonplans extends Model<lessonplansAttributes, lessonplansCreationAttributes> implements lessonplansAttributes {
  lessonplanid!: string;
  lessonplanname!: string;
  lessonplandescription!: string;
  lessonplanstatus!: boolean;
  lessonid!: string;
  lessonplanorder!: number;
  documentid!: string;
  points!: number;

  // lessonplans belongsTo lessons via lessonid
  lesson!: lessons;
  document!:documents;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;
  setLesson!: Sequelize.BelongsToSetAssociationMixin<lessons, lessonsId>;
  createLesson!: Sequelize.BelongsToCreateAssociationMixin<lessons>;

  getDocument!: Sequelize.BelongsToGetAssociationMixin<documents>;
  setDocument!: Sequelize.BelongsToSetAssociationMixin<documents, documentsId>;
  createDocument!: Sequelize.BelongsToCreateAssociationMixin<documents>;

  static initModel(sequelize: Sequelize.Sequelize): typeof lessonplans {
    lessonplans.init({
    lessonplanid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    lessonplanname: {
      type: DataTypes.STRING(250),
      allowNull: false
    },
    lessonplandescription: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    lessonplanstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    lessonid: {
      type: DataTypes.STRING(36),
      allowNull: false,
    },
    documentid: {
      type: DataTypes.STRING(36),
      allowNull: false,
    },
    lessonplanorder: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
  }, {
    sequelize,
    tableName: 'lessonplans',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "lessonplanid" },
        ]
      },
      {
        name: "lessonid",
        using: "BTREE",
        fields: [
          { name: "lessonid" },
        ]
      },
    ]
  });
  return lessonplans;
  }
}
