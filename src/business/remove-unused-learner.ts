import { QueryTypes, Transaction } from "sequelize";
import { sqlName } from "src/db/foreign-keys";
import { SchoolRole } from "src/models/enums/school.role.enum";
import { dbinstance } from "src/services/dbservice";

/**
 * Removing a learner who has never signed in and has no progress, so that the username is free again.
 *
 * Central asks this server first. The account must be a learner of a school of the organisation central
 * names. No row with the id at all answers as absent; a row that exists but is outside that scope (another
 * organisation's, not a learner) answers "elsewhere"; both change nothing. Any row that shows the account was used
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
  | { removed: false; reason: "activity" | "elsewhere" };

/**
 * Every table that can hold a row for the account, and the column that names it. `owner` says whether the
 * column holds the login's id (`schooluserid`) or a learner row's id (`studentid`). The nullable `userid`
 * copies on some progress tables are not read: `studentid` is the key and is never empty. Answers on
 * `studentprogressquestions` hang off `studentprogress`, so a progress row is checked instead of them.
 */
export const ACTIVITY_SOURCES: ReadonlyArray<{ table: string; column: string; owner: "login" | "learner" }> = [
  { table: "tokens", column: "lmsuserid", owner: "login" },
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
  { table: "studentawards", column: "studentid", owner: "learner" },
  { table: "studentcertificates", column: "studentid", owner: "learner" },
  { table: "studentpoints", column: "studentid", owner: "learner" },
  { table: "studentactives", column: "studentid", owner: "learner" },
  { table: "studenttrash", column: "studentid", owner: "learner" },
];

/**
 * Tables named above that no model registers, no migration creates and nothing writes: a database built
 * from the migrations does not have them, and one that does is still checked. Any OTHER table that is missing
 * is an error, so a misspelt name fails the route (nothing is removed) instead of being skipped.
 */
export const LEGACY_TABLES: ReadonlySet<string> = new Set(["accesslog", "studentpracticesprogress", "studentquizzesprogress"]);

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
    if (typeof schooluserid !== "string" || schooluserid.length === 0 || schooluserid.length > 36) {
      return { removed: false, absent: true };
    }
    const first = await this.look(schooluserid, schoolids, undefined);
    if (first.state === "absent") {
      return { removed: false, absent: true };
    }
    if (first.state === "elsewhere") {
      return { removed: false, reason: "elsewhere" };
    }
    if (await this.hasActivity(schooluserid, first.studentids, undefined)) {
      return { removed: false, reason: "activity" };
    }

    const tnx = await dbinstance.getdbinstance().transaction();
    try {
      // The login row is locked first, then looked at again: what was true a moment ago is not relied on.
      const again = await this.look(schooluserid, schoolids, tnx);
      if (again.state !== "here") {
        await tnx.rollback();
        return again.state === "absent" ? { removed: false, absent: true } : { removed: false, reason: "elsewhere" };
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
   * Where does this id stand? "absent": no login row and no learner row carries it. "elsewhere": a row exists but
   * is not a learner login of one of the organisation's schools (another organisation's, not a learner, or a learner
   * row in a school outside the organisation). "here": a learner login of the organisation, with the learner rows it owns.
   * Inside a transaction the rows are locked.
   */
  private async look(
    schooluserid: string,
    schoolids: string[],
    tnx: Transaction | undefined
  ): Promise<{ state: "absent" } | { state: "elsewhere" } | { state: "here"; studentids: string[] }> {
    const lock = tnx ? " FOR UPDATE" : "";
    const logins = await select(tnx, `SELECT schooluserid, schooluserrole, schoolid FROM schoolusers WHERE schooluserid = :id${lock}`, { id: schooluserid });
    const learners = await select(tnx, `SELECT studentid, schoolid FROM students WHERE schooluserid = :id${lock}`, { id: schooluserid });
    if (logins.length === 0 && learners.length === 0) {
      return { state: "absent" };
    }
    const mine = new Set(schoolids.map((s) => s.toLowerCase()));
    const inMine = (schoolid: unknown): boolean => mine.has(String(schoolid).toLowerCase());
    const isMine = logins.length > 0 && logins.every((l) => Number(l.schooluserrole) === SchoolRole.STUDENT && inMine(l.schoolid));
    const learnerElsewhere = learners.some((l) => l.schoolid !== null && l.schoolid !== undefined && !inMine(l.schoolid));
    if (!isMine || learnerElsewhere) {
      return { state: "elsewhere" };
    }
    return { state: "here", studentids: learners.map((l) => String(l.studentid)) };
  }

  /** Is there any row, in any table of ACTIVITY_SOURCES, for the login or for any of its learner rows? */
  private async hasActivity(schooluserid: string, studentids: string[], tnx: Transaction | undefined): Promise<boolean> {
    // Only a legacy table may be missing (it cannot hold a row); any other missing table is an error, so the
    // route fails closed and nothing is removed.
    const present = await this.tablesPresent(tnx);
    for (const source of ACTIVITY_SOURCES) {
      if (!present.has(source.table.toLowerCase())) {
        if (LEGACY_TABLES.has(source.table)) {
          continue;
        }
        throw new Error(`The table ${source.table} that shows use of an account is missing.`);
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
