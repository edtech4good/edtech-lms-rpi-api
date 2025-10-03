import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { studentprogress, studentprogressId } from './studentprogress';

export interface studentprogressquestionsAttributes {
  studentprogressid: string;
  studentprogressquestionid: string;
  tries?: number;
  iscorrect: number;
  referencequestionid: string;
}

export type studentprogressquestionsPk = "studentprogressquestionid";
export type studentprogressquestionsId = studentprogressquestions[studentprogressquestionsPk];
export type studentprogressquestionsOptionalAttributes = "studentprogressquestionid" | "tries" | "iscorrect";
export type studentprogressquestionsCreationAttributes = Optional<studentprogressquestionsAttributes, studentprogressquestionsOptionalAttributes>;

export class studentprogressquestions extends Model<studentprogressquestionsAttributes, studentprogressquestionsCreationAttributes> implements studentprogressquestionsAttributes {
  studentprogressid!: string;
  studentprogressquestionid!: string;
  tries?: number;
  iscorrect!: number;
  referencequestionid!: string;

  // studentprogressquestions belongsTo studentprogress via studentprogressid
  studentprogress!: studentprogress;
  getStudentprogress!: Sequelize.BelongsToGetAssociationMixin<studentprogress>;
  setStudentprogress!: Sequelize.BelongsToSetAssociationMixin<studentprogress, studentprogressId>;
  createStudentprogress!: Sequelize.BelongsToCreateAssociationMixin<studentprogress>;

  static initModel(sequelize: Sequelize.Sequelize): typeof studentprogressquestions {
    studentprogressquestions.init({
    studentprogressid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'studentprogress',
        key: 'studentprogressid'
      }
    },
    studentprogressquestionid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    tries: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    iscorrect: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    referencequestionid: {
      type: DataTypes.STRING(36),
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'studentprogressquestions',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "studentprogressquestionid" },
        ]
      },
      {
        name: "studentprogressid",
        using: "BTREE",
        fields: [
          { name: "studentprogressid" },
        ]
      },
    ]
  });
  return studentprogressquestions;
  }
}
