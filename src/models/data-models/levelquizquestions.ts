import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { levels, levelsId } from './levels';
import type { questions, questionsId } from './questions';

export interface levelquizquestionsAttributes {
  levelquizquestionid: string;
  levelid: string;
  questionid: string;
  levelquizquestionstatus: boolean;
  levelquizquestionorder: number;
  lessonid?: string;
}

export type levelquizquestionsPk = "levelquizquestionid";
export type levelquizquestionsId = levelquizquestions[levelquizquestionsPk];
export type levelquizquestionsOptionalAttributes = "levelquizquestionid" | "levelquizquestionstatus";
export type levelquizquestionsCreationAttributes = Optional<levelquizquestionsAttributes, levelquizquestionsOptionalAttributes>;

export class levelquizquestions extends Model<levelquizquestionsAttributes, levelquizquestionsCreationAttributes> implements levelquizquestionsAttributes {
  levelquizquestionid!: string;
  levelid!: string;
  questionid!: string;
  levelquizquestionstatus!: boolean;
  levelquizquestionorder!: number;
  lessonid?: string;

  // levelquizquestions belongsTo levels via levelid
  level!: levels;
  getLevel!: Sequelize.BelongsToGetAssociationMixin<levels>;
  setLevel!: Sequelize.BelongsToSetAssociationMixin<levels, levelsId>;
  createLevel!: Sequelize.BelongsToCreateAssociationMixin<levels>;
  // levelquizquestions belongsTo questions via questionid
  question!: questions;
  getQuestion!: Sequelize.BelongsToGetAssociationMixin<questions>;
  setQuestion!: Sequelize.BelongsToSetAssociationMixin<questions, questionsId>;
  createQuestion!: Sequelize.BelongsToCreateAssociationMixin<questions>;

  static initModel(sequelize: Sequelize.Sequelize): typeof levelquizquestions {
    levelquizquestions.init({
    levelquizquestionid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    levelid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'levels',
        key: 'levelid'
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
    levelquizquestionstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    levelquizquestionorder: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    lessonid: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  }, {
    sequelize,
    tableName: 'levelquizquestions',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "levelquizquestionid" },
        ]
      },
      {
        name: "levelid",
        using: "BTREE",
        fields: [
          { name: "levelid" },
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
  return levelquizquestions;
  }
}
