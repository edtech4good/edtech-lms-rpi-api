import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from './enums/errorcode.enum';

export interface ErrorCatalogueEntry {
  status: number;
  message: string;
  hint?: string;
}

/**
 * code -> default status/message/hint (docs/api-errors.md "Codes" table).
 * A throw site may override `message`/`hint` with something more specific
 * ("That file is larger than 10 MB.") but must keep the same code/status
 * and never add ids, paths, SQL text or other internal detail.
 */
export const ErrorCatalogue: Record<ErrorCode, ErrorCatalogueEntry> = {
  [ErrorCode.LOGIN_FAILED]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The username or password is incorrect.',
    hint: "Check both and try again. If you've forgotten your password, ask your school.",
  },
  [ErrorCode.SIGN_IN_REQUIRED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Please sign in to continue.',
    hint: 'Your session may have expired.',
  },
  [ErrorCode.NOT_ALLOWED]: {
    status: HttpStatus.FORBIDDEN,
    message: "You don't have permission to do that.",
    hint: 'If you think you should, ask your school administrator.',
  },
  [ErrorCode.NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: "We couldn't find that.",
    hint: 'It may have been removed or moved.',
  },
  [ErrorCode.INVALID_INPUT]: {
    status: HttpStatus.BAD_REQUEST,
    message: "Some of the information isn't valid.",
    hint: 'Check the highlighted fields.',
  },
  [ErrorCode.ALREADY_EXISTS]: {
    status: HttpStatus.CONFLICT,
    message: 'That already exists.',
    hint: 'Use a different name, or edit the existing one.',
  },
  [ErrorCode.FILE_REJECTED]: {
    status: HttpStatus.BAD_REQUEST,
    message: "That file can't be used.",
  },
  [ErrorCode.TOO_MANY_ATTEMPTS]: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many attempts.',
    hint: 'Wait a minute, then try again.',
  },
  [ErrorCode.SERVICE_UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The service is temporarily unavailable.',
    hint: 'Try again in a few minutes. Your work is kept and retried.',
  },
  [ErrorCode.INTERNAL]: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Something went wrong on our side.',
    hint: 'Try again. If it keeps happening, contact support with the reference.',
  },
};
