import { CONTENT_TABLES, Row, TABLE_KEYS, TableKey } from "src/modules/import/organisation-content.validator";
import { normaliseSchoolName } from "./school-identity";

/**
 * Countries are a shared reference table whose NAME is unique. Two servers that were set up
 * apart (a classroom server provisioned offline, or two central installations) can each hold a
 * country of the same name under a DIFFERENT id. A payload that carries such a country cannot be
 * written by id: the name collides, or a school ends up pointing at an id that is not here.
 *
 * The one rule, used by the content import (`PUT /import/master`) and by the classroom-server
 * provisioning tool, which re-homes its payload before importing it:
 *
 *  - a payload country whose name is a country here under the SAME id is left as it is (the
 *    import upserts it by id, as it always has);
 *  - a payload country whose name is a country here under ANOTHER id is replaced by this
 *    server's row: the local id wins, the payload's row is never written, and every reference
 *    to the payload's id is rewritten to the local id. Content ids are not touched;
 *  - a local country of that name that is soft-deleted is brought back (the row that replaces
 *    the payload's is written live): a school points at it, so it must be usable;
 *  - a name this server does not have is a new country: written by id, as it always has been;
 *  - more than one local country of that name is ambiguous and is refused, not guessed.
 *
 * Names are compared as the rest of the code compares a name (trim, Unicode NFC, lower-case:
 * `school-identity.ts`), never by the column's collation. The collation of `countries.countryname`
 * is the judge of what the database itself refuses (it ignores accents, and trailing spaces); a
 * name that the database calls equal and this rule calls different is not re-homed, and the write
 * is refused by the database as a duplicate, with nothing written.
 */

export interface LocalCountry {
  countryid: string;
  countryname: string;
  expectedusage?: number | null;
  isdeleted?: boolean | number | null;
}

/** More than one country here has the name of a payload country. */
export class AmbiguousCountryName extends Error {
  constructor() {
    super("More than one country here has the name of the payload's country.");
    this.name = "AmbiguousCountryName";
  }
}

export interface CountryRehoming {
  /** The payload's countries as they are to be written: re-homed ones are this server's own row; no id twice. */
  rows: Row[];
  /** Payload country id (lower-cased) to the local id that replaces it. */
  idMap: Map<string, string>;
  /** Of those, how many are local rows that were soft-deleted and are written live. */
  revived: number;
}

const lower = (value: string) => value.toLowerCase();

export function rehomeCountriesByName(payload: Row[], local: LocalCountry[]): CountryRehoming {
  const byName = new Map<string, LocalCountry[]>();
  for (const row of local) {
    const key = normaliseSchoolName(String(row.countryname));
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  const idMap = new Map<string, string>();
  const seen = new Set<string>();
  const rows: Row[] = [];
  let revived = 0;
  for (const row of payload) {
    const sameName = byName.get(normaliseSchoolName(String(row.countryname))) ?? [];
    let out: Row = row;
    if (sameName.length > 0 && !sameName.some((c) => lower(String(c.countryid)) === lower(String(row.countryid)))) {
      if (sameName.length > 1) throw new AmbiguousCountryName();
      const mine = sameName[0];
      idMap.set(lower(String(row.countryid)), String(mine.countryid));
      out = { countryid: mine.countryid, countryname: mine.countryname, expectedusage: mine.expectedusage ?? null, isdeleted: false };
      if (mine.isdeleted) revived += 1;
    }
    if (!seen.has(lower(String(out.countryid)))) {
      seen.add(lower(String(out.countryid)));
      rows.push(out);
    }
  }
  return { rows, idMap, revived };
}

/**
 * Every column of the payload that holds a country id (the references the payload format declares,
 * `CONTENT_TABLES`) is rewritten from a payload id to the local id. `skip` names tables not to touch.
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
