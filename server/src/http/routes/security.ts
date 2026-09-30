import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { idParams, paginationQuery } from '@shared/schemas/common';
import {
  backupCodesRegenerateSchema,
  changePasswordSchema,
  deleteAccountSchema,
  twoFactorDisableSchema,
  twoFactorEnableSchema,
  twoFactorSetupSchema,
} from '@shared/schemas/auth';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { blockDemoWrite, requireAuth } from '../../auth/guard';
import { config } from '../../config';
import { generateTotpSecret, hashPassword, totpProvisioningUri, verifyPassword } from '../../crypto';
import { loadMe } from '../../auth/dto';
import { listActiveSessions, revokeOtherSessions, revokeSession } from '../../auth/session';
import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, getPendingSecret, getTwoFactorStatus, regenerateBackupCodes, verifyTwoFactorCode } from '../../auth/twofactor';
import { recordSecurityEvent } from '../../security/events';
import { deletionCancelledMail, deletionRequestedMail, passwordChangedMail, twoFactorDisabledMail, twoFactorEnabledMail } from '../../mail/templates';

async function assertPassword(db: FastifyInstance['db'], userId: string, password: string): Promise<void> {
  const row = await db.one<{ passwordHash: string | null }>(`SELECT password_hash AS "passwordHash" FROM users WHERE id = $1`, [userId]);
  if (!row?.passwordHash || !(await verifyPassword(row.passwordHash, password))) throw new AppError('PASSWORD_INCORRECT');
}

