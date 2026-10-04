import { Op, WhereOptions } from "sequelize";
import { Config } from "src/config";
import { schools } from "src/models/data-models/school";
import { schoolusers } from "src/models/data-models/schoolusers";
import { students } from "src/models/data-models/students";
import { learnersInScope, ReportScope } from "./report-scope";

/**
 * Whose rows a data export (`GET export/report-data`, `GET export/log`) may carry, and who may take the server's
 * own log files.
 *
 * An export covers the caller's scope (see report-scope.ts): the server sync key with an organisation's id gets that
 * organisation's schools, the key with `platform` gets the whole server, a staff token gets its own school. A school
 * login or a learner is in the scope when its school is; every other row an export carries (progress, results,
 * sign-ins, usage) belongs to one of those learners or logins and is kept only for them.
 */
export interface ExportKeys {
  /** The learners of the scope. */
  studentids: string[];
  /** The school logins of the scope: the logins of its schools, and the logins of its learners. */
  schooluserids: string[];
}

/** The keys a scoped export filters its rows by; `null` for the unscoped platform view. */
export async function exportKeysOf(scope: ReportScope | null | undefined): Promise<ExportKeys | null> {
  if (!scope) {
    return null;
  }
  const learners = (await students.findAll({
    attributes: ["studentid", "schooluserid"],
    where: learnersInScope(scope),
    raw: true,
  })) as unknown as Array<{ studentid: string; schooluserid: string | null }>;
  const logins = (await schoolusers.findAll({
    attributes: ["schooluserid"],
    where: { schoolid: { [Op.in]: scope.schoolids } },
    raw: true,
  })) as unknown as Array<{ schooluserid: string }>;
  const schooluserids = new Set<string>(logins.map((l) => l.schooluserid));
  for (const learner of learners) {
    if (learner.schooluserid) {
      schooluserids.add(learner.schooluserid);
    }
  }
  return {
    studentids: learners.map((l) => l.studentid),
    schooluserids: [...schooluserids],
  };
}

/** The extra condition on a table keyed by `studentid` (nothing for the platform view). */
export const byStudent = (keys: ExportKeys | null): WhereOptions => (keys ? { studentid: { [Op.in]: keys.studentids } } : {});

/** The extra condition on a table keyed by a login (`column`; nothing for the platform view). */
export const byLogin = (keys: ExportKeys | null, column: string): WhereOptions => (keys ? { [column]: { [Op.in]: keys.schooluserids } } : {});

/**
 * May the caller take the server's own log files (the API's error and info logs, which hold the ids and addresses of
 * every user the server has seen)? Only the platform view, and a classroom Pi on which the caller's scope covers EVERY
 * school that is not deleted: a Pi is one school's own machine, but roster imports are one school per call, so a Pi can
 * hold several, and then one school's staff must not take what the others' users left in the logs. An organisation's
 * caller online never takes them.
 */
export async function mayTakeServerLogs(scope: ReportScope | null): Promise<boolean> {
  if (scope === null) {
    return true;
  }
  if (!Config.fortyk.api.rpi.offline) {
    return false;
  }
  const live = (await schools.findAll({ attributes: ["schoolid"], where: { isdeleted: false }, raw: true })) as unknown as Array<{ schoolid: string }>;
  const mine = new Set(scope.schoolids.map((id) => id.toLowerCase()));
  return live.every((school) => mine.has(String(school.schoolid).toLowerCase()));
}

/** The stored name of a scope's school, for a download's file name ("" when there is none or more than one). */
export async function storedSchoolNameOf(scope: ReportScope | null): Promise<string> {
  if (!scope || scope.schoolids.length !== 1) {
    return "";
  }
  const school = await schools.findOne({ attributes: ["schoolname"], where: { schoolid: scope.schoolids[0] } });
  return school?.schoolname ?? "";
}
