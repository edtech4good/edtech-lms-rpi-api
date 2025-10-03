import type { Sequelize } from "sequelize";
import type {
  curriculumbaselineAttributes,
  curriculumbaselineCreationAttributes,
} from "./curriculumbaseline";
import { curriculumbaseline } from "./curriculumbaseline";
import type {
  curriculumsAttributes,
  curriculumsCreationAttributes,
} from "./curriculums";
import { curriculums } from "./curriculums";

import type {
  documentsAttributes,
  documentsCreationAttributes,
} from "./documents";
import { documents } from "./documents";

import type { gradesAttributes, gradesCreationAttributes } from "./grades";
import { grades } from "./grades";
import type {
  lessonlearningsAttributes,
  lessonlearningsCreationAttributes,
} from "./lessonlearnings";
import { lessonlearnings } from "./lessonlearnings";
import type {
  lessonpracticequestionsAttributes,
  lessonpracticequestionsCreationAttributes,
} from "./lessonpracticequestions";
import { lessonpracticequestions } from "./lessonpracticequestions";
import type {
  lessonpracticesAttributes,
  lessonpracticesCreationAttributes,
} from "./lessonpractices";
import { lessonpractices } from "./lessonpractices";
import type {
  lessonquizquestionsAttributes,
  lessonquizquestionsCreationAttributes,
} from "./lessonquizquestions";
import { lessonquizquestions } from "./lessonquizquestions";
import type {
  lessonquizzesAttributes,
  lessonquizzesCreationAttributes,
} from "./lessonquizzes";
import { lessonquizzes } from "./lessonquizzes";
import type { lessonsAttributes, lessonsCreationAttributes } from "./lessons";
import { lessons } from "./lessons";
import type {
  levelquizquestionsAttributes,
  levelquizquestionsCreationAttributes,
} from "./levelquizquestions";
import { levelquizquestions } from "./levelquizquestions";
import type { levelsAttributes, levelsCreationAttributes } from "./levels";
import { levels } from "./levels";

import type {
  questionsAttributes,
  questionsCreationAttributes,
} from "./questions";
import { questions } from "./questions";

import type {
  rpiuseraccessAttributes,
  rpiuseraccessCreationAttributes,
} from "./rpiuseraccess";
import { rpiuseraccess } from "./rpiuseraccess";

import type {
  schoolusersAttributes,
  schoolusersCreationAttributes,
} from "./schoolusers";
import { schoolusers } from "./schoolusers";

import type {
  studentprogressAttributes,
  studentprogressCreationAttributes,
} from "./studentprogress";
import { studentprogress } from "./studentprogress";
import type {
  studentprogressquestionsAttributes,
  studentprogressquestionsCreationAttributes,
} from "./studentprogressquestions";
import { studentprogressquestions } from "./studentprogressquestions";
import type {
  studentsAttributes,
  studentsCreationAttributes,
} from "./students";
import { students } from "./students";
import type { tokensAttributes, tokensCreationAttributes } from "./tokens";
import { tokens } from "./tokens";
import { studentlearningprogress } from "src/models/data-models/studentlearningprogress";
import { studentlessonsprogress } from "src/models/data-models/studentlessonsprogress";
import { studentlevelsprogress } from "src/models/data-models/studentlevelsprogress";
import { studentgradesprogress } from "src/models/data-models/studentgradesprogress";
import { studentactives } from "src/models/data-models/studentactives";
import { studentpoints } from "src/models/data-models/studentpoints";
import { studentappusages } from "./studentappusage";
import { standards } from "./standards";
import { schools } from "./school";
import { countries } from "./countries";
import { studenttrash } from "./studenttrash";
import { baselinequestion } from "./baselinequestion";
import { lessonplans } from "./lessonplan";
import { subjects } from "./subjects";

export {
  curriculumbaseline,
  curriculums,
  documents,
  grades,
  lessonlearnings,
  lessonpracticequestions,
  lessonpractices,
  lessonquizquestions,
  lessonquizzes,
  lessons,
  levelquizquestions,
  levels,
  questions,
  schoolusers,
  studentprogress,
  studentprogressquestions,
  students,
  tokens,
  rpiuseraccess,
  studentlearningprogress,
  studentlessonsprogress,
  studentlevelsprogress,
  studentgradesprogress,
  studentactives,
  studentpoints
};
export type {
  curriculumbaselineAttributes,
  curriculumbaselineCreationAttributes,
  curriculumsAttributes,
  curriculumsCreationAttributes,
  documentsAttributes,
  documentsCreationAttributes,
  gradesAttributes,
  gradesCreationAttributes,
  lessonlearningsAttributes,
  lessonlearningsCreationAttributes,
  lessonpracticequestionsAttributes,
  lessonpracticequestionsCreationAttributes,
  lessonpracticesAttributes,
  lessonpracticesCreationAttributes,
  lessonquizquestionsAttributes,
  lessonquizquestionsCreationAttributes,
  lessonquizzesAttributes,
  lessonquizzesCreationAttributes,
  lessonsAttributes,
  lessonsCreationAttributes,
  levelquizquestionsAttributes,
  levelquizquestionsCreationAttributes,
  levelsAttributes,
  levelsCreationAttributes,
  questionsAttributes,
  questionsCreationAttributes,
  schoolusersAttributes,
  schoolusersCreationAttributes,
  studentprogressAttributes,
  studentprogressCreationAttributes,
  studentprogressquestionsAttributes,
  studentprogressquestionsCreationAttributes,
  studentsAttributes,
  studentsCreationAttributes,
  tokensAttributes,
  tokensCreationAttributes,
  rpiuseraccessAttributes,
  rpiuseraccessCreationAttributes,
};