export async function registerSecurityRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/security/overview',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        const me = await loadMe(db, auth.user.id);
        const twoFactor = await getTwoFactorStatus(db, auth.user.id);
        const sessions = await listActiveSessions(db, auth.user.id, auth.session.id);
        return { emailVerified: !!me?.emailVerifiedAt, twoFactor, activeSessions: sessions.length, memberSince: me?.createdAt };
      },
    }),
  );

  // ------------------------------------------------------------------------------------------ password
  app.post(
    '/api/security/change-password',
    defineRoute({
      body: changePasswordSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        blockDemoWrite(auth);
        await assertPassword(db, auth.user.id, body.currentPassword);
        const passwordHash = await hashPassword(body.newPassword);
        await db.exec(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [auth.user.id, passwordHash]);
        if (body.logoutOthers) await revokeOtherSessions(db, auth.user.id, auth.session.id, 'password_changed');
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'password_changed', ip: req.meta.ip, userAgent: req.meta.userAgent });
        const me = await loadMe(db, auth.user.id);
        const mail = passwordChangedMail(me?.language ?? 'en');
        await app.mailer.send(db, { to: auth.user.email, subject: mail.subject, text: mail.text, html: mail.html });
        return { ok: true };
      },
    }),
  );

  // ------------------------------------------------------------------------------------------------ 2FA
  app.post(
    '/api/security/2fa/setup',
    defineRoute({
      body: twoFactorSetupSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        blockDemoWrite(auth);
        const status = await getTwoFactorStatus(db, auth.user.id);
        if (status.enabled) throw new AppError('TWO_FACTOR_ALREADY_ENABLED');
        await assertPassword(db, auth.user.id, body.password);
        const secret = generateTotpSecret();
        await beginTwoFactorSetup(db, auth.user.id, secret);
        const uri = totpProvisioningUri(secret, auth.user.email, 'FinTrack');
        const qrCodeDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
        return { secret, otpauthUrl: uri, qrCodeDataUrl };
      },
    }),
  );

  app.post(
    '/api/security/2fa/enable',
    defineRoute({
      body: twoFactorEnableSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        blockDemoWrite(auth);
        if (!(await getPendingSecret(db, auth.user.id))) throw new AppError('CONFLICT', 'Start 2FA setup first.');
        const result = await confirmTwoFactorSetup(db, auth.user.id, body.code);
        if (!result.ok) throw new AppError('TWO_FACTOR_INVALID');
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'two_factor_enabled', ip: req.meta.ip, userAgent: req.meta.userAgent });
        const me = await loadMe(db, auth.user.id);
        const mail = twoFactorEnabledMail(me?.language ?? 'en');
        await app.mailer.send(db, { to: auth.user.email, subject: mail.subject, text: mail.text, html: mail.html });
        return { backupCodes: result.backupCodes };
      },
    }),
  );

  app.post(
    '/api/security/2fa/disable',
    defineRoute({
      body: twoFactorDisableSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        blockDemoWrite(auth);
        const status = await getTwoFactorStatus(db, auth.user.id);
        if (!status.enabled) throw new AppError('TWO_FACTOR_NOT_ENABLED');
        await assertPassword(db, auth.user.id, body.password);
        const check = await verifyTwoFactorCode(db, auth.user.id, body.code);
        if (!check.valid) throw new AppError('TWO_FACTOR_INVALID');
        await disableTwoFactor(db, auth.user.id);
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'two_factor_disabled', ip: req.meta.ip, userAgent: req.meta.userAgent });
        const me = await loadMe(db, auth.user.id);
        const mail = twoFactorDisabledMail(me?.language ?? 'en');
        await app.mailer.send(db, { to: auth.user.email, subject: mail.subject, text: mail.text, html: mail.html });
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/security/2fa/backup-codes/regenerate',
    defineRoute({
      body: backupCodesRegenerateSchema,
      handler: async ({ body, req }) => {
        const auth = requireAuth(req);
        blockDemoWrite(auth);
        const status = await getTwoFactorStatus(db, auth.user.id);
        if (!status.enabled) throw new AppError('TWO_FACTOR_NOT_ENABLED');
        await assertPassword(db, auth.user.id, body.password);
        const check = await verifyTwoFactorCode(db, auth.user.id, body.code);
        if (!check.valid) throw new AppError('TWO_FACTOR_INVALID');
        const codes = await regenerateBackupCodes(db, auth.user.id);
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'backup_codes_regenerated', ip: req.meta.ip, userAgent: req.meta.userAgent });
        return { backupCodes: codes };
      },
    }),
  );

  // -------------------------------------------------------------------------------------------- sessions
  app.get(
    '/api/security/sessions',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        return { sessions: await listActiveSessions(db, auth.user.id, auth.session.id) };
      },
    }),
  );

  app.post(
    '/api/security/sessions/:id/revoke',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireAuth(req);
        const owns = await db.one(`SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!owns) throw AppError.notFound('Session');
        await revokeSession(db, params.id, 'user_revoked');
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'session_revoked', ip: req.meta.ip, metadata: { sessionId: params.id, self: params.id === auth.session.id } });
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/security/sessions/revoke-others',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        const count = await revokeOtherSessions(db, auth.user.id, auth.session.id, 'user_revoked_others');
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'sessions_revoked_all', ip: req.meta.ip, metadata: { count } });
        return { revoked: count };
      },
    }),
  );

  // --------------------------------------------------------------------------------------------- devices
  app.get(
    '/api/security/devices',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        return {
          devices: await db.query(
            `SELECT id, label, browser, os, device_type AS "deviceType", first_seen_at AS "firstSeenAt", last_seen_at AS "lastSeenAt", last_ip AS "lastIp", last_country AS "lastCountry"
             FROM user_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
            [auth.user.id],
          ),
        };
      },
    }),
  );

  // ---------------------------------------------------------------------------------------- security log
  app.get(
    '/api/security/events',
    defineRoute({
      query: paginationQuery,
      handler: async ({ query, req }) => {
        const auth = requireAuth(req);
        const offset = (query.page - 1) * query.pageSize;
        const [items, total] = await Promise.all([
          db.query(
            `SELECT id, type, severity, ip, user_agent AS "userAgent", country_code AS "countryCode", device_label AS "deviceLabel", metadata, created_at AS "createdAt"
             FROM security_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [auth.user.id, query.pageSize, offset],
          ),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM security_events WHERE user_id = $1`, [auth.user.id]),
        ]);
        return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  // ---------------------------------------------------------------------------------- account deletion
  app.post(
    '/api/security/delete-account',
    defineRoute({
      body: deleteAccountSchema,
      handler: async ({ body, req, reply }) => {
        const auth = requireAuth(req);
        blockDemoWrite(auth);
        await assertPassword(db, auth.user.id, body.password);
        const status = await getTwoFactorStatus(db, auth.user.id);
        if (status.enabled) {
          if (!body.code) throw new AppError('TWO_FACTOR_REQUIRED');
          const check = await verifyTwoFactorCode(db, auth.user.id, body.code);
          if (!check.valid) throw new AppError('TWO_FACTOR_INVALID');
        }
        if (body.confirmText.trim().toLowerCase() !== auth.user.username.toLowerCase()) {
          throw AppError.validation([{ path: 'confirmText', message: 'validation.required' }]);
        }
        const me = await loadMe(db, auth.user.id);

        if (body.mode === 'immediate') {
          await db.exec(`DELETE FROM users WHERE id = $1`, [auth.user.id]);
          await recordSecurityEvent(db, { type: 'account_deletion_requested', metadata: { mode: 'immediate' } });
          const { clearSessionCookies } = await import('../cookies');
          clearSessionCookies(reply);
          return { ok: true, deletedImmediately: true };
        }

        const scheduledFor = new Date(Date.now() + config.accountDeletionGraceDays * 86_400_000);
        await db.exec(`UPDATE users SET status = 'pending_deletion', deletion_requested_at = now(), deletion_scheduled_for = $2 WHERE id = $1`, [auth.user.id, scheduledFor.toISOString()]);
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'account_deletion_requested', ip: req.meta.ip, metadata: { scheduledFor: scheduledFor.toISOString() } });
        const mail = deletionRequestedMail(me?.language ?? 'en', scheduledFor.toDateString());
        await app.mailer.send(db, { to: auth.user.email, subject: mail.subject, text: mail.text, html: mail.html });
        return { ok: true, deletedImmediately: false, scheduledFor: scheduledFor.toISOString() };
      },
    }),
  );

  app.post(
    '/api/security/delete-account/cancel',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireAuth(req);
        const row = await db.one<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [auth.user.id]);
        if (row?.status !== 'pending_deletion') throw new AppError('CONFLICT', 'No pending deletion to cancel.');
        await db.exec(`UPDATE users SET status = 'active', deletion_requested_at = NULL, deletion_scheduled_for = NULL WHERE id = $1`, [auth.user.id]);
        await recordSecurityEvent(db, { userId: auth.user.id, type: 'account_deletion_cancelled', ip: req.meta.ip });
        const me = await loadMe(db, auth.user.id);
        const mail = deletionCancelledMail(me?.language ?? 'en');
        await app.mailer.send(db, { to: auth.user.email, subject: mail.subject, text: mail.text, html: mail.html });
        return { ok: true };
      },
    }),
  );
}
