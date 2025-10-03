import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface documentsAttributes {
  documentid: string;
  documenttypeid: number;
  documentname: string;
  documents3meta?: object;
  isdeleted: boolean;
  documenttags?: object;
  lastupdated: Date;
}

export type documentsPk = "documentid";
export type documentsId = documents[documentsPk];
export type documentsOptionalAttributes = "documentid" | "documents3meta" | "isdeleted" | "documenttags" | "lastupdated";
export type documentsCreationAttributes = Optional<documentsAttributes, documentsOptionalAttributes>;

export class documents extends Model<documentsAttributes, documentsCreationAttributes> implements documentsAttributes {
  documentid!: string;
  documenttypeid!: number;
  documentname!: string;
  documents3meta?: object;
  isdeleted!: boolean;
  documenttags?: object;
  lastupdated!: Date;


  static initModel(sequelize: Sequelize.Sequelize): typeof documents {
    documents.init({
      documentid: {
        type: DataTypes.STRING(36),
        allowNull: false,
        primaryKey: true
      },
      documenttypeid: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      documentname: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      documents3meta: {
        type: DataTypes.JSON,
        allowNull: true
      },
      isdeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: 0
      },
      documenttags: {
        type: DataTypes.JSON,
        allowNull: true
      },
      lastupdated: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
      }
    }, {
      sequelize,
      tableName: 'documents',
      timestamps: false,
      indexes: [
        {
          name: "PRIMARY",
          unique: true,
          using: "BTREE",
          fields: [
            { name: "documentid" },
          ]
        },
      ]
    });
    return documents;
  }
}
