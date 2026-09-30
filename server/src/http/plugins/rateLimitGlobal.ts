import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { checkRateLimit, RATE_LIMITS } from '../../security/rateLimit';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Coarse, IP-keyed backstop for every mutating API request, on top of the tighter named limiters
 * (login, register, password reset, …) applied inside those specific route handlers.
 */
export default fp(async function rateLimitGlobalPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    const result = await checkRateLimit(app.db, RATE_LIMITS.apiWrite, req.meta.ip ?? 'unknown');
    if (!result.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many requests', { params: { retryAfterMs: result.retryAfterMs } });
  });
});
