import { CountryNameLookup, LocalCountry } from "src/business/country-rehoming";

/**
 * AN APPROXIMATION of how MySQL compares `countries.countryname` under `utf8mb4_unicode_ci`, for specs that have
 * no database. Checked by hand against MySQL 8 (7 Oct 2026, the container the other live proofs use):
 *   equal:     case ("TESTLAND" = "testland"); accents ("Téstland" = "Testland"); trailing spaces;
 *              the Khmer marks nikahit (ំ), muusikatoan (៉) and bantoc (់), which carry no weight;
 *   different: a leading space; a missing Khmer vowel sign ("កម្ពុជ" is not "កម្ពុជា"); any other letter.
 * It stands in for the database in the fake; the live run against MySQL is the proof.
 */
export const collateCountryName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ំ៉់]/g, "")
    .replace(/ +$/, "")
    .toLowerCase();

export const sameCountryNameAsMysql = (a: string, b: string): boolean => collateCountryName(a) === collateCountryName(b);

/** A lookup over these local countries that compares as the approximation above does. */
export const fakeCountryNames = (local: LocalCountry[]): CountryNameLookup => ({
  findByName: async (name) => local.filter((c) => sameCountryNameAsMysql(c.countryname, name)),
  sameName: async (a, b) => sameCountryNameAsMysql(a, b),
});
