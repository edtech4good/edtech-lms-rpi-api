import { QueryInterface, Transaction } from "sequelize";
import { columnCollation, tableNameList, tableOptionsMatchingCurriculums } from "../migration-helpers";

/**
 * Baseline for the four tables that, until now, only the server's boot-time
 * `sequelize.sync()` created: `studentprogressquestions`, `lessonpracticequestions`,
 * `lessonquizquestions` and `tokens`. No earlier migration creates them, yet later
 * migrations read them (`20260818090000` joins `studentprogressquestions`, the
 * recompute migrations read the other two). So on an EMPTY database `db:migrate`
 * stopped at `20260818090000` with "Table '...studentprogressquestions' doesn't
 * exist", and the documented way round was migrate, boot the server once, migrate
 * again. This migration is stamped just before that one, so a new database runs
 * straight through.
 *
 * (`organisations` is the fifth table `sync()` creates; it already has its own
 * migration, `20261004120000-create-organisations`, which also copes with `sync()`
 * having got there first. It is deliberately not repeated here.)
 *
 * ## What it creates
 *
 * The tables as `sync()` builds them from the models today: the same columns, types,
 * NULL-ness, defaults, primary keys, foreign keys (anonymous, so MySQL names them
 * `<table>_ibfk_N`, in the models' order) and indexes. That includes the three
 * server-grading columns of `studentprogressquestions` that `20260929100000` adds
 * on a database that predates them; that migration skips a column that is already
 * there. `down()` of that migration still removes them.
 *
 * ## Collation
 *
 * MySQL refuses a foreign key between columns of different collations, and the
 * tables and the models do not always agree (this is the "foreign-key collation
 * error" a first boot hits on a server whose default collation is not the one the
 * migrations built the parent tables with). So each foreign-key column takes the
 * collation of the REAL column it points at, read from the database, and a table's
 * default charset/collation is its first parent's. `tokens` has no parent and
 * takes `curriculums.curriculumid`'s, as the other baselines do.
 *
 * ## Idempotence: a database that already has the tables
 *
 * Every existing server (and every database the old workaround produced) has these
 * tables, built by `sync()`. For each one that exists, `up()` does nothing at all:
 * it is not altered, converted or compared, only recorded in SequelizeMeta. A table
 * is created only when it is absent, and with `CREATE TABLE IF NOT EXISTS`, so a
 * re-run or a race with a booting server cannot fail on it.
 *
 * ## down()
 *
 * `down()` cannot know whether it was this migration or `sync()` that created a
 * table, and these tables hold learners' results, so it never deletes data: it drops
 * a table only when it is EMPTY (nothing is lost, and a boot-time `sync()` or the
 * next `up()` rebuilds it identically) and leaves a table that has rows. Dropping
 * empty ones is what lets `db:migrate:undo:all` on a new database get back past the
 * parent tables' own `down()` (which cannot drop a parent a child still references).
 * Each is handled only if present.
 */

/** INFORMATION_SCHEMA collation names only; they are interpolated into raw SQL. */
function assertMysqlCollation(coll: string): string {
  if (!/^utf8(mb4|mb3)_[a-zA-Z0-9_]+$/.test(coll)) {
    throw new Error(`Unexpected collation from INFORMATION_SCHEMA: ${coll}`);
  }
  return coll;
}

type TableOptions = { charset: string; collate: string };

/**
 * A VARCHAR column that carries the collation of the column it references. When that is the
 * table's own default it is left out, so the column is declared exactly as `sync()` declares it
 * (and `SHOW CREATE TABLE` prints it the same way); only a parent that differs from the table
 * default names its charset and collation.
 */
const colType = (length: number, collate: string, opts: TableOptions): string => {
  const coll = assertMysqlCollation(collate);
  return coll === opts.collate ? `VARCHAR(${length})` : `VARCHAR(${length}) CHARACTER SET ${coll.split("_")[0]} COLLATE ${coll}`;
};

interface Baseline {
  name: string;
  /** [table, column] this table's table options (default charset/collation) follow; null: curriculums.curriculumid. */
  optionsFrom: [string, string] | null;
  /** [table, column] of every referenced column, read for its collation, in foreign-key order. */
  parents: Array<[string, string]>;
  ddl: (fk: string[], opts: TableOptions) => string;
}

const tail = (opts: TableOptions): string =>
  `ENGINE=InnoDB DEFAULT CHARSET=${opts.charset} COLLATE=${assertMysqlCollation(opts.collate)}`;

