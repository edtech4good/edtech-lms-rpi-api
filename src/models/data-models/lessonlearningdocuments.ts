import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

/**
 * The documents a learning item uses besides its primary `documentid`: one row per
 * document, with the role it plays and its order within the item. Phase 0 of
 * learning items ships the table empty (design note, section 5). It has no owner
 * column of its own: a row belongs to the organisation of the learning it hangs from.
 */
export interface lessonlearningdocumentsAttributes {
  lessonlearningdocumentid: string;
  lessonlearningid: string;
  documentid: string;
  lessonlearningdocumentrole: string;
  lessonlearningdocumentorder: number;
}

export type lessonlearningdocumentsPk = "lessonlearningdocumentid";
export type lessonlearningdocumentsId = lessonlearningdocuments[lessonlearningdocumentsPk];
export type lessonlearningdocumentsOptionalAttributes = "lessonlearningdocumentorder";
export type lessonlearningdocumentsCreationAttributes = Optional<lessonlearningdocumentsAttributes, lessonlearningdocumentsOptionalAttributes>;

export class lessonlearningdocuments
  extends Model<lessonlearningdocumentsAttributes, lessonlearningdocumentsCreationAttributes>
  implements lessonlearningdocumentsAttributes
{
  lessonlearningdocumentid!: string;
  lessonlearningid!: string;
  documentid!: string;
  lessonlearningdocumentrole!: string;
  lessonlearningdocumentorder!: number;

  static initModel(sequelize: Sequelize.Sequelize): typeof lessonlearningdocuments {
    lessonlearningdocuments.init(
      {
        lessonlearningdocumentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        lessonlearningid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: 'lessonlearnings',
            key: 'lessonlearningid',
          },
          onDelete: 'CASCADE',
        },
        documentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          references: {
            model: 'documents',
            key: 'documentid',
          },
          onDelete: 'RESTRICT',
        },
        lessonlearningdocumentrole: {
          type: DataTypes.STRING(16),
          allowNull: false,
        },
        lessonlearningdocumentorder: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
      },
      {
        sequelize,
        tableName: 'lessonlearningdocuments',
        timestamps: false,
        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'lessonlearningdocumentid' }],
          },
          {
            name: 'lessonlearningdocuments_item_document',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'lessonlearningid' }, { name: 'documentid' }],
          },
          {
            name: 'lessonlearningdocuments_documentid',
            using: 'BTREE',
            fields: [{ name: 'documentid' }],
          },
        ],
      },
    );
    return lessonlearningdocuments;
  }
}