export function initModels(sequelize: Sequelize) {
  curriculumbaseline.initModel(sequelize);
  curriculums.initModel(sequelize);
  documents.initModel(sequelize);
  grades.initModel(sequelize);
  lessonlearnings.initModel(sequelize);
  lessonpracticequestions.initModel(sequelize);
  lessonpractices.initModel(sequelize);
  lessonquizquestions.initModel(sequelize);
  lessonquizzes.initModel(sequelize);
  lessons.initModel(sequelize);
  levelquizquestions.initModel(sequelize);
  levels.initModel(sequelize);
  questions.initModel(sequelize);
  schoolusers.initModel(sequelize);
  studentprogress.initModel(sequelize);
  studentprogressquestions.initModel(sequelize);
  students.initModel(sequelize);
  tokens.initModel(sequelize);
  rpiuseraccess.initModel(sequelize);
  studentlearningprogress.initModel(sequelize);
  studentlessonsprogress.initModel(sequelize);
  studentlevelsprogress.initModel(sequelize);
  studentgradesprogress.initModel(sequelize);
  studentactives.initModel(sequelize);
  studentpoints.initModel(sequelize);
  studentappusages.initModel(sequelize);
  standards.initModel(sequelize);
  schools.initModel(sequelize);
  countries.initModel(sequelize);
  studenttrash.initModel(sequelize);
  baselinequestion.initModel(sequelize);
  lessonplans.initModel(sequelize);
  subjects.initModel(sequelize);

  grades.belongsTo(curriculums, {
    as: "curriculum",
    foreignKey: "curriculumid",
  });

  curriculums.hasMany(grades, { as: "grades", foreignKey: "curriculumid" });
  students.belongsTo(curriculums, {
    as: "curriculum",
    foreignKey: "curriculumid",
  });
  curriculums.hasMany(students, { as: "students", foreignKey: "curriculumid" });
  levels.belongsTo(grades, { as: "grade", foreignKey: "gradeid" });
  grades.hasMany(levels, { as: "levels", foreignKey: "gradeid" });
  students.belongsTo(grades, { as: "grade", foreignKey: "gradeid" });
  grades.hasMany(students, { as: "students", foreignKey: "gradeid" });
  lessonpracticequestions.belongsTo(lessonpractices, {
    as: "lessonpractice",
    foreignKey: "lessonpracticeid",
  });
  lessonpractices.hasMany(lessonpracticequestions, {
    as: "lessonpracticequestions",
    foreignKey: "lessonpracticeid",
  });
  lessonquizquestions.belongsTo(lessonquizzes, {
    as: "lessonquiz",
    foreignKey: "lessonquizid",
  });
  lessonquizzes.hasMany(lessonquizquestions, {
    as: "lessonquizquestions",
    foreignKey: "lessonquizid",
  });
  lessonlearnings.belongsTo(lessons, { as: "lesson", foreignKey: "lessonid" });
  lessons.hasMany(lessonlearnings, {
    as: "lessonlearnings",
    foreignKey: "lessonid",
  });
  lessonpractices.belongsTo(lessons, { as: "lesson", foreignKey: "lessonid" });
  lessons.hasMany(lessonpractices, {
    as: "lessonpractices",
    foreignKey: "lessonid",
  });
  lessonquizzes.belongsTo(lessons, { as: "lesson", foreignKey: "lessonid" });
  lessons.hasMany(lessonquizzes, {
    as: "lessonquizzes",
    foreignKey: "lessonid",
  });
  students.belongsTo(lessons, {
    as: "studentcurrentlesson",
    foreignKey: "studentcurrentlessonid",
  });
  lessons.hasMany(students, {
    as: "students",
    foreignKey: "studentcurrentlessonid",
  });
  lessons.belongsTo(levels, { as: "level", foreignKey: "levelid" });
  levels.hasMany(lessons, { as: "lessons", foreignKey: "levelid" });
  levelquizquestions.belongsTo(levels, { as: "level", foreignKey: "levelid" });
  levels.hasMany(levelquizquestions, {
    as: "levelquizquestions",
    foreignKey: "levelid",
  });
  students.belongsTo(levels, {
    as: "startinglevel",
    foreignKey: "startinglevelid",
  });
  levels.hasMany(students, { as: "students", foreignKey: "startinglevelid" });
  students.belongsTo(levels, {
    as: "studentcurrentlevel",
    foreignKey: "studentcurrentlevelid",
  });
  levels.hasMany(students, {
    as: "studentcurrentlevel_students",
    foreignKey: "studentcurrentlevelid",
  });
  lessonpracticequestions.belongsTo(questions, {
    as: "question",
    foreignKey: "questionid",
  });
  questions.hasMany(lessonpracticequestions, {
    as: "lessonpracticequestions",
    foreignKey: "questionid",
  });
  lessonquizquestions.belongsTo(questions, {
    as: "question",
    foreignKey: "questionid",
  });
  questions.hasMany(lessonquizquestions, {
    as: "lessonquizquestions",
    foreignKey: "questionid",
  });
  levelquizquestions.belongsTo(questions, {
    as: "question",
    foreignKey: "questionid",
  });
  questions.hasMany(levelquizquestions, {
    as: "levelquizquestions",
    foreignKey: "questionid",
  });
  students.belongsTo(schoolusers, {
    as: "schooluser",
    foreignKey: "schooluserid",
  });
  schoolusers.hasMany(students, { as: "students", foreignKey: "schooluserid" });
  studentprogressquestions.belongsTo(studentprogress, {
    as: "studentprogress",
    foreignKey: "studentprogressid",
  });
  studentprogress.hasMany(studentprogressquestions, {
    as: "studentprogressquestions",
    foreignKey: "studentprogressid",
  });

  // studentlearningprogress.belongsTo(students, {
  //   as: "student",
  //   foreignKey: "studentid",
  // });
  // students.hasMany(studentlearningprogress, { as: "studentlearningprogress", foreignKey: "studentid" });
  // studentlearningprogress.belongsTo(lessonlearnings, {
  //   as: "lessonlearning",
  //   foreignKey: "lessonlearningid",
  //   foreignKeyConstraint: true,
  //   onDelete: 'NO ACTION', onUpdate: 'NO ACTION'
  // });
  // lessonlearnings.hasMany(studentlearningprogress, { as: "studentlearningprogress", foreignKey: "lessonlearningid" });

  return {
    curriculumbaseline: curriculumbaseline,
    curriculums: curriculums,
    documents: documents,
    grades: grades,
    lessonlearnings: lessonlearnings,
    lessonpracticequestions: lessonpracticequestions,
    lessonpractices: lessonpractices,
    lessonquizquestions: lessonquizquestions,
    lessonquizzes: lessonquizzes,
    lessons: lessons,
    levelquizquestions: levelquizquestions,
    levels: levels,
    questions: questions,
    schoolusers: schoolusers,
    studentprogress: studentprogress,
    studentprogressquestions: studentprogressquestions,
    students: students,
    tokens: tokens,
    rpiuseraccess: rpiuseraccess,
    studentlearningprogress,
    studentgradesprogress,
    studentlevelsprogress,
    studentlessonsprogress,
    studentactives,
    studentpoints
  };
}

