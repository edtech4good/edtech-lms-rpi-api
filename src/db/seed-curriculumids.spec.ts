/**
 * The learner routes of the student API filter on students.curriculumids (plural), and Sync Students copies a
 * student row as it is, so a seeded learner whose curriculumids is NULL gets a 404 on every lesson route. The student API's own seed:dcrs sets it on insert; a row seeded before that stays NULL under INSERT IGNORE, so the seed repairs it.
 * Script-level: the SQL is read from the seed file; the seeds themselves are proven against a database in the
 * fix round's report.
 */
import * as fs from "fs";
import * as path from "path";

const seedSql = (file: string): string => fs.readFileSync(path.join(__dirname, "..", "..", "scripts", file), "utf8");

const studentInserts = (sql: string): Array<{ columns: string[]; values: string[] }> =>
  [...sql.matchAll(/INSERT IGNORE INTO students \(([^)]*)\)\s*VALUES \(([^)]*)\)/g)].map((m) => ({
    columns: m[1].split(",").map((c) => c.trim()),
    values: m[2].split(",").map((v) => v.trim()),
  }));

describe("scripts/seed-dcrs-content.js and the learners' curriculumids", () => {
  const sql = seedSql("seed-dcrs-content.js");

  it("inserts both learners with curriculumids set, one value for every column", () => {
    const inserts = studentInserts(sql);
    expect(inserts).toHaveLength(2);
    for (const { columns, values } of inserts) {
      expect(columns).toContain("curriculumids");
      expect(values).toHaveLength(columns.length);
    }
    expect(sql).toContain("const CURRICULUM_IDS = JSON.stringify([ID.curriculum]);");
    expect(sql.match(/ID\.curriculum, CURRICULUM_IDS, ID\./g)).toHaveLength(2);
  });

  it("repairs a learner seeded without it: only NULLs, only this seed's two learners, after the inserts", () => {
    const update = /UPDATE students SET curriculumids = JSON_ARRAY\(curriculumid\) WHERE studentid IN \(\?,\?\) AND curriculumids IS NULL`,\s*\[ID\.student, ID\.facilitator\]\)/.exec(sql);
    expect(update).not.toBeNull();
    expect(update!.index).toBeGreaterThan(sql.lastIndexOf("INSERT IGNORE INTO students"));
    expect(sql.match(/UPDATE students/g)).toHaveLength(1);
  });
});
