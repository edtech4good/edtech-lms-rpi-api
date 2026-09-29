import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { studentprogress, studentprogressId } from './studentprogress';

export type studentprogressquestionsServerGrade = "correct" | "incorrect" | "ungradable";

export interface studentprogressquestionsAttributes {
  studentprogressid: string;
  studentprogressquestionid: string;
  tries?: number;
  iscorrect: number;
  referencequestionid: string;
  /** The raw AnswerV1 payload the client submitted, or null (workspace#79 step 1b). */
  answer?: object | null;
  /** The client's own claimed verdict, preserved regardless of GRADING_MODE. */
  clientiscorrect?: boolean | null;
  /** Server grade for this item, null only when there was no active question to grade against. */
  servergrade?: studentprogressquestionsServerGrade | null;
}

export type studentprogressquestionsPk = "studentprogressquestionid";
export type studentprogressquestionsId = studentprogressquestions[studentprogressquestionsPk];
export type studentprogressquestionsOptionalAttributes = "studentprogressquestionid" | "tries" | "iscorrect" | "answer" | "clientiscorrect" | "servergrade";
export type studentprogressquestionsCreationAttributes = Optional<studentprogressquestionsAttributes, studentprogressquestionsOptionalAttributes>;

export class studentprogressquestions extends Model<studentprogressquestionsAttributes, studentprogressquestionsCreationAttributes> implements studentprogressquestionsAttributes {
  studentprogressid!: string;
  studentprogressquestionid!: string;
  tries?: number;
  iscorrect!: number;
  referencequestionid!: string;
  answer?: object | null;
  clientiscorrect?: boolean | null;
  servergrade?: studentprogressquestionsServerGrade | null;

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
    },
    answer: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null
    },
    clientiscorrect: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: null
    },
    servergrade: {
      type: DataTypes.ENUM("correct", "incorrect", "ungradable"),
      allowNull: true,
      defaultValue: null
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
