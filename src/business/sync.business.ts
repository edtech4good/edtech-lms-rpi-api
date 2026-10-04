import { subMonths } from "date-fns";
import { groupBy } from "lodash";
import { cast, col, fn, Op, Transaction, where as sqlWhere } from "sequelize";
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
  schoolusers,
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
import { Logger } from "src/config";
import { ApiError } from "src/models/ApiError";
import { findSchoolIdByName, isSameSchoolName, normaliseSchoolName } from "./school-identity";

/** The tables whose rows have an owning organisation and are wiped and re-created by a master import. */
const OWNED_BY_ORGANISATION = [
  { model: schools, pk: "schoolid" },
  { model: questions, pk: "questionid" },
  { model: documents, pk: "documentid" },
  { model: subjects, pk: "subjectid" },
] as const;

const OWNER_CHUNK = 1000;

export class SyncBusiness {
  private _transaction: Transaction;
  // What `cleanup()` saw before it wiped the tables: each owned row's organisation
  // (by table, then row id), and each school's id and name.
  private _owners: Array<Map<string, string>> = [];
  private _schoolsBefore: Array<{ schoolid: string; schoolname: string }> = [];
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
        "questionfeedback",
        "templatetypeid",
        "isdeleted",
        "questionstatus",
        "questionidentifier",
        "questiontags",
        "questioncorrectvalue",
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

  /**
   * Called once, before `cleanup()` wipes the tables: remembers which organisation
   * owned each school, question, document and subject, and each school's id and
   * name, so `restoreOwnership()` can put them back. Without this a master import
   * (which deletes and re-creates those rows) would leave every one of them with
   * no owner.
   */
  private rememberOwnership = async () => {
    this._owners = [];
    for (const { model, pk } of OWNED_BY_ORGANISATION) {
      const rows = (await (model as typeof schools).scope("withOwnership").findAll({
        attributes: [pk, "organisationid"],
        where: { organisationid: { [Op.ne]: null } },
        transaction: this._transaction,
        raw: true,
      })) as unknown as Array<Record<string, string>>;
      this._owners.push(new Map(rows.map((r) => [r[pk], r.organisationid])));
    }
    const before = await schools.findAll({
      attributes: ["schoolid", "schoolname"],
      transaction: this._transaction,
      raw: true,
    });
    this._schoolsBefore = before.map((r) => ({ schoolid: r.schoolid, schoolname: r.schoolname }));
  };

  /**
   * Called once, after the content tables are re-created from the payload.
   *
   *  1. An owner a row had before the import is put back on the row with the same
   *     id, unless the payload itself gave the row an owner. (Content ids are
   *     central's, so they are the same across imports.)
   *  2. A school the payload carries under a DIFFERENT id than this server had for
   *     it (matched by name) takes over the learners and school logins of the old
   *     id, so `students.schoolid` and `schoolusers.schoolid` still name a school
   *     that exists, and its owner (unless the payload gave it one). A school whose
   *     id did not change needs nothing: the learners keep pointing at it.
   *  3. Learners and logins still without a school id (imported before their school
   *     reached this server) get it from their school name.
   */
  restoreOwnership = async () => {
    for (let i = 0; i < OWNED_BY_ORGANISATION.length; i += 1) {
      const { model, pk } = OWNED_BY_ORGANISATION[i];
      const byOwner = new Map<string, string[]>();
      for (const [id, organisationid] of this._owners[i] ?? []) {
        byOwner.set(organisationid, [...(byOwner.get(organisationid) ?? []), id]);
      }
      for (const [organisationid, ids] of byOwner) {
        for (let start = 0; start < ids.length; start += OWNER_CHUNK) {
          await (model as typeof schools).update(
            { organisationid },
            {
              where: { [pk]: { [Op.in]: ids.slice(start, start + OWNER_CHUNK) }, organisationid: null },
              transaction: this._transaction,
            },
          );
        }
      }
    }
    await this.repointRenamedSchools();
    await this.linkRosterToSchools();
  };

  /**
   * A school the payload carries under a different id than this server had for it
   * takes over the learners, school logins and owner of the old id. The match is
   * by normalised name and only when the name is unambiguous on BOTH sides: two
   * old schools with one name, an old school that is gone whose name a school still
   * here also has, or two new schools with the name, are all left alone.
   */
  private repointRenamedSchools = async () => {
    const current = await schools.findAll({ attributes: ["schoolid", "schoolname"], transaction: this._transaction });
    const currentIds = new Set(current.map((c) => c.schoolid));
    const count = (names: string[]) => {
      const counts = new Map<string, number>();
      for (const name of names) counts.set(normaliseSchoolName(name), (counts.get(normaliseSchoolName(name)) ?? 0) + 1);
      return counts;
    };
    const oldCounts = count(this._schoolsBefore.map((b) => b.schoolname));
    const newCounts = count(current.map((c) => c.schoolname));
    let moved = 0;
    let skippedAmbiguous = 0;
    let skippedUnmatched = 0;
    for (const before of this._schoolsBefore) {
      if (currentIds.has(before.schoolid)) {
        continue;
      }
      const key = normaliseSchoolName(before.schoolname);
      if ((oldCounts.get(key) ?? 0) > 1 || (newCounts.get(key) ?? 0) > 1) {
        skippedAmbiguous += 1;
        continue;
      }
      const match = current.find((c) => isSameSchoolName(c.schoolname, before.schoolname));
      if (!match) {
        skippedUnmatched += 1;
        continue;
      }
      for (const model of [students, schoolusers]) {
        await (model as typeof students).update(
          { schoolid: match.schoolid },
          { where: { schoolid: before.schoolid }, transaction: this._transaction },
        );
      }
      const owner = this._owners[0]?.get(before.schoolid);
      if (owner) {
        await schools.update(
          { organisationid: owner },
          { where: { schoolid: match.schoolid, organisationid: null }, transaction: this._transaction },
        );
      }
      moved += 1;
    }
    if (moved + skippedAmbiguous + skippedUnmatched > 0) {
      Logger.info(`master import: schools under a new id: ${moved} moved, ${skippedAmbiguous} skipped (name not unique), ${skippedUnmatched} skipped (no school of that name)`);
    }
  };

  /**
   * Learners and school logins are imported before their school exists on a new
   * classroom server (rosters come from one sync, schools from this one), so they
   * were written without a `schoolid`. Now that the schools are here, every row
   * whose `schoolid` is still empty gets the id of the school its `schoolname`
   * names, once per distinct name, by the same text rule every reader uses. A name
   * that matches no school, or more than one, is left empty (counted, not named).
   */
  private linkRosterToSchools = async () => {
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
          { where: { [Op.and]: [{ schoolid: null }, sqlWhere(cast(col("schoolname"), "BINARY"), name)] }, transaction: this._transaction },
        );
        filled += affected;
      }
      if (rows.length > 0) {
        Logger.info(`master import: ${table} with no school id: ${filled} filled, ${skippedAmbiguous} names skipped (not unique), ${skippedUnmatched} names skipped (no school of that name)`);
      }
    }
  };

  cleanup = async () => {
    await this.rememberOwnership();
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
      // The raw learner `answer` never leaves this API for central or the
      // reporting pipeline (privacy: free-text answers can contain PII).
      attributes: { exclude: ["answer"] },
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
