import { Sequelize } from "sequelize";
import { curriculums, documents, initModels, questions, schoolusers, students } from "src/models/data-models/init-models";
import { schools } from "src/models/data-models/school";
import { subjects } from "src/models/data-models/subjects";
import {
  assertNoViolations,
  CONTENT_COLUMNS,
  SCHOOL_COLUMNS,
  describeViolations,
  findViolations,
  LISTED_IDS,
  relaxColumns,
  REQUIRED_COLUMNS,
  requireColumns,
} from "./required-columns";
import { makeRequiredColumnsQI } from "src/test-support/required-columns-qi";

/**
 * The shared core of S4: which columns become required, what the guard
 * refuses and says, and what the tightening asks MySQL for. The migration is
 * driven in its own spec; the real runs against MySQL are described in the
 * change description.
 */
describe("the list of required columns", () => {
  it("is exactly the seven columns S4 tightens, each with its table's primary key", () => {
    expect(SCHOOL_COLUMNS.map((c) => `${c.table}.${c.column}:${c.pk}`)).toEqual([
      "schools.organisationid:schoolid",
      "students.schoolid:studentid",
      "schoolusers.schoolid:schooluserid",
    ]);
    expect(CONTENT_COLUMNS.map((c) => `${c.table}.${c.column}:${c.pk}`)).toEqual([
      "curriculums.organisationid:curriculumid",
      "questions.organisationid:questionid",
      "documents.organisationid:documentid",
      "subjects.organisationid:subjectid",
    ]);
    expect(REQUIRED_COLUMNS).toHaveLength(7);
  });

  it("is what the models say: allowNull false on all seven", () => {
    initModels(new Sequelize({ dialect: "mysql" }));
    const byTable = { schools, students, schoolusers, curriculums, questions, documents, subjects } as unknown as Record<
      string,
      { rawAttributes: Record<string, { allowNull?: boolean }> }
    >;
    for (const c of REQUIRED_COLUMNS) {
      expect({ column: `${c.table}.${c.column}`, allowNull: byTable[c.table].rawAttributes[c.column]?.allowNull }).toEqual({
        column: `${c.table}.${c.column}`,
        allowNull: false,
      });
    }
  });
});

describe("findViolations", () => {
  it("counts the NULL rows of each column (all of them) and lists their primary keys in key order, nothing else", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, {
      "schools.organisationid": { nulls: ["s2", "s1"] },
      "students.schoolid": { nulls: [] },
      "schoolusers.schoolid": { nulls: ["u1"] },
    });
    const found = await findViolations(fake.sequelize as never, SCHOOL_COLUMNS);
    expect(found.map((v) => ({ column: `${v.table}.${v.column}`, count: v.count, ids: v.ids }))).toEqual([
      { column: "schools.organisationid", count: 2, ids: ["s1", "s2"] },
      { column: "students.schoolid", count: 0, ids: [] },
      { column: "schoolusers.schoolid", count: 1, ids: ["u1"] },
    ]);
    expect(fake.writes()).toEqual([]);
  });

  it("caps the listed ids but never the count", async () => {
    const many = Array.from({ length: LISTED_IDS + 7 }, (_, i) => `id-${String(i).padStart(3, "0")}`);
    const fake = makeRequiredColumnsQI(CONTENT_COLUMNS, { "questions.organisationid": { nulls: many } });
    const [curriculums, questions] = await findViolations(fake.sequelize as never, CONTENT_COLUMNS);
    expect(curriculums.count).toBe(0);
    expect(questions.count).toBe(LISTED_IDS + 7);
    expect(questions.ids).toEqual(many.slice(0, LISTED_IDS));
    const message = describeViolations("S4", [questions]);
    expect(message).toContain(`first ${LISTED_IDS} of ${LISTED_IDS + 7}`);
  });

  it("refuses an identifier that is not a plain name before it reaches SQL", async () => {
    const fake = makeRequiredColumnsQI([]);
    await expect(
      findViolations(fake.sequelize as never, [{ table: "schools`; DROP TABLE x; --", column: "organisationid", pk: "schoolid" }]),
    ).rejects.toThrow(/Unexpected identifier/);
    expect(fake.statements).toEqual([]);
  });
});

