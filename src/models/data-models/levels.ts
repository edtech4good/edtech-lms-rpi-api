import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';
import type { grades, gradesId } from './grades';
import type { lessons, lessonsId } from './lessons';
import type { levelquizquestions, levelquizquestionsId } from './levelquizquestions';
import { studentlevelsprogress } from './studentlevelsprogress';
import { studentprogress } from './studentprogress';
import type { students, studentsId } from './students';

export interface levelsAttributes {
  levelid: string;
  gradeid: string;
  levelname: string;
  leveldescription?: string;
  isdeleted: boolean;
  levelstatus: boolean;
  levelorder: number;
  passing_points?: number;
  quiz_points?: number;
  points?: number;
  progress?: number;
  number_completed_lessons?: number;

  completed?: boolean;
  studentlevelsprogresses?: studentlevelsprogress[];
  studentlevelsprogress?: studentlevelsprogress;
  studentlevelprogress?: studentlevelsprogress;
  studentprogresses?: studentprogress[];

  level_quiz_total_scores?: number;
  level_quiz_reward?: number;
  level_quiz_scores?: number;

  laststudentprogress?: studentprogress;
  grade?: grades;
  student?: students;
  starttime?: Date;
}

export type levelsPk = "levelid";
export type levelsId = levels[levelsPk];
export type levelsOptionalAttributes = "levelid" | "leveldescription" | "isdeleted" | "levelstatus" | "levelorder";
export type levelsCreationAttributes = Optional<levelsAttributes, levelsOptionalAttributes>;

export class levels extends Model<levelsAttributes, levelsCreationAttributes> implements levelsAttributes {
  levelid!: string;
  gradeid!: string;
  levelname!: string;
  leveldescription?: string;
  isdeleted!: boolean;
  levelstatus!: boolean;
  levelorder!: number;
  passing_points!: number;
  quiz_points!: number;
  points!: number;
  progress!: number;

  completed?: boolean;

  // levels belongsTo grades via gradeid
  grade!: grades;
  getGrade!: Sequelize.BelongsToGetAssociationMixin<grades>;
  setGrade!: Sequelize.BelongsToSetAssociationMixin<grades, gradesId>;
  createGrade!: Sequelize.BelongsToCreateAssociationMixin<grades>;
  // levels hasMany lessons via levelid
  lessons!: lessons[];
  getLessons!: Sequelize.HasManyGetAssociationsMixin<lessons>;
  setLessons!: Sequelize.HasManySetAssociationsMixin<lessons, lessonsId>;
  addLesson!: Sequelize.HasManyAddAssociationMixin<lessons, lessonsId>;
  addLessons!: Sequelize.HasManyAddAssociationsMixin<lessons, lessonsId>;
  createLesson!: Sequelize.HasManyCreateAssociationMixin<lessons>;
  removeLesson!: Sequelize.HasManyRemoveAssociationMixin<lessons, lessonsId>;
  removeLessons!: Sequelize.HasManyRemoveAssociationsMixin<lessons, lessonsId>;
  hasLesson!: Sequelize.HasManyHasAssociationMixin<lessons, lessonsId>;
  hasLessons!: Sequelize.HasManyHasAssociationsMixin<lessons, lessonsId>;
  countLessons!: Sequelize.HasManyCountAssociationsMixin;
  // levels hasMany levelquizquestions via levelid
  levelquizquestions!: levelquizquestions[];
  getLevelquizquestions!: Sequelize.HasManyGetAssociationsMixin<levelquizquestions>;
  setLevelquizquestions!: Sequelize.HasManySetAssociationsMixin<levelquizquestions, levelquizquestionsId>;
  addLevelquizquestion!: Sequelize.HasManyAddAssociationMixin<levelquizquestions, levelquizquestionsId>;
  addLevelquizquestions!: Sequelize.HasManyAddAssociationsMixin<levelquizquestions, levelquizquestionsId>;
  createLevelquizquestion!: Sequelize.HasManyCreateAssociationMixin<levelquizquestions>;
  removeLevelquizquestion!: Sequelize.HasManyRemoveAssociationMixin<levelquizquestions, levelquizquestionsId>;
  removeLevelquizquestions!: Sequelize.HasManyRemoveAssociationsMixin<levelquizquestions, levelquizquestionsId>;
  hasLevelquizquestion!: Sequelize.HasManyHasAssociationMixin<levelquizquestions, levelquizquestionsId>;
  hasLevelquizquestions!: Sequelize.HasManyHasAssociationsMixin<levelquizquestions, levelquizquestionsId>;
  countLevelquizquestions!: Sequelize.HasManyCountAssociationsMixin;
  // levels hasMany students via startinglevelid
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
  // levels hasMany students via studentcurrentlevelid
  studentcurrentlevel_students!: students[];
  getStudentcurrentlevel_students!: Sequelize.HasManyGetAssociationsMixin<students>;
  setStudentcurrentlevel_students!: Sequelize.HasManySetAssociationsMixin<students, studentsId>;
  addStudentcurrentlevel_student!: Sequelize.HasManyAddAssociationMixin<students, studentsId>;
  addStudentcurrentlevel_students!: Sequelize.HasManyAddAssociationsMixin<students, studentsId>;
  createStudentcurrentlevel_student!: Sequelize.HasManyCreateAssociationMixin<students>;
  removeStudentcurrentlevel_student!: Sequelize.HasManyRemoveAssociationMixin<students, studentsId>;
  removeStudentcurrentlevel_students!: Sequelize.HasManyRemoveAssociationsMixin<students, studentsId>;
  hasStudentcurrentlevel_student!: Sequelize.HasManyHasAssociationMixin<students, studentsId>;
  hasStudentcurrentlevel_students!: Sequelize.HasManyHasAssociationsMixin<students, studentsId>;
  countStudentcurrentlevel_students!: Sequelize.HasManyCountAssociationsMixin;

  studentlevelsprogresses!: studentlevelsprogress[];

  static initModel(sequelize: Sequelize.Sequelize): typeof levels {
    levels.init({
    levelid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      primaryKey: true
    },
    gradeid: {
      type: DataTypes.STRING(36),
      allowNull: false,
      references: {
        model: 'grades',
        key: 'gradeid'
      }
    },
    levelname: {
      type: DataTypes.STRING(250),
      allowNull: false
    },
    leveldescription: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isdeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0
    },
    levelstatus: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 1
    },
    levelorder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    passing_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: null
    },
    quiz_points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
    points: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
      defaultValue: 0
    },
  }, {
    sequelize,
    tableName: 'levels',
    timestamps: false,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "levelid" },
        ]
      },
      {
        name: "gradeid",
        using: "BTREE",
        fields: [
          { name: "gradeid" },
        ]
      },
    ]
  });
  return levels;
  }
}
