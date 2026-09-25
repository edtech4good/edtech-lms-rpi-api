/**
 * Client-facing error codes (docs/api-errors.md, agreed 25 Sep 2026).
 * Clients translate by `code`, never by the English `errormessage` text —
 * keep this enum's members stable; adding one is safe, renaming one is not.
 */
export enum ErrorCode {
  LOGIN_FAILED = 'LOGIN_FAILED',
  SIGN_IN_REQUIRED = 'SIGN_IN_REQUIRED',
  NOT_ALLOWED = 'NOT_ALLOWED',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_INPUT = 'INVALID_INPUT',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  FILE_REJECTED = 'FILE_REJECTED',
  TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL = 'INTERNAL',
}
