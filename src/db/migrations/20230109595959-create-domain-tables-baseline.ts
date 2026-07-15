import { QueryInterface, DataTypes } from "sequelize";
import { columnCollation, tableNameList, tableOptionsMatchingCurriculums } from "../migration-helpers";

/** INFORMATION_SCHEMA collation names only — interpolated into raw SQL. */
function assertMysqlCollation(coll: string): string {
  if (!/^utf8(mb4|mb3)_[a-zA-Z0-9_]+$/.test(coll)) {
    throw new Error(`Unexpected collation from INFORMATION_SCHEMA: ${coll}`);
  }
  return coll;
}

async function createStudentsTableRaw(
  queryInterface: QueryInterface,
  charset: { charset: string; collate: string },
): Promise<void> {
  const fb = assertMysqlCollation(charset.collate);
  const v36fk = (col: string | null) =>
    `VARCHAR(36) CHARACTER SET utf8mb4 COLLATE ${assertMysqlCollation(col ?? fb)}`;

  const [
    collCurriculumid,
    collGradeid,
    collLevelid,
    collLessonid,
    collSchooluserid,
  ] = await Promise.all([
    columnCollation(queryInterface, "curriculums", "curriculumid"),
    columnCollation(queryInterface, "grades", "gradeid"),
    columnCollation(queryInterface, "levels", "levelid"),
    columnCollation(queryInterface, "lessons", "lessonid"),
    columnCollation(queryInterface, "schoolusers", "schooluserid"),
  ]);

  const sql = `
CREATE TABLE \`students\` (
  \`studentid\` VARCHAR(36) NOT NULL,
  \`studentfirstname\` VARCHAR(45) NOT NULL,
  \`studentlastname\` VARCHAR(45) NULL,
  \`mothername\` VARCHAR(255) NULL,
  \`fathername\` VARCHAR(255) NULL,
  \`contact\` VARCHAR(20) NULL,
  \`dateofbirth\` DATETIME NULL,
  \`genderid\` INT NOT NULL,
  \`standard\` VARCHAR(250) NULL,
  \`schooltype\` VARCHAR(250) NULL,
  \`schoolname\` VARCHAR(250) NULL,
  \`city\` VARCHAR(250) NOT NULL,
  \`country\` VARCHAR(250) NOT NULL,
  \`state\` VARCHAR(250) NOT NULL,
  \`dateofjoin\` DATETIME NULL,
  \`curriculumid\` ${v36fk(collCurriculumid)} NOT NULL,
  \`curriculumids\` JSON NULL,
  \`gradeid\` ${v36fk(collGradeid)} NULL,
  \`startinglevelid\` ${v36fk(collLevelid)} NULL,
  \`studentcurrentlevelid\` ${v36fk(collLevelid)} NULL,
  \`studentcurrentlessonid\` ${v36fk(collLessonid)} NULL,
  \`isactive\` TINYINT(1) NOT NULL DEFAULT 0,
  \`schooluserid\` ${v36fk(collSchooluserid)} NOT NULL,
  PRIMARY KEY (\`studentid\`),
  FOREIGN KEY (\`curriculumid\`) REFERENCES \`curriculums\` (\`curriculumid\`),
  FOREIGN KEY (\`gradeid\`) REFERENCES \`grades\` (\`gradeid\`),
  FOREIGN KEY (\`startinglevelid\`) REFERENCES \`levels\` (\`levelid\`),
  FOREIGN KEY (\`studentcurrentlevelid\`) REFERENCES \`levels\` (\`levelid\`),
  FOREIGN KEY (\`studentcurrentlessonid\`) REFERENCES \`lessons\` (\`lessonid\`),
  FOREIGN KEY (\`schooluserid\`) REFERENCES \`schoolusers\` (\`schooluserid\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${fb};
`;

  if (charset.charset !== "utf8mb4") {
    throw new Error(`createStudentsTableRaw: expected utf8mb4 table charset, got ${charset.charset}`);
  }

  await queryInterface.sequelize.query(sql);
}

