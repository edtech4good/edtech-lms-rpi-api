import * as Sequelize from 'sequelize';
import { DataTypes, Model } from 'sequelize';

/**
 * A translation of one learner-visible text of a content row (design note: bilingual content). The row's own column
 * keeps the organisation's base-language text; this row carries the same text in another `language`, with the
 * sha-256 of the base text it translated (`sourcehash`: a translation whose base text has since changed is stale
 * and is not served).
 *
 * `(tablename, rowid)` names the content row (polymorphic: no foreign key); `field` names the text; `subkey` names
 * the option, matching partner or distractor id, or the feedback message key, and is `''` (never NULL: MySQL treats
 * NULLs in a unique key as distinct) when the field has none. Hard-deleted, never soft.
 */
export interface contenttranslationsAttributes {
  translationid: string;
  organisationid: string;
  tablename: string;
  rowid: string;
  field: string;
  subkey: string;
  language: string;
  text: string;
  sourcehash: string;
  lastupdated: Date;
}

export type contenttranslationsPk = 'translationid';
export type contenttranslationsId = contenttranslations[contenttranslationsPk];
export type contenttranslationsCreationAttributes = contenttranslationsAttributes;

export class contenttranslations
  extends Model<contenttranslationsAttributes, contenttranslationsCreationAttributes>
  implements contenttranslationsAttributes
{
  translationid!: string;
  organisationid!: string;
  tablename!: string;
  rowid!: string;
  field!: string;
  subkey!: string;
  language!: string;
  text!: string;
  sourcehash!: string;
  lastupdated!: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof contenttranslations {
    contenttranslations.init(
      {
        translationid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
        // The migration owns the foreign key (contenttranslations_organisationid_fk).
        organisationid: { type: DataTypes.STRING(36), allowNull: false },
        tablename: { type: DataTypes.STRING(40), allowNull: false },
        rowid: { type: DataTypes.STRING(36), allowNull: false },
        field: { type: DataTypes.STRING(64), allowNull: false },
        subkey: { type: DataTypes.STRING(64), allowNull: false, defaultValue: '' },
        language: { type: DataTypes.STRING(8), allowNull: false },
        text: { type: DataTypes.TEXT, allowNull: false },
        sourcehash: { type: DataTypes.CHAR(64), allowNull: false },
        lastupdated: { type: DataTypes.DATE(3), allowNull: false },
      },
      {
        sequelize,
        tableName: 'contenttranslations',
        timestamps: false,
        // Owned like the content tables: the content import reads every owned table through this scope. (No default
        // scope: the owner is the column the student routes filter by.)
        scopes: { withOwnership: {} },
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'translationid' }] },
          {
            name: 'contenttranslations_parent_language_unique',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'tablename' }, { name: 'rowid' }, { name: 'field' }, { name: 'subkey' }, { name: 'language' }],
          },
          { name: 'contenttranslations_organisationid', using: 'BTREE', fields: [{ name: 'organisationid' }] },
          { name: 'contenttranslations_table_row', using: 'BTREE', fields: [{ name: 'tablename' }, { name: 'rowid' }] },
        ],
      },
    );
    return contenttranslations;
  }
}
