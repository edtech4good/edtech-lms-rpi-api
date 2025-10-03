import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

export interface curriculumbaselineAttributes {
  curriculumbaselineid: string;
  curriculumid: string;
  baselineid: string;
  baselinename: string;
  baselinetype: number;
  baselinestatus: boolean;
  startdate: Date;
  enddate: Date;
  schoolid: Array<string>;
  isdeleted?: boolean;
}

export type curriculumbaselinePk = "curriculumbaselineid";
export type curriculumbaselineId = curriculumbaseline[curriculumbaselinePk];
export type curriculumbaselineCreationAttributes = Optional<
  curriculumbaselineAttributes,
  curriculumbaselinePk
>;

export class curriculumbaseline
  extends Model<
    curriculumbaselineAttributes,
    curriculumbaselineCreationAttributes
  >
  implements curriculumbaselineAttributes
{
  curriculumbaselineid!: string;
  curriculumid!: string;
  baselineid!: string;
  baselinename!: string;
  baselinetype!: number;
  baselinestatus!: boolean;
  startdate!: Date;
  enddate!: Date;
  schoolid!: Array<string>;
  isdeleted!: boolean;

  static initModel(sequelize: Sequelize.Sequelize): typeof curriculumbaseline {
    curriculumbaseline.init(
      {
        curriculumbaselineid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        curriculumid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        baselineid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        baselinename: {
          type: DataTypes.STRING(36),
          allowNull: true,
        },
        baselinetype: {
          type: DataTypes.TINYINT,
          allowNull: true,
        },
        baselinestatus: {
          type: DataTypes.BOOLEAN,
          allowNull: true,
        },
        startdate: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        enddate: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        schoolid: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 0,
        }
      },
      {
        sequelize,
        tableName: "curriculumbaseline",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "curriculumbaselineid" }],
          },
        ],
      }
    );
    return curriculumbaseline;
  }
}
