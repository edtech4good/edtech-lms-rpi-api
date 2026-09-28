import { timingSafeEqual } from "crypto";
import { Config } from "src/config";

/**
 * Constant-time check for whether an `Authorization` header is exactly the
 * server sync key (central's server-to-server credential, sent raw, never
 * as a Bearer token). Shared by every guard that may accept it, so there is
 * exactly one place doing the comparison.
 *
 * A plain `===` here would let a well-resourced attacker recover the key
 * byte-by-byte from response-time differences; `timingSafeEqual` requires
 * equal-length buffers first (it throws otherwise), so the length check
 * also has to happen outside it and cheaply — that part alone leaks only
 * the key's length, which is not a secret.
 */
export const isServerSyncKey = (authorization: string | undefined): boolean => {
  const key = Config.fortyk.api.serversynckey;
  if (!authorization || !key) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(key);
  return given.length === expected.length && timingSafeEqual(given, expected);
};
