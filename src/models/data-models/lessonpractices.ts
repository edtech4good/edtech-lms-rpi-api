import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { lessonpracticequestions, lessonpracticequestionsId } from './lessonpracticequestions';
import type { lessons, lessonsId } from './lessons';
import { studentprogress } from './studentprogress';

export interface lessonpracticesAttributes {
  lessonpracticeid: string;
  lessonid: string;
  lessonpracticeorder: number;
  lessonpracticestatus: boolean;
  lessonpracticename: string;
  lessonpracticedescription: string;
  points?: number;

  student_practice_points?: number;
  studentprogresses?: studentprogress[]
}

export type lessonpracticesPk = "lessonpracticeid";
export type lessonpracticesId = lessonpractices[lessonpracticesPk];
export type lessonpracticesOptionalAttributes = "lessonpracticeid" | "lessonpracticestatus";
export type lessonpracticesCreationAttributes = Optional<lessonpracticesAttributes, lessonpracticesOptionalAttributes>;

export class lessonpractices extends Model<lessonpracticesAttributes, lessonpracticesCreationAttributes> implements lessonpracticesAttributes {
  lessonpracticeid!: string;
  lessonid!: string;
  lessonpracticeorder!: number;
  lessonpracticestatus!: boolean;
  lessonpracticename!: string;
  lessonpracticedescription!: string;
  points!: number;

  student_practice_points?: number;

  // lessonpractices hasMany lessonpracticequestions via lessonpracticeid
  lessonpracticequestions!: lessonpracticequestions[];
  studentprogresses!: studentprogress[];
  getLessonpracticequestions!: Sequelize.HasManyGetAssociationsMixin<lessonpracticequestions>;
  setLessonpracticequestions!: Sequelize.HasManySetAssociationsMixin<lessonpracticequestions, lessonpracticequestionsId>;
  addLessonpracticequestion!: Sequelize.HasManyAddAssociationMixin<lessonpracticequestions, lessonpracticequestionsId>;
  addLessonpracticequestions!: Sequelize.HasManyAddAssociationsMixin<lessonpracticequestions, lessonpracticequestionsId>;
  createLessonpracticequestion!: Sequelize.HasManyCreateAssociationMixin<lessonpracticequestions>;
  removeLessonpracticequestion!: Sequelize.HasManyRemoveAssociationMixin<lessonpracticequestions, lessonpracticequestionsId>;
  removeLessonpracticequestions!: Sequelize.HasManyRemoveAssociationsMixin<lessonpracticequestions, lessonpracticequestionsId>;
  hasLessonpracticequestion!: Sequelize.HasManyHasAssociationMixin<lessonpracticequestions, lessonpracticequestionsId>;
  hasLessonpracticequestions!: Sequelize.HasManyHasAssociationsMixin<lessonpracticequestions, lessonpracticequestionsId>;
  countLessonpracticequestions!: Sequelize.HasManyCountAssociationsMixin;
  // lessonpractices belongsTo lessons via lessonid
  lesson!: lessons;
  getLesson!: Sequelize.BelongsToGetAssociationMixin<lessons>;
  setLesson!: Sequelize.BelongsToSetAssociationMixin<lessons, lessonsId>;
  createLesson!: Sequelize.BelongsToCreateAssociationMixin<lessons>;

  static initModel(sequelize: Sequelize.Sequelize): typeof lessonpractices {
    lessonpractices.init({
    lessonpracticeid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    lessonid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'lessons',
        key: 'lessonid'
      }
    },
    lessonpracticeorder: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    lessonpracticestatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    lessonpracticename: {
      type: DataTypes.STRING(250),
      allowNull: false
    },
    lessonpracticedescription: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
  }, {
    sequelize,
    tableName: 'lessonpractices',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "lessonpracticeid" },
        ]
      },
      {
        name: "lessonid",
        using: "BTREE",
        fields: [
          { name: "lessonid" },
        ]
      },
    ]
  });
  return lessonpractices;
  }
}
