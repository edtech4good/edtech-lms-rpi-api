import { cast, col, fn, Op, Transaction, where as sqlWhere } from "sequelize";
import { countries } from "src/models/data-models/countries";
import {
  curriculumbaseline,
  grades,
  lessonlearnings,
  lessonlearningdocuments,
  lessonpracticequestions,
  lessonpractices,
  lessonquizquestions,
  lessonquizzes,
  lessons,
  levelquizquestions,
  levels,
  schoolusers,
  students,
} from "src/models/data-models/init-models";
import { standards } from "src/models/data-models/standards";
import { baselinequestion } from "src/models/data-models/baselinequestion";
import { lessonplans } from "src/models/data-models/lessonplan";
import { Logger } from "src/config";
import { ApiError } from "src/models/ApiError";
import { findSchoolIdByName } from "./school-identity";

export class SyncBusiness {
  private _transaction: Transaction;
  constructor(transaction: Transaction) {
    this._transaction = transaction;
  }
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
        "lessonlearningtype",
        "lessonlearningbody",
      ],
    });

  lessonlearningdocuments = (newlinks: Array<lessonlearningdocuments>) =>
    lessonlearningdocuments.bulkCreate(newlinks, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "lessonlearningid",
        "documentid",
        "lessonlearningdocumentrole",
        "lessonlearningdocumentorder",
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
  countries = (newCountries: Array<countries>) =>
    countries.bulkCreate(newCountries, {
      transaction: this._transaction,
      updateOnDuplicate: [
        "countryname",
        "expectedusage",
        "isdeleted",
      ],
    });

  /**
   * A repair step for rows stored BEFORE `schoolid` became required (S4): a learner or
   * school login imported ahead of its school was written without a `schoolid`. Now that
   * the schools are here, every such row whose `schoolid` is still empty gets the id of
   * the school its `schoolname` names, once per distinct name, by the same text rule every
   * reader uses. A name that matches no school, or more than one, is left empty (counted,
   * not named). Since S4 no row can be empty (a roster is refused until its school is
   * here), so on a migrated database this finds nothing.
   */
  linkRosterToSchools = async () => {
    for (const [table, model] of [["students", students], ["schoolusers", schoolusers]] as const) {
      // BINARY: the exact stored text, not what the column collation calls equal.
      const rows = (await (model as typeof students).findAll({
        attributes: [[fn("DISTINCT", cast(col("schoolname"), "BINARY")), "schoolname"]],
        where: { schoolid: null, schoolname: { [Op.ne]: null } } as never,
        raw: true,
        transaction: this._transaction,
      })) as unknown as Array<{ schoolname: Buffer | string }>;
      let filled = 0;
      let skippedAmbiguous = 0;
      let skippedUnmatched = 0;
      for (const row of rows) {
        const name = Buffer.isBuffer(row.schoolname) ? row.schoolname.toString("utf8") : String(row.schoolname);
        let schoolid: string | null;
        try {
          schoolid = await findSchoolIdByName(name, { strict: true, transaction: this._transaction });
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          skippedAmbiguous += 1;
          continue;
        }
        if (!schoolid) {
          skippedUnmatched += 1;
          continue;
        }
        const [affected] = await (model as typeof students).update(
          { schoolid },
          { where: { [Op.and]: [{ schoolid: null }, sqlWhere(cast(col("schoolname"), "BINARY"), name)] } as never, transaction: this._transaction },
        );
        filled += affected;
      }
      if (rows.length > 0) {
        Logger.info(`master import: ${table} with no school id: ${filled} filled, ${skippedAmbiguous} names skipped (not unique), ${skippedUnmatched} names skipped (no school of that name)`);
      }
    }
  };
}
