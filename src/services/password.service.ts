import bcryptjs from "bcryptjs";
import md5 from "crypto-js/md5";

/**
 * Password hashing, mid-migration from unsalted MD5 to bcrypt. Mirror of the
 * central API's service — the two APIs share the `schoolusers` table, so their
 * hashing MUST agree. Stored form is `bcrypt(md5(password))`; verify is
 * dual-mode (accepts legacy md5 OR bcrypt) so this deploys safely before the
 * rewrap migration runs. `bcryptjs` (pure JS) keeps this buildable on a Pi.
 * See docs/password-hashing-bcrypt-plan.md.
 */

const BCRYPT_ROUNDS = 10;

const md5hex = (plain: string): string => md5(plain).toString();

export const hashPassword = (plain: string): string =>
  bcryptjs.hashSync(md5hex(plain), BCRYPT_ROUNDS);

export const verifyPassword = (plain: string, stored: string): boolean => {
  if (!stored) {
    return false;
  }
  if (stored.startsWith("$2")) {
    return bcryptjs.compareSync(md5hex(plain), stored);
  }
  return stored === md5hex(plain);
};
