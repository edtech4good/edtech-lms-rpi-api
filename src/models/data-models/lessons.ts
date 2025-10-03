import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { lessonlearnings, lessonlearningsId } from './lessonlearnings';
import type { lessonpractices, lessonpracticesId } from './lessonpractices';
import type { lessonquizzes, lessonquizzesId } from './lessonquizzes';
import type { levels, levelsId } from './levels';
import { studentlessonsprogress } from './studentlessonsprogress';
import { studentprogress } from './studentprogress';
import type { students, studentsId } from './students';

export interface lessonsAttributes {
  lessonid: string;
  levelid: string;
  lessonname: string;
  lessondescription?: string;
  practicecount: number;
  quizcount: number;
  lessonpasspercentage: number;
  lessonorder: number;
  lessonstatus: boolean;
  isdeleted: boolean;
  lessonheading?: string;
  total_points?: number;
  brick_points?: number;
  passing_points?: number;
  learning_points?: number;
  quizzes_points?: number;
  practices_points?: number;
  progress?: number;

  student_learning_points?: number;
  student_practice_points?: number;
  student_quiz_points?: number;
  student_scores?: number;

  number_completed_practices?: number;
  number_completed_quizzes?: number;
  number_learnings?: number;
  number_practices?: number;
  number_quizzes?: number;

  completed?: boolean;

  studentlessonsprogresses?: studentlessonsprogress[];
  studentlessonsprogress?: studentlessonsprogress;
  studentlessonprogress?: studentlessonsprogress;

  added_completed_scores?: number;
  quiz_scores?: number;

  laststudentprogress?: studentprogress;
  level?: levels;
  student?: students;
  starttime?: Date;
}

export type lessonsPk = "lessonid";
export type lessonsId = lessons[lessonsPk];
export type lessonsOptionalAttributes = "lessonid" | "lessondescription" | "practicecount" | "quizcount" | "lessonpasspercentage" | "lessonorder" | "lessonstatus" | "isdeleted";
export type lessonsCreationAttributes = Optional<lessonsAttributes, lessonsOptionalAttributes>;

export class lessons extends Model<lessonsAttributes, lessonsCreationAttributes> implements lessonsAttributes {
  lessonid!: string;
  levelid!: string;
  lessonname!: string;
  lessondescription?: string;
  practicecount!: number;
  quizcount!: number;
  lessonpasspercentage!: number;
  lessonorder!: number;
  lessonstatus!: boolean;
  isdeleted!: boolean;
  lessonheading?: string;
  total_points!: number;
  brick_points!: number;
  passing_points!: number;
  learning_points!: number;
  quizzes_points!: number;
  practices_points!: number;
  progress!: number;

  student_learning_points?: number;
  student_practice_points?: number;
  student_quiz_points?: number;

  completed?: boolean;

