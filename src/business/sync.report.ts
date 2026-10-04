import { subMonths } from "date-fns";
import { groupBy } from "lodash";
import { Op } from "sequelize";
import {
  rpiuseraccess,
  studentactives,
  studentgradesprogress,
  studentlearningprogress,
  studentlessonsprogress,
  studentlevelsprogress,
  studentpoints,
  studentprogress,
  studentprogressquestions,
} from "src/models/data-models/init-models";
import { studentappusages } from "src/models/data-models/studentappusage";
import { byLogin, byStudent, exportKeysOf, ExportKeys } from "./export-scope";
import { ReportScope } from "./report-scope";
import { SchoolUserBusiness } from "./schooluser.business";

export class SyncReport {
  /**
   * The payload of `GET export/report-data`. `scope` is whose rows it may carry (see export-scope.ts): `null` is the
   * whole server (the platform view), anything else only the learners and logins of its schools.
   */
  getreportdata = async (scope: ReportScope | null) => {
    const keys = await exportKeysOf(scope);
    const studentusers =
      await new SchoolUserBusiness().getschoolusers(keys);
    const getstudentdata = await this.getstudentdata(scope, keys);
    const data = {
      students: studentusers ? studentusers.map((x) => x.get({ plain: true })) : [],
      studentprogress: getstudentdata.progress,
      studentresult: getstudentdata.result,
      studentaccess: getstudentdata.access
    };
    return JSON.stringify(data);
  };

  /** The six months of progress, results, sign-ins and usage; `keys` (from `scope`) keeps them to the scope's learners and logins. */
  getstudentdata = async (scope: ReportScope | null, keys: ExportKeys | null = null) => {
    keys = keys ?? (await exportKeysOf(scope));
    const limitdate = subMonths(new Date(), 6);
    const sp = (
      await studentprogress.findAll({
        where: {
          starttime: { [Op.gt]: limitdate },
          ...byStudent(keys),
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
        ...byLogin(keys, "userid"),
      },
    });
    const stactives = (
      await studentactives.findAll({
        where: {
          created_at: { [Op.gt]: limitdate },
          ...byStudent(keys),
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stlp = (
      await studentlearningprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
          ...byStudent(keys),
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stgp = (
      await studentgradesprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
          ...byStudent(keys),
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stlvp = (
      await studentlevelsprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
          ...byStudent(keys),
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stlsp = (
      await studentlessonsprogress.findAll({
        where: {
          lastupdated: { [Op.gt]: limitdate },
          ...byStudent(keys),
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stpoints = (
      await studentpoints.findAll({
        where: {
          created_at: { [Op.gt]: limitdate },
          ...byStudent(keys),
        },
      })
    ).map((x) => ({
      ...x.get({ plain: true }),
    }));
    const stpusages = (
      await studentappusages.findAll({
        where: {
          created_at: { [Op.gt]: limitdate },
          ...byLogin(keys, "schooluserid"),
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
