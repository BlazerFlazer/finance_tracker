/**
 * Stable machine-readable error codes shared by the API and the web app. Each one is also a key under
 * `errors.*` in the i18n catalogues (see shared/src/i18n), so the client can always show a localised message
 * even for a code it doesn't specifically handle.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'RATE_LIMITED_GENERIC',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_TAKEN',
  'USERNAME_TAKEN',
  'INVALID_CREDENTIALS',
  'ACCOUNT_SUSPENDED',
  'TWO_FACTOR_REQUIRED',
  'TWO_FACTOR_INVALID',
  'TOKEN_INVALID',
  'TOKEN_EXPIRED',
  'ALREADY_VERIFIED',
  'COOLDOWN',
  'CSRF_INVALID',
  'ORIGIN_INVALID',
  'REGISTRATION_CLOSED',
  'MAINTENANCE',
  'PASSWORD_INCORRECT',
  'PASSWORD_POLICY',
  'DEMO_RESTRICTED',
  'SPLIT_MISMATCH',
  'ACCOUNT_HAS_TRANSACTIONS',
  'CATEGORY_IN_USE',
  'CURRENCY_MISMATCH',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA',
  'ADMIN_2FA_REQUIRED',
  'LAST_ADMIN',
  'SELF_ACTION',
  'TWO_FACTOR_ALREADY_ENABLED',
  'TWO_FACTOR_NOT_ENABLED',
  'NOT_IMPLEMENTED',
  'AI_NOT_CONFIGURED',
  'AI_CONSENT_REQUIRED',
  'INTERNAL',
  'NETWORK',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  RATE_LIMITED_GENERIC: 429,
  EMAIL_NOT_VERIFIED: 403,
  EMAIL_TAKEN: 409,
  USERNAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_SUSPENDED: 403,
  TWO_FACTOR_REQUIRED: 401,
  TWO_FACTOR_INVALID: 401,
  TOKEN_INVALID: 400,
  TOKEN_EXPIRED: 400,
  ALREADY_VERIFIED: 409,
  COOLDOWN: 429,
  CSRF_INVALID: 403,
  ORIGIN_INVALID: 403,
  REGISTRATION_CLOSED: 403,
  MAINTENANCE: 503,
  PASSWORD_INCORRECT: 401,
  PASSWORD_POLICY: 422,
  DEMO_RESTRICTED: 403,
  SPLIT_MISMATCH: 422,
  ACCOUNT_HAS_TRANSACTIONS: 409,
  CATEGORY_IN_USE: 409,
  CURRENCY_MISMATCH: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  ADMIN_2FA_REQUIRED: 403,
  LAST_ADMIN: 409,
  SELF_ACTION: 403,
  TWO_FACTOR_ALREADY_ENABLED: 409,
  TWO_FACTOR_NOT_ENABLED: 409,
  NOT_IMPLEMENTED: 501,
  AI_NOT_CONFIGURED: 501,
  AI_CONSENT_REQUIRED: 403,
  INTERNAL: 500,
  NETWORK: 0,
};

/** Wire shape of every non-2xx API response. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string; // English fallback / debugging aid — the UI translates `code` itself
    issues?: { path: string; message: string; params?: Record<string, unknown> }[];
    params?: Record<string, unknown>;
    requestId?: string;
  };
}

export function isApiErrorBody(v: unknown): v is ApiErrorBody {
  return !!v && typeof v === 'object' && 'error' in v && !!(v as any).error?.code;
}
