import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { lessonpractices, lessonpracticesId } from './lessonpractices';
import type { questions, questionsId } from './questions';

export interface lessonpracticequestionsAttributes {
  lessonpracticequestionid: string;
  lessonpracticeid: string;
  lessonpracticequestionstatus: boolean;
  questionid: string;
  lessonpracticequestionorder: number;
}

export type lessonpracticequestionsPk = "lessonpracticequestionid";
export type lessonpracticequestionsId = lessonpracticequestions[lessonpracticequestionsPk];
export type lessonpracticequestionsOptionalAttributes = "lessonpracticequestionid" | "lessonpracticequestionstatus";
export type lessonpracticequestionsCreationAttributes = Optional<lessonpracticequestionsAttributes, lessonpracticequestionsOptionalAttributes>;

export class lessonpracticequestions extends Model<lessonpracticequestionsAttributes, lessonpracticequestionsCreationAttributes> implements lessonpracticequestionsAttributes {
  lessonpracticequestionid!: string;
  lessonpracticeid!: string;
  lessonpracticequestionstatus!: boolean;
  questionid!: string;
  lessonpracticequestionorder!: number;

  // lessonpracticequestions belongsTo lessonpractices via lessonpracticeid
  lessonpractice!: lessonpractices;
  getLessonpractice!: Sequelize.BelongsToGetAssociationMixin<lessonpractices>;
  setLessonpractice!: Sequelize.BelongsToSetAssociationMixin<lessonpractices, lessonpracticesId>;
  createLessonpractice!: Sequelize.BelongsToCreateAssociationMixin<lessonpractices>;
  // lessonpracticequestions belongsTo questions via questionid
  question!: questions;
  getQuestion!: Sequelize.BelongsToGetAssociationMixin<questions>;
  setQuestion!: Sequelize.BelongsToSetAssociationMixin<questions, questionsId>;
  createQuestion!: Sequelize.BelongsToCreateAssociationMixin<questions>;

  static initModel(sequelize: Sequelize.Sequelize): typeof lessonpracticequestions {
    lessonpracticequestions.init({
    lessonpracticequestionid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    lessonpracticeid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'lessonpractices',
        key: 'lessonpracticeid'
      }
    },
    lessonpracticequestionstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    questionid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'questions',
        key: 'questionid'
      }
    },
    lessonpracticequestionorder: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'lessonpracticequestions',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "lessonpracticequestionid" },
        ]
      },
      {
        name: "lessonpracticeid",
        using: "BTREE",
        fields: [
          { name: "lessonpracticeid" },
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
  return lessonpracticequestions;
  }
}
