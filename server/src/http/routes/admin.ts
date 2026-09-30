import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hexColorSchema, iconNameSchema, paginationQuery } from '@shared/schemas/common';
import { USER_ROLES } from '@shared/constants';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireAdmin } from '../../auth/guard';
import { getTwoFactorStatus } from '../../auth/twofactor';
import { revokeAllSessions } from '../../auth/session';
import { recordAudit, recordSecurityEvent } from '../../security/events';
import { config } from '../../config';
import type { ResolvedSession } from '../../auth/session';

async function requireAdminSecure(db: FastifyInstance['db'], req: FastifyRequest): Promise<ResolvedSession> {
  const auth = requireAdmin(req);
  if (config.adminRequire2fa) {
    const status = await getTwoFactorStatus(db, auth.user.id);
    if (!status.enabled) throw new AppError('ADMIN_2FA_REQUIRED');
  }
  return auth;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/admin/stats',
    defineRoute({
      handler: async ({ req }) => {
        const auth = await requireAdminSecure(db, req);
        const [users, activeUsers, newUsers, transactions, events, dbInfo] = await Promise.all([
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE NOT is_demo`),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE NOT is_demo AND last_login_at > now() - interval '30 days'`),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE NOT is_demo AND created_at > now() - interval '7 days'`),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id NOT IN (SELECT id FROM users WHERE is_demo)`),
          db.query<{ severity: string; n: number }>(`SELECT severity, COUNT(*)::int AS n FROM security_events WHERE created_at > now() - interval '7 days' GROUP BY severity`),
          Promise.resolve({ kind: db.kind }),
        ]);
        await recordAudit(db, { actorUserId: auth.user.id, actorRole: 'admin', action: 'admin.stats.viewed', ip: req.meta.ip });
        return {
          totalUsers: users?.n ?? 0,
          activeUsers: activeUsers?.n ?? 0,
          newUsers: newUsers?.n ?? 0,
          totalTransactions: transactions?.n ?? 0,
          securityEventsBySeverity: events,
          system: { database: dbInfo.kind, env: config.env, uptimeSeconds: Math.round(process.uptime()) },
        };
      },
    }),
  );

  app.get(
    '/api/admin/users',
    defineRoute({
      query: paginationQuery.extend({ search: z.string().trim().max(120).optional() }),
      handler: async ({ query, req }) => {
        await requireAdminSecure(db, req);
        const where: string[] = ['1=1'];
        const params: unknown[] = [];
        if (query.search) {
          params.push(`%${query.search}%`);
          where.push(`(email ILIKE $${params.length} OR username ILIKE $${params.length})`);
        }
        const offset = (query.page - 1) * query.pageSize;
        params.push(query.pageSize, offset);
        const [items, total] = await Promise.all([
          db.query(
            `SELECT id, email, username, role, status, is_demo AS "isDemo", email_verified_at AS "emailVerifiedAt", created_at AS "createdAt", last_login_at AS "lastLoginAt"
             FROM users ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
          ),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE ${where.join(' AND ')}`, params.slice(0, params.length - 2)),
        ]);
        return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  app.post(
    '/api/admin/users/:id/suspend',
    defineRoute({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ reason: z.string().trim().min(1).max(300) }),
      handler: async ({ params, body, req }) => {
        const auth = await requireAdminSecure(db, req);
        if (params.id === auth.user.id) throw new AppError('SELF_ACTION');
        const result = await db.exec(`UPDATE users SET status = 'suspended', suspended_reason = $2 WHERE id = $1`, [params.id, body.reason]);
        if (result === 0) throw AppError.notFound('User');
        await revokeAllSessions(db, params.id, 'admin_suspended');
        await recordSecurityEvent(db, { userId: params.id, type: 'account_suspended', metadata: { reason: body.reason, by: auth.user.id } });
        await recordAudit(db, { actorUserId: auth.user.id, actorRole: 'admin', action: 'admin.user.suspend', targetType: 'user', targetId: params.id, ip: req.meta.ip, metadata: { reason: body.reason } });
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/admin/users/:id/unsuspend',
    defineRoute({
      params: z.object({ id: z.string().uuid() }),
      handler: async ({ params, req }) => {
        const auth = await requireAdminSecure(db, req);
        const result = await db.exec(`UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = $1 AND status = 'suspended'`, [params.id]);
        if (result === 0) throw AppError.notFound('Suspended user');
        await recordAudit(db, { actorUserId: auth.user.id, actorRole: 'admin', action: 'admin.user.unsuspend', targetType: 'user', targetId: params.id, ip: req.meta.ip });
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/admin/users/:id/role',
    defineRoute({
      params: z.object({ id: z.string().uuid() }),
      body: z.object({ role: z.enum(USER_ROLES) }),
      handler: async ({ params, body, req }) => {
        const auth = await requireAdminSecure(db, req);
        if (params.id === auth.user.id && body.role !== 'admin') throw new AppError('SELF_ACTION', "You can't remove your own admin role.");
        if (body.role !== 'admin') {
          const admins = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND id <> $1`, [params.id]);
          if ((admins?.n ?? 0) === 0) throw new AppError('LAST_ADMIN');
        }
        const result = await db.exec(`UPDATE users SET role = $2 WHERE id = $1`, [params.id, body.role]);
        if (result === 0) throw AppError.notFound('User');
        await recordAudit(db, { actorUserId: auth.user.id, actorRole: 'admin', action: 'admin.user.role', targetType: 'user', targetId: params.id, ip: req.meta.ip, metadata: { role: body.role } });
        return { ok: true };
      },
    }),
  );

  app.get(
    '/api/admin/security-events',
    defineRoute({
      query: paginationQuery,
      handler: async ({ query, req }) => {
        await requireAdminSecure(db, req);
        const offset = (query.page - 1) * query.pageSize;
        const [items, total] = await Promise.all([
          db.query(
            `SELECT id, user_id AS "userId", type, severity, ip, country_code AS "countryCode", metadata, created_at AS "createdAt" FROM security_events ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
            [query.pageSize, offset],
          ),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM security_events`),
        ]);
        return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  app.get(
    '/api/admin/audit-log',
    defineRoute({
      query: paginationQuery,
      handler: async ({ query, req }) => {
        await requireAdminSecure(db, req);
        const offset = (query.page - 1) * query.pageSize;
        const [items, total] = await Promise.all([
          db.query(`SELECT id, actor_user_id AS "actorUserId", action, target_type AS "targetType", target_id AS "targetId", metadata, created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [
            query.pageSize,
            offset,
          ]),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_logs`),
        ]);
        return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  // ------------------------------------------------------------------------------------ category templates
  app.get(
    '/api/admin/category-templates',
    defineRoute({
      handler: async ({ req }) => {
        await requireAdminSecure(db, req);
        return { templates: await db.query(`SELECT key, kind, parent_key AS "parentKey", name, icon, color, sort_order AS "sortOrder", is_active AS "isActive" FROM category_templates ORDER BY (parent_key IS NOT NULL), sort_order`) };
      },
    }),
  );

  app.patch(
    '/api/admin/category-templates/:key',
    defineRoute({
      params: z.object({ key: z.string() }),
      body: z.object({ name: z.string().trim().max(60).optional(), icon: iconNameSchema.optional(), color: hexColorSchema.optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() }),
      handler: async ({ params, body, req }) => {
        const auth = await requireAdminSecure(db, req);
        const result = await db.exec(
          `UPDATE category_templates SET name = COALESCE($2,name), icon = COALESCE($3,icon), color = COALESCE($4,color), sort_order = COALESCE($5,sort_order), is_active = COALESCE($6,is_active) WHERE key = $1`,
          [params.key, body.name ?? null, body.icon ?? null, body.color ?? null, body.sortOrder ?? null, body.isActive ?? null],
        );
        if (result === 0) throw AppError.notFound('Category template');
        await recordAudit(db, { actorUserId: auth.user.id, actorRole: 'admin', action: 'admin.category_template.update', targetType: 'category_template', targetId: params.key, ip: req.meta.ip });
        return { ok: true };
      },
    }),
  );

  // ------------------------------------------------------------------------------------------- settings
  app.get(
    '/api/admin/settings',
    defineRoute({
      handler: async ({ req }) => {
        await requireAdminSecure(db, req);
        return { settings: await db.query(`SELECT key, value, updated_at AS "updatedAt" FROM system_settings ORDER BY key`) };
      },
    }),
  );

  app.patch(
    '/api/admin/settings/:key',
    defineRoute({
      params: z.object({ key: z.string() }),
      body: z.object({ value: z.unknown() }),
      handler: async ({ params, body, req }) => {
        const auth = await requireAdminSecure(db, req);
        const result = await db.exec(`UPDATE system_settings SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1`, [params.key, JSON.stringify(body.value), auth.user.id]);
        if (result === 0) throw AppError.notFound('Setting');
        await recordAudit(db, { actorUserId: auth.user.id, actorRole: 'admin', action: 'admin.settings.update', targetType: 'system_setting', targetId: params.key, ip: req.meta.ip, metadata: { value: body.value } });
        return { ok: true };
      },
    }),
  );
}
