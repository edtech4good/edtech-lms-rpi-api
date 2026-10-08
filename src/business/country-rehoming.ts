import { Transaction, QueryTypes } from "sequelize";
import { countries } from "src/models/data-models/countries";
import { CONTENT_TABLES, Row, TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";
import { dbinstance } from "src/services/dbservice";

/**
 * Countries are a shared reference table whose NAME is unique. Two servers that were set up
 * apart (a classroom server provisioned offline, or two central installations) can each hold a
 * country of the same name under a DIFFERENT id. A payload that carries such a country cannot be
 * written by id: the unique key on the name fires.
 *
 * The one rule, used by the content import (`PUT /import/master`) and by the classroom-server
 * provisioning tool, which re-homes its payload before importing it:
 *
 *  - WHAT IS "THE SAME NAME" IS DECIDED BY THE DATABASE, never by this code. `countries.countryname`
 *    has a UNIQUE key under the column's collation (the table takes the database's default when it is
 *    created, so it is `utf8mb4_unicode_ci` on some databases and not on others: the code reads the real
 *    collation from the column at run time, and the specs' fake approximates `utf8mb4_unicode_ci` only), and
 *    that key is what collides: a write of a country whose name the collation calls equal to another
 *    row's does not raise, it UPDATES that row (the writer is an INSERT ... ON DUPLICATE KEY UPDATE,
 *    and the name key fires it too). So a text rule of our own (trim, NFC, lower-case) could say
 *    "different" where MySQL says "equal" and a local country would be silently renamed. The names are
 *    therefore compared by a lookup that asks MySQL (`mysqlCountryNames`): `WHERE countryname = ?` uses
 *    the column collation, which ignores case, accents, trailing spaces and some Khmer marks.
 *  - a payload country whose name is a country here under the SAME id is left as it is (the import
 *    upserts it by id, as it always has, and the payload's spelling of its own country wins);
 *  - a payload country whose name the database calls equal to a country here under ANOTHER id is
 *    replaced by this server's row: the local id wins, the payload's row is never written, the local
 *    row keeps its own spelling (it is never renamed by an import), and every reference to the
 *    payload's id is rewritten to the local id. Content ids are not touched;
 *  - a local country of that name that is soft-deleted is brought back (the row that replaces the
 *    payload's is written live): a school points at it, so it must be usable;
 *  - two payload countries whose names the database calls equal, with no local match, collapse onto
 *    the first, and the second's id is rewritten to the first's, before anything is written;
 *  - a name this server does not have is a new country: written by id, as it always has been;
 *  - more than one local country the database calls equal to the name is ambiguous and is refused.
 *
 * Two steps, so a caller that cannot wait (the provisioning tool re-homes a payload in plain code)
 * can look first: `matchCountriesByName` asks the lookup, `rehomeCountriesByName` is pure.
 */

export interface LocalCountry {
  countryid: string;
  countryname: string;
  expectedusage?: number | null;
  isdeleted?: boolean | number | null;
}

/** The two questions only the database can answer about a name. */
export interface CountryNameLookup {
  /** The local countries whose name the database calls equal to `name` (the column's collation decides). */
  findByName(name: string): Promise<LocalCountry[]>;
  /** Whether the database calls the two names equal. */
  sameName(a: string, b: string): Promise<boolean>;
}

/** More than one country here has the name of a payload country. */
export class AmbiguousCountryName extends Error {
  constructor() {
    super("More than one country here has the name of the payload's country.");
    this.name = "AmbiguousCountryName";
  }
}

/** What the lookup said about a payload's countries; build it with `matchCountriesByName`. */
export interface CountryMatches {
  /** For a payload country name as given: the local countries the database calls equal to it. */
  local: Map<string, LocalCountry[]>;
  /** For a payload country name as given with no local match: the first payload name the database calls equal to it. */
  firstEqual: Map<string, string>;
}

export const NO_COUNTRY_MATCHES: CountryMatches = { local: new Map(), firstEqual: new Map() };

export interface CountryRehoming {
  /** The payload's countries as they are to be written: re-homed ones are this server's own row; no id twice. */
  rows: Row[];
  /** Payload country id (lower-cased) to the id that replaces it (a local country's, or the first of two payload countries of one name). */
  idMap: Map<string, string>;
  /** Of those, how many are local rows that were soft-deleted and are written live. */
  revived: number;
  /** Of those, how many are a second payload country of a name already carried by another payload row (no local match). */
  collapsed: number;
}

const lower = (value: string) => value.toLowerCase();

export async function matchCountriesByName(payload: Row[], lookup: CountryNameLookup): Promise<CountryMatches> {
  const local = new Map<string, LocalCountry[]>();
  const firstEqual = new Map<string, string>();
  const representatives: string[] = [];
  for (const row of payload) {
    const name = String(row.countryname);
    if (local.has(name)) continue;
    const found = await lookup.findByName(name);
    local.set(name, found);
    if (found.length > 0) continue;
    let first = name;
    for (const other of representatives) {
      if (await lookup.sameName(other, name)) {
        first = other;
        break;
      }
    }
    if (first === name) representatives.push(name);
    firstEqual.set(name, first);
  }
  return { local, firstEqual };
}

export function rehomeCountriesByName(payload: Row[], matches: CountryMatches): CountryRehoming {
  const idMap = new Map<string, string>();
  const seen = new Set<string>();
  // For a name with no local match, the payload row that is kept among those the database calls equal: the first LIVE one, else the first.
  const keeperOf = new Map<string, Row>();
  const classOf = (row: Row) => matches.firstEqual.get(String(row.countryname)) ?? String(row.countryname);
  for (const row of payload) {
    if ((matches.local.get(String(row.countryname)) ?? []).length > 0) continue;
    const kind = classOf(row);
    const kept = keeperOf.get(kind);
    if (kept === undefined || (kept.isdeleted && !row.isdeleted)) keeperOf.set(kind, row);
  }
  const rows: Row[] = [];
  let revived = 0;
  let collapsed = 0;
  for (const row of payload) {
    const name = String(row.countryname);
    const sameName = matches.local.get(name) ?? [];
    let out: Row = row;
    if (sameName.length > 0) {
      if (!sameName.some((c) => lower(String(c.countryid)) === lower(String(row.countryid)))) {
        if (sameName.length > 1) throw new AmbiguousCountryName();
        const mine = sameName[0];
        idMap.set(lower(String(row.countryid)), String(mine.countryid));
        out = { countryid: mine.countryid, countryname: mine.countryname, expectedusage: mine.expectedusage ?? null, isdeleted: false };
        if (mine.isdeleted) revived += 1;
      }
    } else {
      const keeper = keeperOf.get(classOf(row)) as Row;
      if (lower(String(keeper.countryid)) !== lower(String(row.countryid))) {
        idMap.set(lower(String(row.countryid)), String(keeper.countryid));
        collapsed += 1;
        continue;
      }
    }
    if (!seen.has(lower(String(out.countryid)))) {
      seen.add(lower(String(out.countryid)));
      rows.push(out);
    }
  }
  return { rows, idMap, revived, collapsed };
}

/**
 * Every column of the payload that holds a country id (the references the payload format declares,
 * `CONTENT_TABLES`) is rewritten from a payload id to the replacing id. `skip` names tables not to touch.
 */
export function rewriteCountryReferences<T extends Record<TableKey, Row[]>>(tables: T, idMap: Map<string, string>, skip: TableKey[] = []): T {
  if (idMap.size === 0) return tables;
  const out = { ...tables };
  for (const key of TABLE_KEYS) {
    if (skip.includes(key)) continue;
    for (const ref of CONTENT_TABLES[key].refs ?? []) {
      if (ref.to !== "countries") continue;
      out[key] = out[key].map((row) => {
        const mapped = idMap.get(lower(String(row[ref.fk] ?? "")));
        return mapped ? { ...row, [ref.fk]: mapped } : row;
      });
    }
  }
  return out;
}

/**
 * The lookup that asks MySQL, inside the caller's transaction. `countryname = ?` is compared under the
 * column's own collation, which is also what its UNIQUE key uses; `sameName` compares two literals under
 * that same collation (read from the column, not assumed).
 */
export function mysqlCountryNames(transaction?: Transaction): CountryNameLookup {
  let collation: Promise<{ charset: string; collation: string }> | null = null;
  const columnCollation = () => {
    collation ??= dbinstance
      .getdbinstance()
      .query(
        `SELECT CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'countries' AND COLUMN_NAME = 'countryname' LIMIT 1`,
        { type: QueryTypes.SELECT, transaction },
      )
      .then((found) => {
        const r = (found as Array<{ cs?: string; coll?: string }>)[0];
        // interpolated into SQL below, so only a plain identifier is accepted
        if (!r?.cs || !r?.coll || !/^[a-z0-9_]+$/i.test(r.cs) || !/^[a-z0-9_]+$/i.test(r.coll)) {
          throw new Error("cannot read the collation of countries.countryname");
        }
        return { charset: r.cs, collation: r.coll };
      });
    return collation;
  };
  return {
    findByName: async (name) =>
      (await countries.findAll({
        attributes: ["countryid", "countryname", "expectedusage", "isdeleted"],
        where: { countryname: name },
        raw: true,
        transaction,
      })) as unknown as LocalCountry[],
    sameName: async (a, b) => {
      const { charset, collation: coll } = await columnCollation();
      const found = await dbinstance
        .getdbinstance()
        .query(`SELECT (CONVERT(:a USING ${charset}) COLLATE ${coll}) = (CONVERT(:b USING ${charset}) COLLATE ${coll}) AS same`, {
          replacements: { a, b },
          type: QueryTypes.SELECT,
          transaction,
        });
      return Number((found as Array<{ same: number | string }>)[0]?.same) === 1;
    },
  };
}
