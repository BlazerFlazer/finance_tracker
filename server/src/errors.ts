import { ERROR_STATUS, type ErrorCode } from '@shared/errors';
import type { ValidationIssue } from '@shared/schemas/common';

/** Thrown anywhere in a route handler or service; the Fastify error handler turns it into `ApiErrorBody`. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues?: ValidationIssue[];
  readonly params?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, opts: { issues?: ValidationIssue[]; params?: Record<string, unknown>; status?: number } = {}) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = opts.status ?? ERROR_STATUS[code];
    this.issues = opts.issues;
    this.params = opts.params;
  }

  static validation(issues: ValidationIssue[]): AppError {
    return new AppError('VALIDATION_ERROR', 'Validation failed', { issues });
  }
  static notFound(what = 'Resource'): AppError {
    return new AppError('NOT_FOUND', `${what} not found`);
  }
  static forbidden(message = 'Forbidden'): AppError {
    return new AppError('FORBIDDEN', message);
  }
  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
