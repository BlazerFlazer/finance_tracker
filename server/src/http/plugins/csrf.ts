import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { csrfMatches } from '../../auth/session';
import { config } from '../../config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** State-changing endpoints that legitimately run before a session (and its CSRF token) exists. */
const CSRF_EXEMPT_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/register/check-email',
  '/api/auth/register/check-username',
  '/api/auth/login',
  '/api/auth/login/verify-2fa',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/demo',
]);

/**
 * Two layers, per section 45 of the spec:
 *  1. Origin allow-list — every state-changing request (even pre-login ones) must come from a known origin.
 *     Browsers attach `Origin` to same-site and cross-site fetch/XHR alike, so a request forged from another
 *     site is rejected before it ever touches a handler.
 *  2. Session-bound CSRF token (`X-CSRF-Token`) — required in addition, once a session cookie is present.
 *     The token is issued with the session and never leaves it, so a page on another origin cannot guess it
 *     even if it could somehow get a same-origin request through.
 */
export default fp(async function csrfPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;

    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin.replace(/\/+$/, ''))) {
      throw new AppError('ORIGIN_INVALID', 'Request origin is not allowed');
    }

    const path = req.url.split('?')[0]!;
    if (CSRF_EXEMPT_PATHS.has(path)) return;

    if (req.auth) {
      const header = req.headers['x-csrf-token'];
      const token = Array.isArray(header) ? header[0] : header;
      if (!csrfMatches(req.auth.session, token)) throw new AppError('CSRF_INVALID', 'Missing or invalid CSRF token');
    }
  });
});
