import * as Sequelize from "sequelize";
import { DataTypes, Model, Optional } from "sequelize";
import type {
  lessonpracticequestions,
  lessonpracticequestionsId,
} from "./lessonpracticequestions";
import type {
  lessonquizquestions,
  lessonquizquestionsId,
} from "./lessonquizquestions";
import type {
  levelquizquestions,
  levelquizquestionsId,
} from "./levelquizquestions";

export interface questionsAttributes {
  questionid: string;
  questionheading?: object;
  questionoptions?: object;
  questiontext?: string;
  questiondistractors?: object;
  questionfile?: object;
  templatetypeid: number;
  isdeleted: boolean;
  questionstatus: boolean;
  questionidentifier: string;
  questiontags?: object;
  lastupdated: Date;
  questionobject?: any;
  questioncorrectvalue?: number;
}

export type questionsPk = "questionid";
export type questionsId = questions[questionsPk];
export type questionsOptionalAttributes =
  | "questionid"
  | "questionheading"
  | "questionoptions"
  | "questiontext"
  | "questiondistractors"
  | "questionfile"
  | "isdeleted"
  | "questionstatus"
  | "questiontags"
  | "lastupdated";
export type questionsCreationAttributes = Optional<
  questionsAttributes,
  questionsOptionalAttributes
>;

export class questions
  extends Model<questionsAttributes, questionsCreationAttributes>
  implements questionsAttributes
{
  questionid!: string;
  questionheading?: object;
  questionoptions?: object;
  questiontext?: string;
  questiondistractors?: object;
  questionfile?: object;
  templatetypeid!: number;
  isdeleted!: boolean;
  questionstatus!: boolean;
  questionidentifier!: string;
  questiontags?: object;
  lastupdated!: Date;
  questionobject?: any;
  questioncorrectvalue?: number;

  // questions hasMany lessonpracticequestions via questionid
  lessonpracticequestions!: lessonpracticequestions[];
  getLessonpracticequestions!: Sequelize.HasManyGetAssociationsMixin<lessonpracticequestions>;
  setLessonpracticequestions!: Sequelize.HasManySetAssociationsMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  addLessonpracticequestion!: Sequelize.HasManyAddAssociationMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  addLessonpracticequestions!: Sequelize.HasManyAddAssociationsMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  createLessonpracticequestion!: Sequelize.HasManyCreateAssociationMixin<lessonpracticequestions>;
  removeLessonpracticequestion!: Sequelize.HasManyRemoveAssociationMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  removeLessonpracticequestions!: Sequelize.HasManyRemoveAssociationsMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  hasLessonpracticequestion!: Sequelize.HasManyHasAssociationMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  hasLessonpracticequestions!: Sequelize.HasManyHasAssociationsMixin<
    lessonpracticequestions,
    lessonpracticequestionsId
  >;
  countLessonpracticequestions!: Sequelize.HasManyCountAssociationsMixin;
  // questions hasMany lessonquizquestions via questionid
  lessonquizquestions!: lessonquizquestions[];
  getLessonquizquestions!: Sequelize.HasManyGetAssociationsMixin<lessonquizquestions>;
  setLessonquizquestions!: Sequelize.HasManySetAssociationsMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  addLessonquizquestion!: Sequelize.HasManyAddAssociationMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  addLessonquizquestions!: Sequelize.HasManyAddAssociationsMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  createLessonquizquestion!: Sequelize.HasManyCreateAssociationMixin<lessonquizquestions>;
  removeLessonquizquestion!: Sequelize.HasManyRemoveAssociationMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  removeLessonquizquestions!: Sequelize.HasManyRemoveAssociationsMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  hasLessonquizquestion!: Sequelize.HasManyHasAssociationMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  hasLessonquizquestions!: Sequelize.HasManyHasAssociationsMixin<
    lessonquizquestions,
    lessonquizquestionsId
  >;
  countLessonquizquestions!: Sequelize.HasManyCountAssociationsMixin;
  // questions hasMany levelquizquestions via questionid
  levelquizquestions!: levelquizquestions[];
  getLevelquizquestions!: Sequelize.HasManyGetAssociationsMixin<levelquizquestions>;
  setLevelquizquestions!: Sequelize.HasManySetAssociationsMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  addLevelquizquestion!: Sequelize.HasManyAddAssociationMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  addLevelquizquestions!: Sequelize.HasManyAddAssociationsMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  createLevelquizquestion!: Sequelize.HasManyCreateAssociationMixin<levelquizquestions>;
  removeLevelquizquestion!: Sequelize.HasManyRemoveAssociationMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  removeLevelquizquestions!: Sequelize.HasManyRemoveAssociationsMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  hasLevelquizquestion!: Sequelize.HasManyHasAssociationMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  hasLevelquizquestions!: Sequelize.HasManyHasAssociationsMixin<
    levelquizquestions,
    levelquizquestionsId
  >;
  countLevelquizquestions!: Sequelize.HasManyCountAssociationsMixin;

  static initModel(sequelize: Sequelize.Sequelize): typeof questions {
    questions.init(
      {
        questionid: {
          type: DataTypes.STRING(36),
          allowNull: false,
          primaryKey: true,
        },
        questionobject: {
          type: DataTypes.VIRTUAL,
          get() {
            const tempquestionoptions = this.questionoptions
              ? this.questionoptions
              : null;
            const tempquestiontext = this.questiontext
              ? this.questiontext
              : null;
            const tempquestionfile = this.questionfile
              ? this.questionfile
              : null;
            const tempquestiondistractors = this.questiondistractors
              ? this.questiondistractors
              : null;
            const tempquestionheading = this.questionheading
              ? this.questionheading
              : null;
            const tempquestioncorrectvalue = this.questioncorrectvalue
              ? this.questioncorrectvalue
              : null;
            const converttoobject = (value: string | Object | null) => {
              try {
                if (!value) {
                  return value;
                }
                return typeof value === "string" || value instanceof String
                  ? JSON.parse(value.toString())
                  : value;
              } catch (e) {
                console.log(e);
              }
            };
            return {
              questionoptions: converttoobject(tempquestionoptions),
              questionfile: converttoobject(tempquestionfile),
              questiontext: tempquestiontext,
              questiondistractors: converttoobject(tempquestiondistractors),
              questionheading: converttoobject(tempquestionheading),
              questioncorrectvalue: converttoobject(tempquestioncorrectvalue)
            };
          },
          set() {
            throw new Error("Do not try to set questionobject");
          },
        },
        questionheading: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        questionoptions: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        questiontext: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        questiondistractors: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        questionfile: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        templatetypeid: {
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        isdeleted: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 0,
        },
        questionstatus: {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: 1,
        },
        questionidentifier: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        questiontags: {
          type: DataTypes.JSON,
          allowNull: true,
        },
        lastupdated: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        questioncorrectvalue: {
          type: DataTypes.INTEGER,
          allowNull: false,
        }
      },
      {
        sequelize,
        tableName: "questions",
        timestamps: false,
        indexes: [
          {
            name: "PRIMARY",
            unique: true,
            using: "BTREE",
            fields: [{ name: "questionid" }],
          },
        ],
      }
    );
    return questions;
  }
}
