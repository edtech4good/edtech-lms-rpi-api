import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { lessonquizzes, lessonquizzesId } from './lessonquizzes';
import type { questions, questionsId } from './questions';

export interface lessonquizquestionsAttributes {
  lessonquizquestionid: string;
  lessonquizid: string;
  questionid: string;
  lessonquizquestionstatus: boolean;
  lessonquizquestionorder: number;
}

export type lessonquizquestionsPk = "lessonquizquestionid";
export type lessonquizquestionsId = lessonquizquestions[lessonquizquestionsPk];
export type lessonquizquestionsOptionalAttributes = "lessonquizquestionid" | "lessonquizquestionstatus";
export type lessonquizquestionsCreationAttributes = Optional<lessonquizquestionsAttributes, lessonquizquestionsOptionalAttributes>;

export class lessonquizquestions extends Model<lessonquizquestionsAttributes, lessonquizquestionsCreationAttributes> implements lessonquizquestionsAttributes {
  lessonquizquestionid!: string;
  lessonquizid!: string;
  questionid!: string;
  lessonquizquestionstatus!: boolean;
  lessonquizquestionorder!: number;

  // lessonquizquestions belongsTo lessonquizzes via lessonquizid
  lessonquiz!: lessonquizzes;
  getLessonquiz!: Sequelize.BelongsToGetAssociationMixin<lessonquizzes>;
  setLessonquiz!: Sequelize.BelongsToSetAssociationMixin<lessonquizzes, lessonquizzesId>;
  createLessonquiz!: Sequelize.BelongsToCreateAssociationMixin<lessonquizzes>;
  // lessonquizquestions belongsTo questions via questionid
  question!: questions;
  getQuestion!: Sequelize.BelongsToGetAssociationMixin<questions>;
  setQuestion!: Sequelize.BelongsToSetAssociationMixin<questions, questionsId>;
  createQuestion!: Sequelize.BelongsToCreateAssociationMixin<questions>;

  static initModel(sequelize: Sequelize.Sequelize): typeof lessonquizquestions {
    lessonquizquestions.init({
    lessonquizquestionid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    lessonquizid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'lessonquizzes',
        key: 'lessonquizid'
      }
    },
    questionid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'questions',
        key: 'questionid'
      }
    },
    lessonquizquestionstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    lessonquizquestionorder: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'lessonquizquestions',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "lessonquizquestionid" },
        ]
      },
      {
        name: "lessonquizid",
        using: "BTREE",
        fields: [
          { name: "lessonquizid" },
        ]
      },
      {
        name: "questionid",
        using: "BTREE",
        fields: [
          { name: "questionid" },
        ]
      },
    ]
  });
  return lessonquizquestions;
  }
}
