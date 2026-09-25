import md5 from "crypto-js/md5";
import { hashPassword, verifyPassword } from "./password.service";

/**
 * Guards the password half of #22: verifyPassword only accepts a
 * bcrypt-wrapped hash. A raw, unwrapped MD5 hash — the format the removed
 * legacy login path compared against — must fail, not authenticate.
 */
describe("password.service", () => {
  it("round-trips a password through hashPassword/verifyPassword", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects the correct password when only its raw MD5 (the removed legacy form) is stored", () => {
    const plain = "correct horse battery staple";
    const rawMd5 = md5(plain).toString();

    expect(verifyPassword(plain, rawMd5)).toBe(false);
  });

  it("rejects a wrong password against a real bcrypt-wrapped hash", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("rejects when no hash is stored at all", () => {
    expect(verifyPassword("anything", "")).toBe(false);
    expect(verifyPassword("anything", undefined as unknown as string)).toBe(false);
  });

  it("always wraps a fresh hash in bcrypt ($2 prefix), never leaving it as raw MD5", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("$2")).toBe(true);
  });
});
