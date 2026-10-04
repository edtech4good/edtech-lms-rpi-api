/* eslint-disable camelcase */
import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

/**
 * Mirror of the central API's `organisations` table: only the columns this API
 * needs. Rows arrive from central (`PUT /import/ownership`); nothing here
 * creates or edits one, so there are no audit columns (as for `schools`).
 */
export interface organisationsAttributes {
  organisationid: string;
  organisationname: string;
  organisationcode: string;
  organisationstatus?: boolean;
  uitheme?: string;
  brandingconfig?: object | null;
  settingsconfig?: object | null;
  isdeleted?: boolean;
}

export type organisationsPk = "organisationid";
export type organisationsId = organisations[organisationsPk];
export type organisationsOptionalAttributes =
  | "organisationstatus"
  | "uitheme"
  | "brandingconfig"
  | "settingsconfig"
  | "isdeleted";
export type organisationsCreationAttributes = Optional<organisationsAttributes, organisationsOptionalAttributes>;

export class organisations
  extends Model<organisationsAttributes, organisationsCreationAttributes>
  implements organisationsAttributes
{
  organisationid!: string;
  organisationname!: string;
  organisationcode!: string;
  organisationstatus!: boolean;
  uitheme!: string;
  brandingconfig!: object | null;
  settingsconfig!: object | null;
  isdeleted!: boolean;

  static initModel(sequelize: Sequelize.Sequelize): typeof organisations {
    organisations.init(
      {
        organisationid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        organisationname: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        organisationcode: {
          type: DataTypes.STRING(16),
          allowNull: false,
        },
        organisationstatus: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        uitheme: {
          type: DataTypes.STRING(16),
          allowNull: false,
          defaultValue: 'kids',
        },
        brandingconfig: {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: null,
        },
        settingsconfig: {
          type: DataTypes.JSON,
          allowNull: true,
          defaultValue: null,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
      },
      {
        sequelize,
        tableName: 'organisations',
        timestamps: false,
        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'organisationid' }],
          },
        ],
      },
    );
    return organisations;
  }
}