describe("assertNoViolations: the guard", () => {
  it("throws naming every offending column with its count and ids, and sends no DDL", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, {
      "schools.organisationid": { nulls: ["school-a"] },
      "students.schoolid": { nulls: ["student-a", "student-b"] },
    });
    const err = await assertNoViolations(fake.queryInterface, "S4", SCHOOL_COLUMNS, fake.TX as never).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    const lines = (err as Error).message.split("\n");
    expect(lines[0]).toBe("S4 refused: 2 required column(s) still hold rows with no value, so nothing was changed.");
    expect(lines.slice(1, 3)).toEqual([
      "schools.organisationid: 1 row(s) with no value (schoolid, all 1): school-a",
      "students.schoolid: 2 row(s) with no value (studentid, all 2): student-a, student-b",
    ]);
    expect(lines.join("\n")).not.toContain("schoolusers.schoolid");
    expect(fake.alters()).toEqual([]);
  });

  it("passes silently when every count is zero", async () => {
    const fake = makeRequiredColumnsQI(CONTENT_COLUMNS);
    await expect(assertNoViolations(fake.queryInterface, "S4", CONTENT_COLUMNS, fake.TX as never)).resolves.toBeUndefined();
  });
});

describe("requireColumns", () => {
  it("MODIFYs each nullable column to NOT NULL, keeping the type, charset and collation the database reports", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, {
      "schools.organisationid": { collation: "utf8mb4_0900_ai_ci" },
      "students.schoolid": { type: "varchar(36)" },
    });
    await requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never);
    expect(fake.alters()).toEqual([
      "ALTER TABLE `schools` MODIFY COLUMN `organisationid` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL",
      "ALTER TABLE `students` MODIFY COLUMN `schoolid` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
      "ALTER TABLE `schoolusers` MODIFY COLUMN `schoolid` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL",
    ]);
    expect(fake.writes()).toEqual([]);
  });

  it("skips a column that is already required: a second run sends no ALTER", async () => {
    const fake = makeRequiredColumnsQI(CONTENT_COLUMNS);
    await requireColumns(fake.queryInterface, CONTENT_COLUMNS, fake.TX as never);
    fake.statements.length = 0;
    await requireColumns(fake.queryInterface, CONTENT_COLUMNS, fake.TX as never);
    expect(fake.alters()).toEqual([]);
  });

  it("finishes a run that stopped halfway: only the columns still nullable are changed", async () => {
    const fake = makeRequiredColumnsQI(CONTENT_COLUMNS, {
      "curriculums.organisationid": { nullable: false },
      "questions.organisationid": { nullable: false },
    });
    await requireColumns(fake.queryInterface, CONTENT_COLUMNS, fake.TX as never);
    expect(fake.alters().map((s) => /ALTER TABLE `(\w+)`/.exec(s)![1])).toEqual(["documents", "subjects"]);
  });

  it("a row that appears after the guard makes MySQL refuse that column: nothing is forced to a value", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, { "students.schoolid": { nulls: ["late"] } });
    await expect(requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never)).rejects.toThrow("Invalid use of NULL value");
    expect(fake.cols.get("students.schoolid")!.nullable).toBe(true);
    expect(fake.writes()).toEqual([]);
  });

  it("keeps a column comment, escaped, and refuses a type or collation that is not a plain name", async () => {
    const withComment = makeRequiredColumnsQI(SCHOOL_COLUMNS.slice(0, 1), { "schools.organisationid": { comment: "it's the owner" } });
    await requireColumns(withComment.queryInterface, SCHOOL_COLUMNS.slice(0, 1), withComment.TX as never);
    expect(withComment.alters()[0]).toMatch(/NOT NULL COMMENT 'it\\'s the owner'$/);

    const badType = makeRequiredColumnsQI(SCHOOL_COLUMNS.slice(0, 1), { "schools.organisationid": { type: "varchar(36); DROP TABLE x" } });
    await expect(requireColumns(badType.queryInterface, SCHOOL_COLUMNS.slice(0, 1), badType.TX as never)).rejects.toThrow(/Unexpected type/);
    const badCollation = makeRequiredColumnsQI(SCHOOL_COLUMNS.slice(0, 1), { "schools.organisationid": { collation: "x; DROP TABLE y" } });
    await expect(requireColumns(badCollation.queryInterface, SCHOOL_COLUMNS.slice(0, 1), badCollation.TX as never)).rejects.toThrow(/Unexpected identifier/);
    expect(badType.alters().concat(badCollation.alters())).toEqual([]);
  });

  it("names the column and the remedy when it does not exist at all", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, { "students.schoolid": { missing: true } });
    await expect(requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never)).rejects.toThrow(
      "students.schoolid does not exist: run the earlier migrations first.",
    );
  });
});

