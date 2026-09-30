import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkPassword } from '@shared/password';
import {
  forgotPasswordSchema,
  login2faSchema,
  loginSchema,
  registerEmailCheckSchema,
  registerSchema,
  registerUsernameCheckSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@shared/schemas/auth';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireAuth } from '../../auth/guard';
import { config } from '../../config';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '../../crypto';
import { createUserWithDefaults } from '../../auth/registerUser';
import { consumeEmailToken, findEmailToken, issueEmailToken, tokenCooldownRemainingMs } from '../../auth/tokens';
import { createSession, DEVICE_COOKIE, revokeAllSessions, revokeSessionByToken, SESSION_COOKIE, touchDevice, type RequestMeta } from '../../auth/session';
import { setDeviceCookie, setSessionCookies, clearSessionCookies } from '../cookies';
import { loadMe } from '../../auth/dto';
import { verifyTwoFactorCode } from '../../auth/twofactor';
import { recordSecurityEvent } from '../../security/events';
import { checkRateLimit, RATE_LIMITS } from '../../security/rateLimit';
import { deviceLabel } from '../../ua';
import { newDeviceLoginMail, passwordChangedMail, passwordResetMail, verifyEmailMail } from '../../mail/templates';
import { readPublicSettings } from './meta';
import type { Db } from '../../db/index';

const VERIFY_TTL_MS = 24 * 60 * 60_000;
const RESET_TTL_MS = 60 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_CHALLENGE_ATTEMPTS = 6;

let dummyHashPromise: Promise<string> | null = null;
const getDummyHash = () => (dummyHashPromise ??= hashPassword(randomToken(16)));

function requestMeta(req: FastifyRequest): RequestMeta {
  return { ip: req.meta.ip, userAgent: req.meta.userAgent, ua: req.meta.ua, countryCode: req.meta.countryCode };
}

function deviceKeyFromCookie(req: FastifyRequest): string | null {
  const raw = req.cookies[DEVICE_COOKIE];
  if (!raw) return null;
  const u = req.unsignCookie(raw);
  return u.valid ? (u.value ?? null) : null;
}

/** Shared tail of every successful login path: creates the session, recognises the device, alerts on a new one. */
async function establishSession(app: FastifyInstance, req: FastifyRequest, userId: string, remember: boolean) {
  const db = app.db;
  const meta = requestMeta(req);
  const { deviceId, isNewDevice, newDeviceKey } = await touchDevice(db, userId, deviceKeyFromCookie(req), meta);
  const session = await createSession(db, userId, remember, meta, deviceId);
  await db.exec(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
  await recordSecurityEvent(db, { userId, type: 'login_success', ip: meta.ip, userAgent: meta.userAgent, countryCode: meta.countryCode, deviceLabel: deviceLabel(meta.ua) });
  if (isNewDevice) {
    await recordSecurityEvent(db, { userId, type: 'new_device_login', ip: meta.ip, userAgent: meta.userAgent, countryCode: meta.countryCode, deviceLabel: deviceLabel(meta.ua) });
    const me = await loadMe(db, userId);
    if (me) {
      const when = new Date().toISOString();
      const mail = newDeviceLoginMail(me.language, deviceLabel(meta.ua), meta.countryCode ?? 'unknown location', when);
      await app.mailer.send(db, { to: me.email, subject: mail.subject, text: mail.text, html: mail.html });
    }
  }
  return { session, newDeviceKey };
}

async function assertRegistrationOpen(db: Db) {
  const settings = await readPublicSettings(db);
  if (settings.maintenanceMode) throw new AppError('MAINTENANCE');
  if (!settings.registrationOpen) throw new AppError('REGISTRATION_CLOSED');
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  // ---------------------------------------------------------------- registration (step-by-step checks)
  app.post(
    '/api/auth/register/check-email',
    defineRoute({
      body: registerEmailCheckSchema,
      handler: async ({ body, req }) => {
        const r = await checkRateLimit(db, RATE_LIMITS.usernameCheck, req.meta.ip ?? 'unknown');
        if (!r.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many requests', { params: { retryAfterMs: r.retryAfterMs } });
        const existing = await db.one(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.email]);
        return { available: !existing };
      },
    }),
  );

  app.post(
    '/api/auth/register/check-username',
    defineRoute({
      body: registerUsernameCheckSchema,
      handler: async ({ body, req }) => {
        const r = await checkRateLimit(db, RATE_LIMITS.usernameCheck, req.meta.ip ?? 'unknown');
        if (!r.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many requests', { params: { retryAfterMs: r.retryAfterMs } });
        const existing = await db.one(`SELECT 1 FROM users WHERE lower(username) = lower($1)`, [body.username]);
        return { available: !existing };
      },
    }),
  );

  // Live strength feedback while typing — no account lookups, so no rate limit needed.
  app.post(
    '/api/auth/register/check-password',
    defineRoute({
      body: z.object({ password: z.string().max(200), email: z.string().max(254).optional(), username: z.string().max(40).optional() }),
      handler: async ({ body }) => checkPassword(body.password, { email: body.email, username: body.username }),
    }),
  );

  app.post(
    '/api/auth/register',
    defineRoute({
      body: registerSchema,
      handler: async ({ body, req, reply }) => {
        await assertRegistrationOpen(db);
        const ip = req.meta.ip ?? 'unknown';
        const ipCheck = await checkRateLimit(db, RATE_LIMITS.registerIp, ip);
        if (!ipCheck.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many requests', { params: { retryAfterMs: ipCheck.retryAfterMs } });

        if (await db.one(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [body.email])) throw new AppError('EMAIL_TAKEN', 'An account with this email already exists.');
        if (await db.one(`SELECT 1 FROM users WHERE lower(username) = lower($1)`, [body.username])) throw new AppError('USERNAME_TAKEN', 'Username already taken');

        const passwordHash = await hashPassword(body.password);
        const user = await createUserWithDefaults(db, { email: body.email, username: body.username, passwordHash, language: body.language, timezone: body.timezone });
        await recordSecurityEvent(db, { userId: user.id, type: 'register', ip, userAgent: req.meta.userAgent, countryCode: req.meta.countryCode });

        const token = await issueEmailToken(db, user.id, 'verify_email', VERIFY_TTL_MS);
        const mail = verifyEmailMail(body.language ?? 'en', user.username, `${config.appUrl}/verify-email?token=${token}`);
        await app.mailer.send(db, { to: user.email, subject: mail.subject, text: mail.text, html: mail.html });

        const { session, newDeviceKey } = await establishSession(app, req, user.id, false);
        setSessionCookies(reply, session, false);
        if (newDeviceKey) setDeviceCookie(reply, newDeviceKey);
        return { user: await loadMe(db, user.id) };
      },
    }),
  );

  app.post(
    '/api/auth/verify-email',
    defineRoute({
      body: verifyEmailSchema,
      handler: async ({ body }) => {
        const row = await findEmailToken(db, body.token, 'verify_email');
        if (!row) throw new AppError('TOKEN_INVALID');
        const user = await db.one<{ emailVerifiedAt: string | null }>(`SELECT email_verified_at AS "emailVerifiedAt" FROM users WHERE id = $1`, [row.userId]);
        if (!user) throw new AppError('TOKEN_INVALID');
        if (user.emailVerifiedAt) return { alreadyVerified: true };
        if (row.usedAt) throw new AppError('TOKEN_INVALID');
        if (new Date(row.expiresAt) < new Date()) throw new AppError('TOKEN_EXPIRED');
        await db.tx(async (tx) => {
          await consumeEmailToken(tx, row.id);
          await tx.exec(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [row.userId]);
        });
        await recordSecurityEvent(db, { userId: row.userId, type: 'email_verified' });
        return { alreadyVerified: false };
      },
    }),
  );

  app.post(
    '/api/auth/resend-verification',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        if (auth.user.emailVerifiedAt) throw new AppError('ALREADY_VERIFIED');
        const r = await checkRateLimit(db, RATE_LIMITS.resendVerification, auth.user.id);
        if (!r.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many requests', { params: { retryAfterMs: r.retryAfterMs } });
        const remaining = await tokenCooldownRemainingMs(db, auth.user.id, 'verify_email', RESEND_COOLDOWN_MS);
        if (remaining > 0) throw new AppError('COOLDOWN', 'Please wait before requesting another email.', { params: { seconds: Math.ceil(remaining / 1000) } });
        const me = await loadMe(db, auth.user.id);
        const token = await issueEmailToken(db, auth.user.id, 'verify_email', VERIFY_TTL_MS);
        const mail = verifyEmailMail(me?.language ?? 'en', auth.user.username, `${config.appUrl}/verify-email?token=${token}`);
        await app.mailer.send(db, { to: auth.user.email, subject: mail.subject, text: mail.text, html: mail.html });
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'verification_sent' });
        return { sent: true, cooldownSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000) };
      },
    }),
  );

  app.get(
    '/api/auth/me',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        const me = await loadMe(db, auth.user.id);
        if (!me) throw AppError.unauthenticated();
        return { user: me };
      },
    }),
  );

  // ---------------------------------------------------------------------------------------------- login
  app.post(
    '/api/auth/login',
    defineRoute({
      body: loginSchema,
      handler: async ({ body, req, reply }) => {
        const settings = await readPublicSettings(db);
        if (settings.maintenanceMode) throw new AppError('MAINTENANCE');
        const ip = req.meta.ip ?? 'unknown';
        const ipCheck = await checkRateLimit(db, RATE_LIMITS.loginIp, ip);
        const idCheck = await checkRateLimit(db, RATE_LIMITS.login, body.identifier.toLowerCase());
        if (!ipCheck.allowed || !idCheck.allowed) {
          const retryAfterMs = Math.max(ipCheck.retryAfterMs, idCheck.retryAfterMs);
          await recordSecurityEvent(db, { type: 'login_locked', ip, userAgent: req.meta.userAgent, identifier: body.identifier, metadata: { retryAfterMs } });
          throw new AppError('RATE_LIMITED', 'Too many failed attempts. Please try again later.', { params: { retryAfterMs } });
        }

        const user = await db.one<{ id: string; email: string; username: string; passwordHash: string | null; status: string; isDemo: boolean }>(
          `SELECT id, email, username, password_hash AS "passwordHash", status, is_demo AS "isDemo" FROM users WHERE lower(email) = lower($1) OR lower(username) = lower($1)`,
          [body.identifier],
        );
        const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), body.password);
        if (!user || !user.passwordHash || !passwordOk) {
          await recordSecurityEvent(db, { userId: user?.id, type: 'login_failed', ip, userAgent: req.meta.userAgent, countryCode: req.meta.countryCode, identifier: user ? undefined : body.identifier });
          throw new AppError('INVALID_CREDENTIALS', 'The email/username or password is incorrect.');
        }
        if (user.status === 'suspended') {
          await recordSecurityEvent(db, { userId: user.id, type: 'login_failed', ip, metadata: { reason: 'suspended' } });
          throw new AppError('ACCOUNT_SUSPENDED');
        }

        const twoFactor = await db.one<{ confirmedAt: string | null }>(`SELECT confirmed_at AS "confirmedAt" FROM user_totp WHERE user_id = $1`, [user.id]);
        if (twoFactor?.confirmedAt) {
          const challengeToken = randomToken(24);
          const deviceKey = deviceKeyFromCookie(req);
          await db.exec(
            `INSERT INTO login_challenges (user_id, token_hash, remember, ip, user_agent, device_key_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' ms')::interval)`,
            [user.id, sha256Hex(challengeToken), body.remember, ip, req.meta.userAgent ?? null, deviceKey ? sha256Hex(deviceKey) : null, CHALLENGE_TTL_MS],
          );
          return { twoFactorRequired: true, challengeToken, expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000) };
        }

        const { session, newDeviceKey } = await establishSession(app, req, user.id, body.remember);
        setSessionCookies(reply, session, body.remember);
        if (newDeviceKey) setDeviceCookie(reply, newDeviceKey);
        return { twoFactorRequired: false, user: await loadMe(db, user.id) };
      },
    }),
  );

  app.post(
    '/api/auth/login/verify-2fa',
    defineRoute({
      body: login2faSchema,
      handler: async ({ body, req, reply }) => {
        const challenge = await db.one<{ id: string; userId: string; remember: boolean; attempts: number; expiresAt: string; usedAt: string | null }>(
          `SELECT id, user_id AS "userId", remember, attempts, expires_at AS "expiresAt", used_at AS "usedAt" FROM login_challenges WHERE token_hash = $1`,
          [sha256Hex(body.challengeToken)],
        );
        if (!challenge || challenge.usedAt) throw new AppError('TOKEN_INVALID');
        if (new Date(challenge.expiresAt) < new Date()) throw new AppError('TOKEN_EXPIRED');
        if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) throw new AppError('TOKEN_INVALID', 'Too many attempts. Please sign in again.');

        const rl = await checkRateLimit(db, RATE_LIMITS.twoFactor, challenge.userId);
        if (!rl.allowed) throw new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.', { params: { retryAfterMs: rl.retryAfterMs } });

        const result = await verifyTwoFactorCode(db, challenge.userId, body.code);
        if (!result.valid) {
          await db.exec(`UPDATE login_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
          await recordSecurityEvent(db, { userId: challenge.userId, type: 'login_2fa_failed', ip: req.meta.ip, userAgent: req.meta.userAgent });
          throw new AppError('TWO_FACTOR_INVALID');
        }
        await db.exec(`UPDATE login_challenges SET used_at = now() WHERE id = $1`, [challenge.id]);

        const { session, newDeviceKey } = await establishSession(app, req, challenge.userId, challenge.remember);
        setSessionCookies(reply, session, challenge.remember);
        if (newDeviceKey) setDeviceCookie(reply, newDeviceKey);
        return { user: await loadMe(db, challenge.userId) };
      },
    }),
  );

  app.post(
    '/api/auth/logout',
    defineRoute({
      handler: async ({ req, reply }) => {
        const token = req.cookies[SESSION_COOKIE];
        if (token) {
          const unsigned = req.unsignCookie(token);
          if (unsigned.valid && unsigned.value) {
            const sessionId = await revokeSessionByToken(db, unsigned.value);
            if (sessionId && req.auth) await recordSecurityEvent(db, { userId: req.auth.user.id, type: 'logout' });
          }
        }
        clearSessionCookies(reply);
        return { ok: true };
      },
    }),
  );

  // ----------------------------------------------------------------------------------------- password reset
  app.post(
    '/api/auth/forgot-password',
    defineRoute({
      body: forgotPasswordSchema,
      handler: async ({ body, req }) => {
        const ip = req.meta.ip ?? 'unknown';
        await checkRateLimit(db, RATE_LIMITS.forgotPassword, ip);
        const rl = await checkRateLimit(db, RATE_LIMITS.forgotPassword, body.email.toLowerCase());
        // Always the same response either way, so the endpoint never reveals whether the address is registered.
        if (rl.allowed) {
          const user = await db.one<{ id: string; username: string; passwordHash: string | null }>(`SELECT id, username, password_hash AS "passwordHash" FROM users WHERE lower(email) = lower($1)`, [
            body.email,
          ]);
          if (user?.passwordHash) {
            const me = await loadMe(db, user.id);
            const token = await issueEmailToken(db, user.id, 'password_reset', RESET_TTL_MS);
            const mail = passwordResetMail(me?.language ?? 'en', user.username, `${config.appUrl}/reset-password?token=${token}`);
            await app.mailer.send(db, { to: body.email, subject: mail.subject, text: mail.text, html: mail.html });
            await recordSecurityEvent(db, { userId: user.id, type: 'password_reset_requested', ip, userAgent: req.meta.userAgent });
          }
        }
        return { sent: true };
      },
    }),
  );

  app.post(
    '/api/auth/reset-password',
    defineRoute({
      body: resetPasswordSchema,
      handler: async ({ body, req }) => {
        const row = await findEmailToken(db, body.token, 'password_reset');
        if (!row || row.usedAt) throw new AppError('TOKEN_INVALID');
        if (new Date(row.expiresAt) < new Date()) throw new AppError('TOKEN_EXPIRED');
        const user = await db.one<{ username: string; email: string }>(`SELECT username, email FROM users WHERE id = $1`, [row.userId]);
        if (!user) throw new AppError('TOKEN_INVALID');

        const check = checkPassword(body.password, { email: user.email, username: user.username });
        if (!check.ok) throw AppError.validation(check.issues.map((code) => ({ path: 'password', message: `validation.password_${code}` })));

        const passwordHash = await hashPassword(body.password);
        await db.tx(async (tx) => {
          await consumeEmailToken(tx, row.id);
          await tx.exec(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [row.userId, passwordHash]);
        });
        await revokeAllSessions(db, row.userId, 'password_reset');
        await recordSecurityEvent(db, { userId: row.userId, type: 'password_reset_completed', ip: req.meta.ip, userAgent: req.meta.userAgent });
        await recordSecurityEvent(db, { userId: row.userId, type: 'sessions_revoked_all', ip: req.meta.ip });

        const me = await loadMe(db, row.userId);
        const mail = passwordChangedMail(me?.language ?? 'en');
        await app.mailer.send(db, { to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
        return { ok: true };
      },
    }),
  );

  // -------------------------------------------------------------------------------------------- demo account
  app.post(
    '/api/auth/demo',
    defineRoute({
      handler: async ({ req, reply }) => {
        const settings = await readPublicSettings(db);
        if (!settings.demoEnabled) throw AppError.forbidden('The demo account is currently disabled.');
        const r = await checkRateLimit(db, RATE_LIMITS.demo, req.meta.ip ?? 'unknown');
        if (!r.allowed) throw new AppError('RATE_LIMITED_GENERIC', 'Too many requests', { params: { retryAfterMs: r.retryAfterMs } });
        const { createDemoUser } = await import('../../demo/seed');
        const user = await createDemoUser(db);
        await db.exec(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [user.id]);
        const { session, newDeviceKey } = await establishSession(app, req, user.id, false);
        setSessionCookies(reply, session, false);
        if (newDeviceKey) setDeviceCookie(reply, newDeviceKey);
        return { user: await loadMe(db, user.id) };
      },
    }),
  );
}
