import { RequiredColumn } from "src/db/required-columns";

/**
 * A QueryInterface stand-in for the S4 specs: a database that holds, per
 * required column, whether it is nullable and which primary keys hold a NULL.
 * It answers the statements `src/db/required-columns.ts` sends, records every
 * statement, and applies a `MODIFY COLUMN ... NOT NULL` the way MySQL does
 * (refusing it while a NULL is there). It writes no data.
 */
export interface FakeColumnState {
  nullable?: boolean;
  /** Primary keys of the rows holding NULL. */
  nulls?: string[];
  type?: string;
  charset?: string | null;
  collation?: string | null;
  comment?: string;
  /** The column is not there at all. */
  missing?: boolean;
}

export const makeRequiredColumnsQI = (
  columns: readonly RequiredColumn[],
  state: Record<string, FakeColumnState> = {},
  sessionSqlMode = "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION",
) => {
  let mode = sessionSqlMode;
  /** Columns where a NULL was silently turned into a value (what MySQL does outside strict mode). */
  const coerced: string[] = [];
  const key = (t: string, c: string) => `${t}.${c}`;
  const cols = new Map(columns.map((c) => [key(c.table, c.column), { ...c, nullable: true, nulls: [] as string[], type: "varchar(36)", charset: "utf8mb4", collation: "utf8mb4_unicode_ci", comment: "", missing: false, ...state[key(c.table, c.column)] }]));
  const statements: string[] = [];
  const TX = { id: "the-transaction" };
  const find = (sql: string) => {
    const m = /`(\w+)` WHERE `(\w+)` IS NULL/.exec(sql);
    return m ? cols.get(key(m[1], m[2])) : undefined;
  };
  const sequelize = {
    escape: (value: string) => `'${value.replace(/'/g, "\\'")}'`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: jest.fn(async (sql: string, opts?: any): Promise<unknown> => {
      statements.push(sql);
      if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
        const [table, column] = opts.replacements as [string, string];
        const c = cols.get(key(table, column));
        if (!c || c.missing) return [];
        return [{ type: c.type, nullable: c.nullable ? "YES" : "NO", cs: c.charset, coll: c.collation, comment: c.comment }];
      }
      if (/^SELECT @@SESSION\.sql_mode/.test(sql)) {
        return [{ mode }];
      }
      if (/^SET SESSION sql_mode = CONCAT\(@@sql_mode, ',STRICT_TRANS_TABLES'\)/.test(sql)) {
        mode = `${mode},STRICT_TRANS_TABLES`;
        return [[], undefined];
      }
      const setMode = /^SET SESSION sql_mode = '(.*)'$/.exec(sql);
      if (setMode) {
        mode = setMode[1];
        return [[], undefined];
      }
      if (/^SELECT COUNT\(\*\) AS n/.test(sql)) {
        return [{ n: find(sql)?.nulls.length ?? 0 }];
      }
      if (/^SELECT `\w+` AS id/.test(sql)) {
        const c = find(sql);
        const limit = /LIMIT (\d+)$/.exec(sql);
        const ids = [...(c?.nulls ?? [])].sort();
        return (limit ? ids.slice(0, Number(limit[1])) : ids).map((id) => ({ id }));
      }
      const alter = /^ALTER TABLE `(\w+)` MODIFY COLUMN `(\w+)` .* (NOT NULL|NULL DEFAULT NULL)/.exec(sql);
      if (alter) {
        const c = cols.get(key(alter[1], alter[2]))!;
        if (alter[3] === "NOT NULL") {
          if (c.nulls.length > 0) {
            // MySQL: strict mode refuses (1138); otherwise the NULLs silently become '' and the MODIFY "succeeds".
            if (/STRICT_(TRANS|ALL)_TABLES/.test(mode)) throw new Error("Invalid use of NULL value");
            c.nulls = [];
            coerced.push(key(alter[1], alter[2]));
          }
          c.nullable = false;
        } else {
          c.nullable = true;
        }
        return [[], undefined];
      }
      throw new Error(`unexpected statement: ${sql}`);
    }),
    transaction: jest.fn((cb: (t: unknown) => Promise<void>) => cb(TX)),
  };
  return {
    queryInterface: { sequelize } as never,
    sequelize,
    TX,
    cols,
    sqlMode: () => mode,
    coerced,
    statements,
    alters: () => statements.filter((s) => /^ALTER TABLE/.test(s)),
    writes: () => statements.filter((s) => /^\s*(UPDATE|INSERT|DELETE|REPLACE)/i.test(s)),
  };
};
