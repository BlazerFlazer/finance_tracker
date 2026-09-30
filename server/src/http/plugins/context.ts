import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { resolveSession, SESSION_COOKIE } from '../../auth/session';
import { countryForIp, clientIp } from '../../geo';
import { parseUserAgent } from '../../ua';

/**
 * Runs first on every request: works out the caller's IP/UA/country and, if a session cookie is present
 * and valid, attaches `request.auth`. Everything downstream (route handlers, CSRF check, rate limiting)
 * reads from `request.meta` / `request.auth` instead of re-parsing headers.
 */
export default fp(async function contextPlugin(app: FastifyInstance) {
  app.decorateRequest('auth', null);
  app.decorateRequest('meta', null as never);

  app.addHook('onRequest', async (req) => {
    const ip = clientIp(req.headers['x-forwarded-for'], req.ip) ?? req.ip;
    const ua = parseUserAgent(req.headers['user-agent']);
    req.meta = { ip, userAgent: req.headers['user-agent'], ua, countryCode: countryForIp(ip) };
    req.auth = null;

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    // The cookie itself is signed (tamper-evident); we still look the hash up in the DB so a revoked
    // or expired session is rejected even if the signed cookie is still technically valid.
    const unsigned = req.unsignCookie(token);
    if (!unsigned.valid || !unsigned.value) return;
    req.auth = await resolveSession(app.db, unsigned.value);
  });
});
