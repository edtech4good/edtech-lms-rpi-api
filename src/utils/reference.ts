import { randomInt } from 'crypto';

/**
 * Unambiguous alphabet for the user-facing `reference` code: no 0/O, 1/I/L,
 * so it can be read over the phone or copied into a support message without
 * confusion. docs/api-errors.md: "E-" plus 6 characters from this alphabet.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE_LENGTH = 6;

/** Crypto-random `E-XXXXXX` reference, logged with the full error detail. */
export function generateErrorReference(): string {
  let suffix = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++) {
    suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `E-${suffix}`;
}