/**
 * Core LMS tables missing from RPI migration history (mirrors edtech-lms-api).
 * Runs after `20230109073048-login-logout-time-fields` and before grade/level migrations.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const names = await tableNameList(queryInterface);
    const charset = await tableOptionsMatchingCurriculums(queryInterface);

    if (!names.includes("grades")) {
      await queryInterface.createTable(
        "grades",
        {
          gradeid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          curriculumid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "curriculums", key: "curriculumid" },
          },
          gradestatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          gradename: { type: DataTypes.STRING(250), allowNull: false },
          gradedescription: { type: DataTypes.TEXT, allowNull: true },
          gradeorder: { type: DataTypes.INTEGER, allowNull: false },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        charset,
      );
    }

    if (!names.includes("levels")) {
      await queryInterface.createTable(
        "levels",
        {
          levelid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          gradeid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "grades", key: "gradeid" },
          },
          levelname: { type: DataTypes.STRING(250), allowNull: false },
          leveldescription: { type: DataTypes.TEXT, allowNull: true },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          levelstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          levelorder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        },
        charset,
      );
    }

    if (!names.includes("lessons")) {
      await queryInterface.createTable(
        "lessons",
        {
          lessonid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          levelid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "levels", key: "levelid" },
          },
          lessonname: { type: DataTypes.STRING(250), allowNull: false },
          lessondescription: { type: DataTypes.TEXT, allowNull: true },
          practicecount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          quizcount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          lessonpasspercentage: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 80 },
          lessonorder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          lessonstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          total_points: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
          brick_points: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: null },
        },
        charset,
      );
    }

    if (!names.includes("documents")) {
      await queryInterface.createTable(
        "documents",
        {
          documentid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          documenttypeid: { type: DataTypes.INTEGER, allowNull: false },
          documentname: { type: DataTypes.TEXT, allowNull: false },
          documents3meta: { type: DataTypes.JSON, allowNull: true },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          documenttags: { type: DataTypes.JSON, allowNull: true },
          lastupdated: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
          },
        },
        charset,
      );
    }

    if (!names.includes("documenttags")) {
      await queryInterface.createTable(
        "documenttags",
        {
          documenttagid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          documenttagname: { type: DataTypes.STRING(45), allowNull: false },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        charset,
      );
    }

    if (!names.includes("lessonlearnings")) {
      await queryInterface.createTable(
        "lessonlearnings",
        {
          lessonlearningid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          lessonlearningname: { type: DataTypes.STRING(250), allowNull: false },
          lessonlearningdescription: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
          lessonlearningstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          lessonid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "lessons", key: "lessonid" },
          },
          documentid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "documents", key: "documentid" },
          },
          lessonlearningorder: { type: DataTypes.INTEGER, allowNull: false },
          points: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, defaultValue: 0 },
        },
        charset,
      );
    }

    if (!names.includes("lessonpractices")) {
      await queryInterface.createTable(
        "lessonpractices",
        {
          lessonpracticeid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          lessonid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "lessons", key: "lessonid" },
          },
          lessonpracticeorder: { type: DataTypes.INTEGER, allowNull: false },
          lessonpracticestatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          lessonpracticename: { type: DataTypes.STRING(250), allowNull: false },
          lessonpracticedescription: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
        },
        charset,
      );
    }

    if (!names.includes("lessonquizzes")) {
      await queryInterface.createTable(
        "lessonquizzes",
        {
          lessonquizid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          lessonid: {
            type: DataTypes.STRING(36),
            allowNull: false,
            references: { model: "lessons", key: "lessonid" },
          },
          lessonquizorder: { type: DataTypes.INTEGER, allowNull: false },
          lessonquizname: { type: DataTypes.STRING(250), allowNull: false },
          lessonquizstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          lessonquizdescription: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
        },
        charset,
      );
    }

    if (!names.includes("questions")) {
      await queryInterface.createTable(
        "questions",
        {
          questionid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          questionheading: { type: DataTypes.JSON, allowNull: true },
          questionoptions: { type: DataTypes.JSON, allowNull: true },
          questiontext: { type: DataTypes.TEXT, allowNull: true },
          questiondistractors: { type: DataTypes.JSON, allowNull: true },
          questionfile: { type: DataTypes.JSON, allowNull: true },
          templatetypeid: { type: DataTypes.INTEGER, allowNull: false },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          questionstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          questionidentifier: { type: DataTypes.STRING(100), allowNull: false },
          questiontags: { type: DataTypes.JSON, allowNull: true },
          lastupdated: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: queryInterface.sequelize.Sequelize.fn("NOW"),
          },
        },
        charset,
      );
    }

    if (!names.includes("questiontags")) {
      await queryInterface.createTable(
        "questiontags",
        {
          questiontagid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          questiontagname: { type: DataTypes.STRING(45), allowNull: false },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        charset,
      );
    }

    if (!names.includes("schoolusers")) {
      await queryInterface.createTable(
        "schoolusers",
        {
          schooluserid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          schoolusername: { type: DataTypes.STRING(45), allowNull: false, unique: true },
          schooluserpasswordhash: { type: DataTypes.TEXT, allowNull: false },
          schooluserrole: { type: DataTypes.INTEGER, allowNull: false },
          schooluserstatus: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          schoolname: { type: DataTypes.STRING(250), allowNull: true },
          isdisabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        charset,
      );
    }

    if (!names.includes("standards")) {
      await queryInterface.createTable(
        "standards",
        {
          standardid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          standardname: { type: DataTypes.STRING(45), allowNull: false },
          schoolname: { type: DataTypes.STRING(255), allowNull: true },
          schoolid: {
            type: DataTypes.STRING(36),
            allowNull: true,
            references: { model: "schools", key: "schoolid" },
          },
          isdeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        charset,
      );
    }

    if (!names.includes("students")) {
      await createStudentsTableRaw(queryInterface, charset);
    }

    if (!names.includes("lmsusers")) {
      await queryInterface.createTable(
        "lmsusers",
        {
          lmsuserid: { type: DataTypes.STRING(36), allowNull: false, primaryKey: true },
          lmsusername: { type: DataTypes.STRING(45), allowNull: false },
          lmsuserpasswordhash: { type: DataTypes.TEXT, allowNull: false },
          firstname: { type: DataTypes.STRING(45), allowNull: false },
          lastname: { type: DataTypes.STRING(45), allowNull: true },
          lmsuserrole: { type: DataTypes.STRING(20), allowNull: false },
          isverified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
          verifykey: { type: DataTypes.STRING(500), allowNull: true },
          isdisabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
          passwordchangekey: { type: DataTypes.STRING(500), allowNull: true },
          countries: { type: DataTypes.JSON, allowNull: true },
          schools: { type: DataTypes.JSON, allowNull: true },
        },
        charset,
      );
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const order = [
      "lmsusers",
      "students",
      "standards",
      "schoolusers",
      "questiontags",
      "questions",
      "lessonquizzes",
      "lessonpractices",
      "lessonlearnings",
      "documenttags",
      "documents",
      "lessons",
      "levels",
      "grades",
    ];
    for (const t of order) {
      await queryInterface.dropTable(t);
    }
  },
};