  // lessons hasMany lessonlearnings via lessonid
  lessonlearnings!: lessonlearnings[];
  getLessonlearnings!: Sequelize.HasManyGetAssociationsMixin<lessonlearnings>;
  setLessonlearnings!: Sequelize.HasManySetAssociationsMixin<lessonlearnings, lessonlearningsId>;
  addLessonlearning!: Sequelize.HasManyAddAssociationMixin<lessonlearnings, lessonlearningsId>;
  addLessonlearnings!: Sequelize.HasManyAddAssociationsMixin<lessonlearnings, lessonlearningsId>;
  createLessonlearning!: Sequelize.HasManyCreateAssociationMixin<lessonlearnings>;
  removeLessonlearning!: Sequelize.HasManyRemoveAssociationMixin<lessonlearnings, lessonlearningsId>;
  removeLessonlearnings!: Sequelize.HasManyRemoveAssociationsMixin<lessonlearnings, lessonlearningsId>;
  hasLessonlearning!: Sequelize.HasManyHasAssociationMixin<lessonlearnings, lessonlearningsId>;
  hasLessonlearnings!: Sequelize.HasManyHasAssociationsMixin<lessonlearnings, lessonlearningsId>;
  countLessonlearnings!: Sequelize.HasManyCountAssociationsMixin;
  // lessons hasMany lessonpractices via lessonid
  lessonpractices!: lessonpractices[];
  getLessonpractices!: Sequelize.HasManyGetAssociationsMixin<lessonpractices>;
  setLessonpractices!: Sequelize.HasManySetAssociationsMixin<lessonpractices, lessonpracticesId>;
  addLessonpractice!: Sequelize.HasManyAddAssociationMixin<lessonpractices, lessonpracticesId>;
  addLessonpractices!: Sequelize.HasManyAddAssociationsMixin<lessonpractices, lessonpracticesId>;
  createLessonpractice!: Sequelize.HasManyCreateAssociationMixin<lessonpractices>;
  removeLessonpractice!: Sequelize.HasManyRemoveAssociationMixin<lessonpractices, lessonpracticesId>;
  removeLessonpractices!: Sequelize.HasManyRemoveAssociationsMixin<lessonpractices, lessonpracticesId>;
  hasLessonpractice!: Sequelize.HasManyHasAssociationMixin<lessonpractices, lessonpracticesId>;
  hasLessonpractices!: Sequelize.HasManyHasAssociationsMixin<lessonpractices, lessonpracticesId>;
  countLessonpractices!: Sequelize.HasManyCountAssociationsMixin;
  // lessons hasMany lessonquizzes via lessonid
  lessonquizzes!: lessonquizzes[];
  getLessonquizzes!: Sequelize.HasManyGetAssociationsMixin<lessonquizzes>;
  setLessonquizzes!: Sequelize.HasManySetAssociationsMixin<lessonquizzes, lessonquizzesId>;
  addLessonquiz!: Sequelize.HasManyAddAssociationMixin<lessonquizzes, lessonquizzesId>;
  addLessonquizzes!: Sequelize.HasManyAddAssociationsMixin<lessonquizzes, lessonquizzesId>;
  createLessonquiz!: Sequelize.HasManyCreateAssociationMixin<lessonquizzes>;
  removeLessonquiz!: Sequelize.HasManyRemoveAssociationMixin<lessonquizzes, lessonquizzesId>;
  removeLessonquizzes!: Sequelize.HasManyRemoveAssociationsMixin<lessonquizzes, lessonquizzesId>;
  hasLessonquiz!: Sequelize.HasManyHasAssociationMixin<lessonquizzes, lessonquizzesId>;
  hasLessonquizzes!: Sequelize.HasManyHasAssociationsMixin<lessonquizzes, lessonquizzesId>;
  countLessonquizzes!: Sequelize.HasManyCountAssociationsMixin;
  // lessons hasMany students via studentcurrentlessonid
  students!: students[];
  getStudents!: Sequelize.HasManyGetAssociationsMixin<students>;
  setStudents!: Sequelize.HasManySetAssociationsMixin<students, studentsId>;
  addStudent!: Sequelize.HasManyAddAssociationMixin<students, studentsId>;
  addStudents!: Sequelize.HasManyAddAssociationsMixin<students, studentsId>;
  createStudent!: Sequelize.HasManyCreateAssociationMixin<students>;
  removeStudent!: Sequelize.HasManyRemoveAssociationMixin<students, studentsId>;
  removeStudents!: Sequelize.HasManyRemoveAssociationsMixin<students, studentsId>;
  hasStudent!: Sequelize.HasManyHasAssociationMixin<students, studentsId>;
  hasStudents!: Sequelize.HasManyHasAssociationsMixin<students, studentsId>;
  countStudents!: Sequelize.HasManyCountAssociationsMixin;
  // lessons belongsTo levels via levelid
  level!: levels;
  getLevel!: Sequelize.BelongsToGetAssociationMixin<levels>;
  setLevel!: Sequelize.BelongsToSetAssociationMixin<levels, levelsId>;
  createLevel!: Sequelize.BelongsToCreateAssociationMixin<levels>;

  studentlessonsprogresses!: studentlessonsprogress[];

  static initModel(sequelize: Sequelize.Sequelize): typeof lessons {
    lessons.init({
    lessonid: {
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
    lessonname: {
      type: DataTypes.STRING(250),
      allowNull: false
    },
    lessondescription: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    lessonheading: {
      type: DataTypes.VIRTUAL,
      get() {
        const number = this.lessonname.match(/[0-9]+/g);
        return number && number.length > 0 ? number[0] : this.lessonname;
      },
      set() {
        throw new Error('Do not try to set lessonheading');
      },
    },
    practicecount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    quizcount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    lessonpasspercentage: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 80
    },
    lessonorder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    lessonstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    isdeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    total_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    brick_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    passing_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    learning_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
    quizzes_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
    practices_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
  }, {
    sequelize,
    tableName: 'lessons',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "lessonid" },
        ]
      },
      {
        name: "levelid",
        using: "BTREE",
        fields: [
          { name: "levelid" },
        ]
      },
    ]
  });
  return lessons;
  }
}
