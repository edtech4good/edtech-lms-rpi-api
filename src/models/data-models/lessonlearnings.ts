import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import { FileMeta } from '../filemeta.model';
import { documents, documentsId } from './documents';
import type { lessons, lessonsId } from './lessons';

export interface lessonlearningsAttributes {
  lessonlearningid: string;
  lessonlearningname: string;
  lessonlearningdescription: string;
  lessonlearningstatus: boolean;
  lessonid: string;
  lessonlearningorder: number;
  /** The item's primary document. Null only for a type that needs none (LI-2 knows only `video`, which does). */
  documentid: string | null;
  points?: number;
  /** What kind of item this is. One of `LEARNING_ITEM_TYPES` (src/constants/learning-items.ts). */
  lessonlearningtype: string;
  /** The type's own JSON body; null for `video`. */
  lessonlearningbody?: object | null;
  lessonlearningfileobject?: FileMeta;
}

export type lessonlearningsPk = "lessonlearningid";
export type lessonlearningsId = lessonlearnings[lessonlearningsPk];
export type lessonlearningsOptionalAttributes = "lessonlearningid" | "lessonlearningstatus" | "lessonlearningtype" | "lessonlearningbody";
export type lessonlearningsCreationAttributes = Optional<lessonlearningsAttributes, lessonlearningsOptionalAttributes>;

export class lessonlearnings extends Model<lessonlearningsAttributes, lessonlearningsCreationAttributes> implements lessonlearningsAttributes {
  lessonlearningid!: string;
  lessonlearningname!: string;
  lessonlearningdescription!: string;
  lessonlearningstatus!: boolean;
  lessonid!: string;
  lessonlearningorder!: number;
  documentid!: string | null;
  points!: number;
  lessonlearningtype!: string;
  lessonlearningbody!: object | null;
  lessonlearningfileobject!: FileMeta;

  // lessonlearnings belongsTo lessons via lessonid
  lesson!: lessons;
  document!:documents;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;
  setLesson!: Sequelize.BelongsToSetAssociationMixin<lessons, lessonsId>;
  createLesson!: Sequelize.BelongsToCreateAssociationMixin<lessons>;

  getDocument!: Sequelize.BelongsToGetAssociationMixin<documents>;
  setDocument!: Sequelize.BelongsToSetAssociationMixin<documents, documentsId>;
  createDocument!: Sequelize.BelongsToCreateAssociationMixin<documents>;

  static initModel(sequelize: Sequelize.Sequelize): typeof lessonlearnings {
    lessonlearnings.init({
    lessonlearningid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    lessonlearningname: {
      type: DataTypes.STRING(250),
      allowNull: false
    },
    lessonlearningdescription: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    lessonlearningstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    lessonid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'lessons',
        key: 'lessonid'
      }
    },
    documentid: {
      type: DataTypes.STRING(36),
      allowNull: true,
      references: {
        model: 'documents',
        key: 'documentid'
      }
    },
    lessonlearningorder: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
    lessonlearningtype: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'video'
    },
    lessonlearningbody: {
      type: DataTypes.JSON,
      allowNull: true
    },
  }, {
    sequelize,
    tableName: 'lessonlearnings',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "lessonlearningid" },
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
  return lessonlearnings;
  }
}
