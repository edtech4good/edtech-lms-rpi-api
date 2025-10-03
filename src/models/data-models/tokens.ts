import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface tokensAttributes {
  token: string;
  lmsuserid: string;
  tokentype: string;
}

export type tokensPk = "token";
export type tokensId = tokens[tokensPk];
export type tokensOptionalAttributes = "token";
export type tokensCreationAttributes = Optional<tokensAttributes, tokensOptionalAttributes>;

export class tokens extends Model<tokensAttributes, tokensCreationAttributes> implements tokensAttributes {
  token!: string;
  lmsuserid!: string;
  tokentype!: string;


  static initModel(sequelize: Sequelize.Sequelize): typeof tokens {
    tokens.init({
      token: {
        type: DataTypes.STRING(500),
        allowNull: false,
        primaryKey: true
      },
      lmsuserid: {
        type: DataTypes.STRING(36),
        allowNull: false
      },
      tokentype: {
        type: DataTypes.STRING(8),
        allowNull: false
      }
    }, {
      sequelize,
      tableName: 'tokens',
      timestamps: false,
      indexes: [
        {
          name: "PRIMARY",
          unique: true,
          using: "BTREE",
          fields: [
            { name: "token" },
          ]
        },
      ]
    });
    return tokens;
  }
}
