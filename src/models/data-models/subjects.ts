/* eslint-disable camelcase */
import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import { ownershipDefaultScope } from "./ownership-scope";

export interface subjectsAttributes {
  subjectid: string;
  subjectname: string;
  subjectstatus?: boolean;
  subjectdescription?: string;
  isdeleted?: boolean;
  organisationid?: string | null;
}

export type subjectsPk = "subjectid";
export type subjectsId = subjects[subjectsPk];
export type subjectsCreationAttributes = Optional<
  subjectsAttributes,
  subjectsPk
>;

export class subjects
  extends Model<subjectsAttributes, subjectsCreationAttributes>
  implements subjectsAttributes
{
  subjectid!: string;
  subjectname!: string;
  subjectstatus!: boolean;
  subjectdescription?: string;
  isdeleted!: boolean;
  organisationid!: string | null;

  static initModel(sequelize: Sequelize.Sequelize): typeof subjects {
    subjects.init(
      {
        subjectid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        subjectname: {
          type: DataTypes.STRING(250),
          allowNull: false,
        },
        subjectstatus: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 1,
        },
        subjectdescription: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 0,
        },
        // See ownership-scope.ts; no `references` (the migration owns the key).
        organisationid: {
          type: DataTypes.STRING(36),
          allowNull: true,
          defaultValue: null,
        },
      },
      {
        sequelize,
        tableName: "subjects",
        timestamps: false,
        defaultScope: ownershipDefaultScope('organisationid'),
        scopes: { withOwnership: {} },
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "subjectid" }],
          },
        ],
      }
    );
    return subjects;
  }
}
