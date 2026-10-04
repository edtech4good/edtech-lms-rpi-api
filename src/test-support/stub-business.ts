/**
 * For the specs that drive real HTTP through the real guards (src/modules/org-boundary.leak.spec.ts): a business
 * class whose methods are replaced by markers, so that a route's access rule can be proved without running the
 * query code behind it. Each replaced method records its name in `stubCalls` and answers with one marker row that
 * carries the string arguments it was called with (the ids the route passed down), so a spec can tell which
 * content a route actually asked for.
 *
 * It has no jest dependency, so it can be required from a `jest.mock` factory with `jest.requireActual`.
 */
export const stubCalls: string[] = [];
/** The same calls, with the string arguments each was made with. */
export const stubLog: Array<{ ran: string; args: string[] }> = [];

export interface MarkerRow {
  ran: string;
  args: string[];
}

const markerRow = (ran: string, args: string[]): MarkerRow => {
  const row: MarkerRow = { ran, args };
  // The calls the business layer makes on a row it was handed (a model instance): harmless, and not part of the JSON.
  const helpers: Record<string, unknown> = {
    getDataValue: (): number => 0,
    setDataValue: (): void => undefined,
    get: (): MarkerRow => row,
    getLesson: async (): Promise<object> => ({ practices_points: 0, quizzes_points: 0, lessonid: "stub" }),
  };
  for (const [name, value] of Object.entries(helpers)) {
    Object.defineProperty(row, name, { value, enumerable: false });
  }
  return row;
};

/** Every function the instance owns is replaced by a marker, except the named ones, which stay real. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stubAllBut<T extends new (...args: any[]) => any>(Actual: T, keep: string[] = []): T {
  const name = Actual.name;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return class extends (Actual as any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      for (const key of Object.keys(this)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const self = this as any;
        if (typeof self[key] === "function" && !keep.includes(key)) {
          self[key] = async (...given: unknown[]) => {
            const args = given.filter((x): x is string => typeof x === "string");
            stubCalls.push(`${name}.${key}`);
            stubLog.push({ ran: `${name}.${key}`, args });
            return [markerRow(`${name}.${key}`, args)];
          };
        }
      }
    }
  } as unknown as T;
}
