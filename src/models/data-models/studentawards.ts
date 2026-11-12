import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";

/**
 * A learner's lasting award for completing a level, one per learner per level, ever. Written in the same
 * transaction as the level progress (`src/business/level-award.ts`) and never updated or deleted by the
 * progress code: an award outlives a later drop in progress and the level itself.
 */
export interface studentawardsAttributes {
  studentawardid: string;
  studentid: string;
  levelid: string;
  gradeid: string;
  curid: string;
  earnedat: Date;
  earnedat_approximate?: boolean;
  lastupdated?: Date;
}

export type studentawardsPk = "studentawardid";
export type studentawardsId = studentawards[studentawardsPk];
export type studentawardsOptionalAttributes = "earnedat_approximate" | "lastupdated";
export type studentawardsCreationAttributes = Optional<studentawardsAttributes, studentawardsOptionalAttributes>;

export class studentawards
  extends Model<studentawardsAttributes, studentawardsCreationAttributes>
  implements studentawardsAttributes
{
  studentawardid!: string;
  studentid!: string;
  levelid!: string;
  gradeid!: string;
  curid!: string;
  earnedat!: Date;
  earnedat_approximate!: boolean;
  lastupdated!: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof studentawards {
    studentawards.init(
      {
        studentawardid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        studentid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        levelid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        gradeid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        curid: {
          type: DataTypes.STRING(36),
          allowNull: false,
        },
        earnedat: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        earnedat_approximate: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        lastupdated: {
          type: DataTypes.DATE,
          defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "studentawards",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentawardid" }],
          },
          {
            name: "uq_studentawards_student_level",
            unique: true,
            using: "BTREE",
            fields: [{ name: "studentid" }, { name: "levelid" }],
          },
          {
            name: "idx_studentawards_studentid",
            using: "BTREE",
            fields: [{ name: "studentid" }],
          },
        ],
      }
    );
    return studentawards;
  }
}