export function setuprelationshipforreport(sequelize: Sequelize) {
  schoolusers.hasMany(rpiuseraccess, {
    foreignKey: "userid",
    sourceKey: "schooluserid",
  });
  rpiuseraccess.belongsTo(schoolusers, {
      foreignKey: "userid",
  });
  schoolusers.hasMany(studentappusages, {
    foreignKey: "schooluserid",
    sourceKey: "schooluserid",
  });
  studentappusages.belongsTo(schoolusers, {
    foreignKey: "schooluserid",
  });
  standards.hasOne(students, {
    foreignKey: "standard",
    as: 'student',
    sourceKey: "standardid",
  });
  students.belongsTo(standards, {
    as: 'class',
    foreignKey: "standard",
  });
  lessonquizzes.hasMany(studentprogress, {
    foreignKey: "studentprogressreferenceid",
    sourceKey: "lessonquizid",
  });
  studentprogress.belongsTo(lessonquizzes, {
      foreignKey: "studentprogressreferenceid",
  });
  students.hasMany(studentprogress, {
      foreignKey: "studentid",
      sourceKey: "studentid",
  });
  studentprogress.belongsTo(students, {
      foreignKey: "studentid",
  });
  schoolusers.hasMany(rpiuseraccess, {
    foreignKey: "userid",
    sourceKey: "schooluserid",
  });
  rpiuseraccess.belongsTo(schoolusers, {
      foreignKey: "userid",
  });
  schools.hasMany(students, {
    foreignKey: "schoolname",
  });
  students.belongsTo(schools, {
    foreignKey: "schoolname",
    targetKey: "schoolname"
  });
  schools.belongsTo(countries, {
    as: "countries",
    foreignKey: "countryid",
  });
  countries.hasMany(schools, { as: "schools", foreignKey: "countryid" });
  students.hasMany(studentlessonsprogress, {
    foreignKey: "studentid",
    sourceKey: "studentid",
  });
  studentlessonsprogress.belongsTo(students, {
      foreignKey: "studentid",
  });
  students.hasMany(studentlevelsprogress, {
    foreignKey: "studentid",
    sourceKey: "studentid",
  });
  studentlevelsprogress.belongsTo(students, {
      foreignKey: "studentid",
  });
  lessons.hasMany(studentlessonsprogress, {
    foreignKey: "lessonid",
    sourceKey: "lessonid",
  });
  studentlessonsprogress.belongsTo(lessons, {
    foreignKey: "lessonid",
  });
}
