import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { FindOptions } from 'sequelize';
import { DEFAULT_DOCUMENT_LICENCE } from '../../constants/media-library';

export interface documentsAttributes {
  documentid: string;
  documenttypeid: number;
  /** The STORAGE KEY of the file (a name the media folder and the bucket know it by), whatever its label: never user text to show. */
  documentname: string;
  documents3meta?: object;
  isdeleted: boolean;
  documenttags?: object;
  lastupdated: Date;
  organisationid: string;
  /** What to show for the file; null means show `documentname`. */
  documenttitle?: string | null;
  /** One id of DOCUMENT_LICENCES (src/constants/media-library.ts); 'unspecified' until recorded. */
  documentlicence: string;
  /** `{ v: 1, author?, sourceurl?, adaptedfrom? }` or null. Carried by sync, shown to no learner in phase 0. */
  documentattribution?: object | null;
}

export type documentsPk = "documentid";
export type documentsId = documents[documentsPk];
export type documentsOptionalAttributes = "documentid" | "documents3meta" | "isdeleted" | "documenttags" | "lastupdated" | "documenttitle" | "documentlicence" | "documentattribution";
export type documentsCreationAttributes = Optional<documentsAttributes, documentsOptionalAttributes>;

/**
 * As ownership-scope.ts does for the owner column, the media-library columns (title, licence, attribution) are
 * left out of every query by default: no route or export returns them in phase 0, and a model returns every
 * column it selects. `withOwnership` and `withMediaMetadata` select every column.
 */
const documentsDefaultScope: FindOptions = { attributes: { exclude: ['organisationid', 'documenttitle', 'documentlicence', 'documentattribution'] } };

export class documents extends Model<documentsAttributes, documentsCreationAttributes> implements documentsAttributes {
  documentid!: string;
  documenttypeid!: number;
  documentname!: string;
  documents3meta?: object;
  isdeleted!: boolean;
  documenttags?: object;
  lastupdated!: Date;
  organisationid!: string;
  documenttitle?: string | null;
  documentlicence!: string;
  documentattribution?: object | null;

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
      },
      // See ownership-scope.ts; no `references` (the migration owns the key).
      organisationid: {
        type: DataTypes.STRING(36),
        allowNull: false,
      },
      documenttitle: {
        type: DataTypes.STRING(255),
        allowNull: true,
        defaultValue: null
      },
      documentlicence: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: DEFAULT_DOCUMENT_LICENCE
      },
      documentattribution: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: null
      }
    }, {
      sequelize,
      tableName: 'documents',
      timestamps: false,
      defaultScope: documentsDefaultScope,
      // Every column; the owner and the media-library columns are read only through a scope that asks for them.
      scopes: { withOwnership: {}, withMediaMetadata: {} },
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
