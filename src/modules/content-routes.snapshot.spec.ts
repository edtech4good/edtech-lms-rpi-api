import { ROUTES, IDS, LEARNER, asJson, installContentFakes } from "src/test-support/content-routes-fixture";

/**
 * What each content route answers WITHOUT the translations header, on the seed tree of the fixture. The snapshots in
 * `__snapshots__` were taken by running this file against the code of `main` (before bilingual content existed), and
 * this branch must match them to the byte: a client that does not ask for translations sees no change at all.
 *
 * `level/library` stamps the time it was built: it is the one field replaced here.
 */
beforeEach(() => installContentFakes());
afterEach(() => jest.restoreAllMocks());

const stable = (body: any): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const copy = asJson(body);
  if (copy?.data?.generated_at) copy.data.generated_at = "<time>";
  return copy;
};

describe("the content routes without the translations header", () => {
  it.each(Object.keys(ROUTES))("%s answers as it always did", async (route) => {
    const body = stable(await ROUTES[route](LEARNER));
    expect(body).toMatchSnapshot();
    expect(JSON.stringify(body)).not.toMatch(/translations|contentlanguage/);
  });

  it("answers the same with a header that is not exactly 1", async () => {
    for (const header of ["0", "true", "", " 2 "]) {
      for (const route of Object.keys(ROUTES)) {
        expect(stable(await ROUTES[route](LEARNER, header))).toEqual(stable(await ROUTES[route](LEARNER)));
      }
    }
    expect(IDS.curriculum).toBe("c1");
  });
});
