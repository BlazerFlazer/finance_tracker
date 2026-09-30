import { ApiError } from './api';
import type { MessageParams } from '@shared/i18n/index';

/** Turns a caught error into {code, params} for `t('errors.'+code, params)`, falling back to a generic network/internal message. */
export function errorToMessageKey(e: unknown): { key: string; params?: MessageParams } {
  if (e instanceof ApiError) {
    const params: MessageParams = { ...(e.params as MessageParams | undefined) };
    if (typeof params.retryAfterMs === 'number') params.minutes = Math.ceil((params.retryAfterMs as number) / 60_000);
    return { key: `errors.${e.code}`, params };
  }
  return { key: 'errors.INTERNAL' };
}

/** Builds a {fieldPath: translationKey} map from an ApiError's validation issues, for inline field errors. */
export function fieldErrorsFrom(e: unknown): Record<string, { key: string; params?: MessageParams }> {
  if (!(e instanceof ApiError) || !e.issues) return {};
  const out: Record<string, { key: string; params?: MessageParams }> = {};
  for (const issue of e.issues) out[issue.path] = { key: issue.message, params: issue.params as MessageParams | undefined };
  return out;
}
