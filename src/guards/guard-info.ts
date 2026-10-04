/**
 * What a route guard says about itself, for the route inventory
 * (src/route-policy/route-inventory.ts). Nest's `mixin()` gives every guard class
 * a random name, so a guard factory attaches this descriptor to the class it
 * returns and the inventory reads it back: it is the only way to tell, from the
 * wiring alone, which guards stand in front of a route.
 */
export const GUARD_INFO = Symbol("route-guard-info");

export interface GuardInfo {
  /** A short, stable label, as the inventory prints it (for example `AccessGuard(ACCESS, Role.TEACHER)`). */
  label: string;
  /** True when the guard lets central's server sync key through as the caller. */
  admitsServerKey?: boolean;
  /** The school roles listed on the guard; empty when any signed-in user passes. */
  roles?: number[];
}

// eslint-disable-next-line @typescript-eslint/ban-types
export const withGuardInfo = <T extends Function>(guard: T, info: GuardInfo): T => {
  (guard as unknown as Record<symbol, GuardInfo>)[GUARD_INFO] = info;
  return guard;
};

// eslint-disable-next-line @typescript-eslint/ban-types
export const guardInfoOf = (guard: Function | object): GuardInfo | undefined =>
  (guard as unknown as Record<symbol, GuardInfo | undefined>)[GUARD_INFO];
