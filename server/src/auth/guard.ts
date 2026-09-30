import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors';
import type { ResolvedSession } from './session';

export function requireAuth(req: FastifyRequest): ResolvedSession {
  if (!req.auth) throw AppError.unauthenticated();
  if (req.auth.user.status === 'suspended') throw new AppError('ACCOUNT_SUSPENDED');
  return req.auth;
}

/** Same as {@link requireAuth}, but also requires a confirmed email — use on every financial-data route. */
export function requireVerified(req: FastifyRequest): ResolvedSession {
  const auth = requireAuth(req);
  if (!auth.user.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED');
  return auth;
}

export function requireAdmin(req: FastifyRequest): ResolvedSession {
  const auth = requireAuth(req);
  if (auth.user.role !== 'admin') throw AppError.forbidden();
  return auth;
}

/**
 * The demo account behaves like a real one for ordinary data (so the product feels genuine), but a short
 * list of sensitive, identity-level actions are blocked outright. Call this only at those specific routes
 * (change password/email, 2FA, session revocation, account deletion) — not as a blanket write guard.
 */
export function blockDemoWrite(auth: ResolvedSession): void {
  if (auth.user.isDemo) throw new AppError('DEMO_RESTRICTED', 'This action is not available in the demo account.');
}