/** None of these references another, so the order is free; down() takes it in reverse. */
const BASELINES: Baseline[] = [
  {
    name: "studentprogressquestions",
    optionsFrom: ["studentprogress", "studentprogressid"],
    parents: [["studentprogress", "studentprogressid"]],
    ddl: ([fkProgress], opts) => `
CREATE TABLE IF NOT EXISTS \`studentprogressquestions\` (
  \`studentprogressid\` ${colType(36, fkProgress, opts)} NOT NULL,
  \`studentprogressquestionid\` VARCHAR(36) NOT NULL,
  \`tries\` INT NULL DEFAULT 0,
  \`iscorrect\` TINYINT(1) NOT NULL DEFAULT 0,
  \`referencequestionid\` VARCHAR(36) NOT NULL,
  \`answer\` JSON NULL DEFAULT NULL,
  \`clientiscorrect\` TINYINT(1) NULL DEFAULT NULL,
  \`servergrade\` ENUM('correct','incorrect','ungradable') NULL DEFAULT NULL,
  PRIMARY KEY (\`studentprogressquestionid\`),
  FOREIGN KEY (\`studentprogressid\`) REFERENCES \`studentprogress\` (\`studentprogressid\`) ON UPDATE CASCADE
) ${tail(opts)}`,
  },
  {
    name: "lessonpracticequestions",
    optionsFrom: ["lessonpractices", "lessonpracticeid"],
    parents: [
      ["lessonpractices", "lessonpracticeid"],
      ["questions", "questionid"],
    ],
    ddl: ([fkPractice, fkQuestion], opts) => `
CREATE TABLE IF NOT EXISTS \`lessonpracticequestions\` (
  \`lessonpracticequestionid\` VARCHAR(36) NOT NULL,
  \`lessonpracticeid\` ${colType(36, fkPractice, opts)} NOT NULL,
  \`lessonpracticequestionstatus\` TINYINT(1) NOT NULL DEFAULT 1,
  \`questionid\` ${colType(36, fkQuestion, opts)} NOT NULL,
  \`lessonpracticequestionorder\` INT NOT NULL,
  PRIMARY KEY (\`lessonpracticequestionid\`),
  FOREIGN KEY (\`lessonpracticeid\`) REFERENCES \`lessonpractices\` (\`lessonpracticeid\`) ON UPDATE CASCADE,
  FOREIGN KEY (\`questionid\`) REFERENCES \`questions\` (\`questionid\`) ON UPDATE CASCADE
) ${tail(opts)}`,
  },
  {
    name: "lessonquizquestions",
    optionsFrom: ["lessonquizzes", "lessonquizid"],
    parents: [
      ["lessonquizzes", "lessonquizid"],
      ["questions", "questionid"],
    ],
    ddl: ([fkQuiz, fkQuestion], opts) => `
CREATE TABLE IF NOT EXISTS \`lessonquizquestions\` (
  \`lessonquizquestionid\` VARCHAR(36) NOT NULL,
  \`lessonquizid\` ${colType(36, fkQuiz, opts)} NOT NULL,
  \`questionid\` ${colType(36, fkQuestion, opts)} NOT NULL,
  \`lessonquizquestionstatus\` TINYINT(1) NOT NULL DEFAULT 1,
  \`lessonquizquestionorder\` INT NOT NULL,
  PRIMARY KEY (\`lessonquizquestionid\`),
  FOREIGN KEY (\`lessonquizid\`) REFERENCES \`lessonquizzes\` (\`lessonquizid\`) ON UPDATE CASCADE,
  FOREIGN KEY (\`questionid\`) REFERENCES \`questions\` (\`questionid\`) ON UPDATE CASCADE
) ${tail(opts)}`,
  },
  {
    name: "tokens",
    optionsFrom: null,
    parents: [],
    ddl: (_fk, opts) => `
CREATE TABLE IF NOT EXISTS \`tokens\` (
  \`token\` VARCHAR(500) NOT NULL,
  \`lmsuserid\` VARCHAR(36) NOT NULL,
  \`tokentype\` VARCHAR(8) NOT NULL,
  PRIMARY KEY (\`token\`)
) ${tail(opts)}`,
  },
];

async function optionsFor(queryInterface: QueryInterface, b: Baseline): Promise<TableOptions> {
  if (!b.optionsFrom) {
    return tableOptionsMatchingCurriculums(queryInterface);
  }
  const [table, column] = b.optionsFrom;
  const [rows] = await queryInterface.sequelize.query(
    `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    { replacements: [table, column] },
  );
  const r = (rows as { cs?: string; coll?: string }[])[0];
  if (r?.cs && r?.coll) {
    if (!/^utf8(mb4|mb3)$/.test(r.cs)) {
      throw new Error(`Unexpected charset from INFORMATION_SCHEMA: ${r.cs}`);
    }
    return { charset: r.cs, collate: r.coll };
  }
  return tableOptionsMatchingCurriculums(queryInterface);
}

module.exports = {
  up: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const present = new Set(await tableNameList(queryInterface));
      for (const b of BASELINES) {
        if (present.has(b.name)) {
          continue;
        }
        const opts = await optionsFor(queryInterface, b);
        const fallback = opts.collate;
        const fk: string[] = [];
        for (const [table, column] of b.parents) {
          fk.push((await columnCollation(queryInterface, table, column)) ?? fallback);
        }
        await queryInterface.sequelize.query(b.ddl(fk, opts), { transaction });
        present.add(b.name);
      }
    }),

  down: (queryInterface: QueryInterface): Promise<void> =>
    queryInterface.sequelize.transaction(async (transaction: Transaction) => {
      const present = new Set(await tableNameList(queryInterface));
      for (const b of [...BASELINES].reverse()) {
        if (!present.has(b.name)) {
          continue;
        }
        const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*) AS n FROM \`${b.name}\``, { transaction });
        const n = Number((rows as Array<{ n: number | string }>)[0]?.n ?? 0);
        if (n === 0) {
          await queryInterface.dropTable(b.name, { transaction });
        }
      }
    }),
};
