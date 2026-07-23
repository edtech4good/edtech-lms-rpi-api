import { subMonths } from "date-fns";
import { groupBy } from "lodash";
import { Op, Transaction } from "sequelize";
import { countries } from "src/models/data-models/countries";
import {
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
  rpiuseraccess,
  studentactives,
  studentgradesprogress,
  studentlearningprogress,
  studentlessonsprogress,
  studentlevelsprogress,
  studentpoints,
  studentprogress,
  studentprogressquestions,
  students,
} from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { standards } from "src/models/data-models/standards";
import { studentappusages } from "src/models/data-models/studentappusage";
import { SchoolUserBusiness } from "./schooluser.business";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { lessonplans } from "src/models/data-models/lessonplan";
import { subjects } from "src/models/data-models/subjects";

export class SyncBusiness {
  private _transaction: Transaction;
  constructor(transaction: Transaction) {
    this._transaction = transaction;
  }
  curriculum = (newcurriculums: Array<curriculums>) =>
    curriculums.bulkCreate(newcurriculums, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "curriculumname",
        "curriculumstatus",
        "curriculumdescription",
        "isdeleted",
        "subjectid"
      ],
    });
  curriculumbaseline = (newcurriculumbaselines: Array<curriculumbaseline>) =>
    curriculumbaseline.bulkCreate(newcurriculumbaselines, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "baselineid",
        "curriculumid",
        "baselinename",
        "baselinetype",
        "baselinestatus",
        "startdate",
        "enddate",
        "schoolid",
        "isdeleted"
      ],
    });
    baselinequestion = (newbaselinesquestion: Array<baselinequestion>) =>
    baselinequestion.bulkCreate(newbaselinesquestion, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "curriculumbaselineid",
        "questionid",
        "baselinequestionstatus",
        "baselinequestionorder",
        "isdeleted"
      ],
    });
  grade = (newgrades: Array<grades>) =>
    grades.bulkCreate(newgrades, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "gradename",
        "gradestatus",
        "gradedescription",
        "isdeleted",
        "gradeorder",
        "curriculumid",
        "points",
      ],
    });
  level = (newlevels: Array<levels>) =>
    levels.bulkCreate(newlevels, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "gradeid",
        "levelname",
        "leveldescription",
        "isdeleted",
        "levelstatus",
        "levelorder",
        "quiz_points",
        "points",
      ],
    });
  lesson = (newlessons: Array<lessons>) =>
    lessons.bulkCreate(newlessons, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "levelid",
        "lessonname",
        "lessondescription",
        "practicecount",
        "quizcount",
        "lessonpasspercentage",
        "lessonorder",
        "lessonstatus",
        "isdeleted",
        "learning_points",
        "quizzes_points",
        "practices_points"
      ],
    });
  lessonlearnings = (newlessonlearnings: Array<lessonlearnings>) =>
    lessonlearnings.bulkCreate(newlessonlearnings, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonlearningname",
        "lessonlearningdescription",
        "lessonlearningstatus",
        "lessonid",
        "lessonlearningorder",
        "documentid",
      ],
    });

  lessonplans = (newlessonplans: Array<lessonplans>) =>
    lessonplans.bulkCreate(newlessonplans, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonplanname",
        "lessonplandescription",
        "lessonplanstatus",
        "lessonid",
        "lessonplanorder",
        "documentid",
      ],
    });

  lessonpractices = (newlessonpractices: Array<lessonpractices>) =>
    lessonpractices.bulkCreate(newlessonpractices, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonid",
        "lessonpracticeorder",
        "lessonpracticestatus",
        "lessonpracticename",
        "lessonpracticedescription",
        "points",
      ],
    });
  lessonquizzes = (newlessonquizzes: Array<lessonquizzes>) =>
    lessonquizzes.bulkCreate(newlessonquizzes, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonid",
        "lessonquizorder",
        "lessonquizname",
        "lessonquizstatus",
        "lessonquizdescription",
        "points",
      ],
    });
  lessonpracticequestions = (
    newlessonpracticequestions: Array<lessonpracticequestions>
  ) =>
    lessonpracticequestions.bulkCreate(newlessonpracticequestions, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonpracticeid",
        "lessonpracticequestionstatus",
        "questionid",
        "lessonpracticequestionorder",
      ],
    });
  lessonquizquestions = (newlessonquizquestions: Array<lessonquizquestions>) =>
    lessonquizquestions.bulkCreate(newlessonquizquestions, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonquizid",
        "questionid",
        "lessonquizquestionstatus",
        "lessonquizquestionorder",
      ],
    });
  levelquizquestions = (newlevelquizquestions: Array<levelquizquestions>) =>
    levelquizquestions.bulkCreate(newlevelquizquestions, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "levelid",
        "questionid",
        "levelquizquestionstatus",
        "levelquizquestionorder",
        "lessonid"
      ],
    });
  questions = (newquestions: Array<questions>) =>
    questions.bulkCreate(newquestions, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "questionheading",
        "questionoptions",
        "questiontext",
        "questiondistractors",
        "questionfile",
        "templatetypeid",
        "isdeleted",
        "questionstatus",
        "questionidentifier",
        "questiontags",
        "lastupdated",
      ],
    });
  documents = (newdocuments: Array<documents>) =>
    documents.bulkCreate(newdocuments, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "documenttypeid",
        "documentname",
        "documents3meta",
        "isdeleted",
        "documenttags",
        "lastupdated",
      ],
    });
  standards = (newStandards: Array<standards>) =>
    standards.bulkCreate(newStandards, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "standardname",
        "schoolid",
        "schoolname",
        "isdeleted",
      ],
    });
  schools = (newSchools: Array<schools>) =>
    schools.bulkCreate(newSchools, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "schoolname",
        "countryid",
        "curriculums",
        "expectedcontribution",
        "expectedusage",
        "isdeleted",
        "uitheme",
        "brandingconfig",
      ],
    });
  countries = (newCountries: Array<countries>) =>
    countries.bulkCreate(newCountries, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "countryname",
        "expectedusage",
        "isdeleted",
      ],
    });

  subject = (newsubjects: Array<subjects>) =>
    subjects.bulkCreate(newsubjects, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "subjectname",
        "subjectdescription",
        "subjectstatus",
        "isdeleted",
      ],
    });

  cleanup = async () => {
    await lessonquizquestions.destroy({
      where: {},
      transaction: this._transaction,
    });
    await lessonquizzes.destroy({
      where: {},
      transaction: this._transaction,
    });
    await lessonpracticequestions.destroy({
      where: {},
      transaction: this._transaction,
    });
    await lessonpractices.destroy({
      where: {},
      transaction: this._transaction,
    });
    await lessonlearnings.destroy({
      where: {},
      transaction: this._transaction,
    });
    await lessons.destroy({
      where: {},
      transaction: this._transaction,
    });
    await levelquizquestions.destroy({
      where: {},
      transaction: this._transaction,
    });
    await levels.destroy({
      where: {},
      transaction: this._transaction,
    });
    await grades.destroy({
      where: {},
      transaction: this._transaction,
    });
    await curriculumbaseline.destroy({
      where: {},
      transaction: this._transaction,
    });
    await baselinequestion.destroy({
      where: {},
      transaction: this._transaction,
    })
    /*await curriculums.destroy({
      where: {},
      transaction: this._transaction,
    });*/
    await questions.destroy({
      where: {},
      transaction: this._transaction,
    });
    await documents.destroy({
      where: {},
      transaction: this._transaction,
    });
    await standards.destroy({
      where: {},
      transaction: this._transaction,
    });
    await schools.destroy({
      where: {},
      transaction: this._transaction,
    });
    await countries.destroy({
      where: {},
      transaction: this._transaction,
    });
    await lessonplans.destroy({
      where: {},
      transaction: this._transaction,
    });
    await subjects.destroy({
      where: {},
      transaction: this._transaction,
    });
  };

  getreportdata = async () => {
    const studentusers =
      await new SchoolUserBusiness().getschoolusers();
    const getstudentdata = await this.getstudentdata();
    const data = {
      students: studentusers ? studentusers.map((x) => x.get({ plain: true })) : [],
      studentprogress: getstudentdata.progress,
      studentresult: getstudentdata.result,
      studentaccess: getstudentdata.access
    };
    return JSON.stringify(data);
  };

  getstudentdata = async () => {
    const limitdate = subMonths(new Date(), 6);
    const sp = (
      await studentprogress.findAll({
        where: {
          starttime: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const spqo = await studentprogressquestions.findAll({
      where: {
        studentprogressid: {
          [Op.in]: sp.map((x) => x.studentprogressid),
        },
      },
    });
    const spq = spqo.map((x) => x.get({ plain: true }));
    const gspq = groupBy(spq, "studentprogressid");
    const sa = await rpiuseraccess.findAll({
      where: {
        logintime: { [Op.gt]: limitdate },
      },
    });
    const stactives = (
      await studentactives.findAll({
        where: {
          created_at: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stlp = (
      await studentlearningprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
        },
        include: [
          {
            model: students,
            required: true
          }
        ]
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stgp = (
      await studentgradesprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stlvp = (
      await studentlevelsprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stlsp = (
      await studentlessonsprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stpoints = (
      await studentpoints.findAll({
        where: {
          created_at: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stpusages = (
      await studentappusages.findAll({
        where: {
          created_at: { [Op.gt]: limitdate },
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    return {
      result: sp.map((x) => ({
        ...x,
        studentprogressquestions: gspq[x.studentprogressid],
      })),
      progress: {
        studentactives: stactives,
        studentlearningprogress: stlp,
        studentgradesprogress: stgp,
        studentlevelsprogress: stlvp,
        studentlessonsprogress: stlsp,
        studentpoints: stpoints,
        studentappusages: stpusages,
      },
      access: sa.map((x) => x.get({ plain: true })),
    };
  };
}