describe("requireColumns pins strict mode for its own connection", () => {
  const NOT_STRICT = "ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION";
  const PIN = "SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_TRANS_TABLES')";
  const indexOf = (fake: ReturnType<typeof makeRequiredColumnsQI>, test: (s: string) => boolean) => fake.statements.findIndex(test);

  it("when the session is not strict: sends the pin before the first MODIFY, restores the original mode after the last", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, {}, NOT_STRICT);
    await requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never);
    const pin = indexOf(fake, (s) => s === PIN);
    const firstAlter = indexOf(fake, (s) => /^ALTER TABLE/.test(s));
    const restore = indexOf(fake, (s) => s === `SET SESSION sql_mode = '${NOT_STRICT}'`);
    const lastAlter = fake.statements.map((s, i) => (/^ALTER TABLE/.test(s) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(pin).toBeGreaterThanOrEqual(0);
    expect(pin).toBeLessThan(firstAlter);
    expect(restore).toBeGreaterThan(lastAlter);
    expect(fake.sqlMode()).toBe(NOT_STRICT);
  });

  it("restores the original mode even when a MODIFY fails", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, { "students.schoolid": { type: "varchar(36); DROP TABLE x" } }, NOT_STRICT);
    await expect(requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never)).rejects.toThrow(/Unexpected type/);
    expect(fake.sqlMode()).toBe(NOT_STRICT);
  });

  it("sends nothing about the mode when the session is already strict", async () => {
    for (const mode of ["STRICT_TRANS_TABLES", "ONLY_FULL_GROUP_BY,STRICT_ALL_TABLES"]) {
      const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, {}, mode);
      await requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never);
      expect(fake.statements.filter((s) => /sql_mode/.test(s) && !/^SELECT/.test(s))).toEqual([]);
    }
  });

  it("a NULL that slips in after the guard fails the MODIFY even when the session was not strict, and is never turned into a value", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, { "students.schoolid": { nulls: ["late"] } }, NOT_STRICT);
    await expect(requireColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never)).rejects.toThrow("Invalid use of NULL value");
    expect(fake.coerced).toEqual([]);
    expect(fake.cols.get("students.schoolid")!.nullable).toBe(true);
    expect(fake.sqlMode()).toBe(NOT_STRICT);
  });
});

describe("relaxColumns: the down() mirror", () => {
  it("makes each required column nullable again, in reverse order, and writes no data", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, Object.fromEntries(SCHOOL_COLUMNS.map((c) => [`${c.table}.${c.column}`, { nullable: false }])));
    await relaxColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never);
    expect(fake.alters().map((s) => /ALTER TABLE `(\w+)`/.exec(s)![1])).toEqual(["schoolusers", "students", "schools"]);
    expect(fake.alters().every((s) => /NULL DEFAULT NULL$/.test(s))).toBe(true);
    expect(fake.writes()).toEqual([]);
  });

  it("skips what is already nullable and what is already gone", async () => {
    const fake = makeRequiredColumnsQI(SCHOOL_COLUMNS, { "students.schoolid": { missing: true }, "schools.organisationid": { nullable: false } });
    await relaxColumns(fake.queryInterface, SCHOOL_COLUMNS, fake.TX as never);
    expect(fake.alters().map((s) => /ALTER TABLE `(\w+)`/.exec(s)![1])).toEqual(["schools"]);
  });
});
