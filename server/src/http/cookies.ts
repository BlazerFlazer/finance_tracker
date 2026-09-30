import type { FastifyReply } from 'fastify';
import { config } from '../config';
import {
  CSRF_COOKIE,
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_S,
  SESSION_ABSOLUTE_MS,
  SESSION_ABSOLUTE_REMEMBER_MS,
  SESSION_COOKIE,
  type NewSession,
} from '../auth/session';

const baseCookie = { path: '/', sameSite: 'lax' as const, secure: config.cookieSecure };

export function setSessionCookies(reply: FastifyReply, session: NewSession, remember: boolean): void {
  const maxAgeS = Math.floor((remember ? SESSION_ABSOLUTE_REMEMBER_MS : SESSION_ABSOLUTE_MS) / 1000);
  reply.setCookie(SESSION_COOKIE, session.token, { ...baseCookie, httpOnly: true, signed: true, maxAge: maxAgeS });
  // Readable by the SPA on purpose: it is echoed back as the X-CSRF-Token header (double-submit pattern).
  reply.setCookie(CSRF_COOKIE, session.csrfToken, { ...baseCookie, httpOnly: false, maxAge: maxAgeS });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

export function setDeviceCookie(reply: FastifyReply, deviceKey: string): void {
  reply.setCookie(DEVICE_COOKIE, deviceKey, { ...baseCookie, httpOnly: true, signed: true, maxAge: DEVICE_COOKIE_MAX_AGE_S });
}
