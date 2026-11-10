import { QueryTypes, Transaction } from "sequelize";
import { sqlName } from "src/db/foreign-keys";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { dbinstance } from "src/services/dbservice";

/**
 * Removing a learner who has never signed in and has no progress, so that the username is free again.
 *
 * Central asks this server first. The account must be a learner of a school of the organisation central
 * names; anything else answers as absent and changes nothing. Any row that shows the account was used
 * (a sign-in, an app session, a result, points, a point of progress in any of the progress tables) is a
 * refusal and nothing is deleted.
 *
 * The check is made twice: once without locks, and again inside the transaction that deletes, after the
 * login row has been locked. A sign-in writes its access row (a child of the login row) before it issues a
 * token, so it either lands before the second check (which then refuses) or waits for the lock and then
 * fails because the login is gone.
 */

export type RemoveUnusedResult =
  | { removed: true }
  | { removed: false; absent: true }
  | { removed: false; reason: "activity" };

/**
 * Every table that can hold a row for the account, and the column that names it. `owner` says whether the
 * column holds the login's id (`schooluserid`) or a learner row's id (`studentid`). The nullable `userid`
 * copies on some progress tables are not read: `studentid` is the key and is never empty. Answers on
 * `studentprogressquestions` hang off `studentprogress`, so a progress row is checked instead of them.
 */
export const ACTIVITY_SOURCES: ReadonlyArray<{ table: string; column: string; owner: "login" | "learner" }> = [
  { table: "rpiuseraccess", column: "userid", owner: "login" },
  { table: "studentappusages", column: "schooluserid", owner: "login" },
  { table: "accesslog", column: "schooluserid", owner: "login" },
  { table: "studentprogress", column: "studentid", owner: "learner" },
  { table: "studentlearningsprogress", column: "studentid", owner: "learner" },
  { table: "studentpracticesprogress", column: "studentid", owner: "learner" },
  { table: "studentquizzesprogress", column: "studentid", owner: "learner" },
  { table: "studentgradesprogress", column: "studentid", owner: "learner" },
  { table: "studentlevelsprogress", column: "studentid", owner: "learner" },
  { table: "studentlessonsprogress", column: "studentid", owner: "learner" },
  { table: "studentpoints", column: "studentid", owner: "learner" },
  { table: "studentactives", column: "studentid", owner: "learner" },
  { table: "studenttrash", column: "studentid", owner: "learner" },
];

type Row = Record<string, unknown>;

const select = (tnx: Transaction | undefined, sql: string, replacements: Record<string, unknown>): Promise<Row[]> =>
  dbinstance.getdbinstance().query(sql, { replacements, type: QueryTypes.SELECT, transaction: tnx }) as Promise<Row[]>;

const run = (tnx: Transaction, sql: string, replacements: Record<string, unknown>): Promise<unknown> =>
  dbinstance.getdbinstance().query(sql, { replacements, transaction: tnx });

export class RemoveUnusedLearnerBusiness {
  /**
   * @param schooluserid the login to remove
   * @param schoolids    every school of the organisation central is acting for
   */
  async remove(schooluserid: string, schoolids: string[]): Promise<RemoveUnusedResult> {
    if (typeof schooluserid !== "string" || schooluserid.length === 0 || schooluserid.length > 36 || schoolids.length === 0) {
      return { removed: false, absent: true };
    }
    const first = await this.look(schooluserid, schoolids, undefined);
    if (!first.found) {
      return { removed: false, absent: true };
    }
    if (await this.hasActivity(schooluserid, first.studentids, undefined)) {
      return { removed: false, reason: "activity" };
    }

    const tnx = await dbinstance.getdbinstance().transaction();
    try {
      // The login row is locked first, then looked at again: what was true a moment ago is not relied on.
      const again = await this.look(schooluserid, schoolids, tnx);
      if (!again.found) {
        await tnx.rollback();
        return { removed: false, absent: true };
      }
      if (await this.hasActivity(schooluserid, again.studentids, tnx)) {
        await tnx.rollback();
        return { removed: false, reason: "activity" };
      }
      await run(tnx, "DELETE FROM tokens WHERE lmsuserid = :id", { id: schooluserid });
      await run(tnx, "DELETE FROM students WHERE schooluserid = :id", { id: schooluserid });
      await run(tnx, "DELETE FROM schoolusers WHERE schooluserid = :id", { id: schooluserid });
      await tnx.commit();
      return { removed: true };
    } catch (e) {
      try {
        await tnx.rollback();
      } catch {
        // already finished; the first failure is the one to report
      }
      throw e;
    }
  }

  /**
   * Is this a learner login of one of the organisation's schools, and which learner rows does it own?
   * Inside a transaction the login row (and its learner rows) are locked. A learner row that sits in a
   * school outside the organisation makes the whole account "not here": it is not this organisation's to remove.
   */
  private async look(
    schooluserid: string,
    schoolids: string[],
    tnx: Transaction | undefined
  ): Promise<{ found: false } | { found: true; studentids: string[] }> {
    const lock = tnx ? " FOR UPDATE" : "";
    const logins = await select(
      tnx,
      `SELECT schooluserid FROM schoolusers WHERE schooluserid = :id AND schooluserrole = :role AND schoolid IN (:schoolids)${lock}`,
      { id: schooluserid, role: SchoolRole.STUDENT, schoolids }
    );
    if (logins.length === 0) {
      return { found: false };
    }
    const learners = await select(tnx, `SELECT studentid, schoolid FROM students WHERE schooluserid = :id${lock}`, { id: schooluserid });
    const mine = new Set(schoolids.map((s) => s.toLowerCase()));
    const elsewhere = learners.some((l) => l.schoolid !== null && l.schoolid !== undefined && !mine.has(String(l.schoolid).toLowerCase()));
    if (elsewhere) {
      return { found: false };
    }
    return { found: true, studentids: learners.map((l) => String(l.studentid)) };
  }

  /** Is there any row, in any table of ACTIVITY_SOURCES, for the login or for any of its learner rows? */
  private async hasActivity(schooluserid: string, studentids: string[], tnx: Transaction | undefined): Promise<boolean> {
    // A table this database does not have cannot hold a row: some of these are legacy tables that a database
    // built from the migrations does not have, and one that does have them is still checked.
    const present = await this.tablesPresent(tnx);
    for (const source of ACTIVITY_SOURCES) {
      if (!present.has(source.table.toLowerCase())) {
        continue;
      }
      const ids = source.owner === "login" ? [schooluserid] : studentids;
      if (ids.length === 0) {
        continue;
      }
      const rows = await select(tnx, `SELECT 1 AS found FROM \`${sqlName(source.table)}\` WHERE \`${sqlName(source.column)}\` IN (:ids) LIMIT 1`, { ids });
      if (rows.length > 0) {
        return true;
      }
    }
    return false;
  }

  private async tablesPresent(tnx: Transaction | undefined): Promise<Set<string>> {
    const names = [...new Set(ACTIVITY_SOURCES.map((x) => x.table))];
    const rows = await select(tnx, "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (:names)", { names });
    return new Set(rows.map((r) => String(r.name ?? r.TABLE_NAME).toLowerCase()));
  }
}
