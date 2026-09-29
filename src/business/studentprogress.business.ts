import { Transaction } from "sequelize";
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

export interface exportpayload {
  studentusers: schoolusersAttributes[];
  studentprogresses: studentpointsprogress;
}

export interface studentpointsprogress {
  studentprogress: studentprogressAttributes[];
  studentlearningprogress: studentlearningprogressAttributes[];
  studentgradesprogress: studentgradesprogressAttributes[];
  studentlevelsprogress: studentlevelsprogressAttributes[];
  studentlessonsprogress: studentlessonsprogressAttributes[];
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
    transaction: Transaction
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
