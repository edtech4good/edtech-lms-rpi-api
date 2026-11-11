import { Transaction } from "sequelize";
import { randomUUID } from "node:crypto";
import { studentawards, studentawardsAttributes } from "src/models/data-models/studentawards";
import { Logger } from "src/config";
import { awardCompletedLevels } from "./level-award";
import { schoolusersAttributes } from "src/models/data-models/schoolusers";
import {
  studentgradesprogress,
  studentgradesprogressAttributes,
} from "src/models/data-models/studentgradesprogress";
import {
  studentlearningprogress,
  studentlearningprogressAttributes,
} from "src/models/data-models/studentlearningprogress";
import { studentlessonsprogress, studentlessonsprogressAttributes } from "src/models/data-models/studentlessonsprogress";
import {
  studentlevelsprogress,
  studentlevelsprogressAttributes,
} from "src/models/data-models/studentlevelsprogress";
import {
  studentprogress,
  studentprogressAttributes,
} from "src/models/data-models/studentprogress";

/** A date a stored award may carry: a Date, or text that parses to one. Missing, empty, null and anything else is not. */
const hasUsableDate = (value: unknown): boolean => {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(new Date(value).getTime());
};

/** A flag as a payload may carry it (true, 1, "1", "true"); anything else, missing included, is false. */
const isTrue = (value: unknown): boolean => value === true || value === 1 || value === "1" || value === "true";

export interface exportpayload {
  // Set on a roster that names the school it is for (format 3): every row must be that school's.
  schoolid?: string;
  studentusers: schoolusersAttributes[];
  studentprogresses: studentpointsprogress;
}

export interface studentpointsprogress {
  studentprogress: studentprogressAttributes[];
  studentlearningprogress: studentlearningprogressAttributes[];
  studentgradesprogress: studentgradesprogressAttributes[];
  studentlevelsprogress: studentlevelsprogressAttributes[];
  studentlessonsprogress: studentlessonsprogressAttributes[];
  /** Optional: central sends it once it exports awards; a payload without it changes nothing. */
  studentawards?: studentawardsAttributes[];
}

export class StudentProgressBusiness {
  importStudentProgress = async (
    stps: studentprogressAttributes[],
    transaction: Transaction
  ) => {
    // `verified` must never come from an import. Central has no server
    // grading of its own yet (that's step 2, separate from this work) and
    // this route accepts payloads assembled elsewhere (central, another Pi),
    // so it cannot be trusted to have left `verified` out — and
    // bulkCreate(stps, ...) with no `fields` list inserts *every* attribute
    // present on each object, `verified` included, exactly as given. Leaving
    // this to "the column default" (as an earlier version of this comment
    // claimed) is only true when the field is truly absent; forcing it here
    // is the only way to guarantee an imported row can never arrive
    // pre-verified. It's left out of updateOnDuplicate too, so a re-import
    // can't flip an already-imported row's `verified` either.
    const stpsuntrusted = stps.map((stp) => ({ ...stp, verified: false }));
    await studentprogress.bulkCreate(stpsuntrusted, {
      transaction,
      updateOnDuplicate: [
        "studentid",
        "ispass",
        "studentprogressreferenceid",
        "starttime",
        "endtime",
        "progresstype",
        "marks",
        "points",
        "resultpercentage",
        "fullpoints",
      ],
    });
  };

  importStudentLearningProgress = async (
    stlnp: studentlearningprogressAttributes[],
    transaction: Transaction
  ) => {
    await studentlearningprogress.bulkCreate(stlnp, {
      transaction,
      updateOnDuplicate: [
        "studentid",
        "content_length",
        "lastupdated",
        "lessonlearningid",
        "points",
        "progress",
        "progress_percentage",
        "userid",
        "viewed",
      ],
    });
  };

  importStudentGradesProgress = async (
    stgp: studentgradesprogressAttributes[],
    transaction: Transaction
  ) => {
    await studentgradesprogress.bulkCreate(stgp, {
      transaction,
      updateOnDuplicate: [
        "studentid",
        "completed",
        "curriculumid",
        "gradeid",
        "lastupdated",
        "points",
        "progress",
      ],
    });
  };

  importStudentLevelsProgress = async (
    stlp: studentlevelsprogressAttributes[],
    transaction: Transaction,
    awards?: studentawardsAttributes[]
  ) => {
    await studentlevelsprogress.bulkCreate(stlp, {
      transaction,
      updateOnDuplicate: [
        "studentid",
        "completed",
        "curid",
        "gradeid",
        "lastupdated",
        "levelid",
        "points",
        "progress",
      ],
    });
    // The awards the payload carries come first: an award this server already has for a learner and level wins over
    // an imported one (the unique key ignores it), and an imported one wins over the approximate one made below.
    if (Array.isArray(awards) && awards.length > 0) {
      await this.importStudentAwards(awards, transaction);
    }
    // Levels that arrive complete and have no award get an approximate one (the same rule as the backfill), for the
    // imported learners only.
    const studentids = [...new Set(stlp.filter((r) => r.completed).map((r) => r.studentid))];
    await awardCompletedLevels(studentids, transaction);
  };

  /**
   * Stores the awards a roster carries. An award this server already has for a learner and level wins (the unique key
   * ignores the imported one). A row with no usable `earnedat` (missing, empty or not a date) is not stored, so the
   * approximate award the import makes afterwards can cover that pair; only the number of such rows is logged.
   * `earnedat_approximate` is read as a boolean (missing means false).
   */
  importStudentAwards = async (awards: studentawardsAttributes[], transaction: Transaction) => {
    const usable = awards.filter((a) => hasUsableDate(a?.earnedat));
    const skipped = awards.length - usable.length;
    if (skipped > 0) {
      Logger.info(`import students: ${skipped} award row(s) skipped (no valid earnedat)`);
    }
    if (usable.length === 0) {
      return;
    }
    await studentawards.bulkCreate(
      usable.map((a) => ({
        studentawardid: a.studentawardid ?? randomUUID(),
        studentid: a.studentid,
        levelid: a.levelid,
        gradeid: a.gradeid,
        curid: a.curid,
        earnedat: a.earnedat,
        earnedat_approximate: isTrue(a.earnedat_approximate),
      })),
      { transaction, ignoreDuplicates: true }
    );
  };

  importStudentLessonsProgress = async (
    stlsp: studentlessonsprogressAttributes[],
    transaction: Transaction
  ) => {
    await studentlessonsprogress.bulkCreate(stlsp, {
      transaction,
      updateOnDuplicate: [
        "studentid",
        "completed",
        "curid",
        "gradeid",
        "lastupdated",
        "levelid",
        "points",
        "progress",
        "lessonid",
      ],
    });
  };
}
