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
    studentprogress.bulkCreate(stps, {
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
