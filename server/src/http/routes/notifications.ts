import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams, paginationQuery } from '@shared/schemas/common';
import { NOTIFICATION_TYPES } from '@shared/constants';
import { notificationPrefUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { config } from '../../config';

const pushSubscribeSchema = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/notifications',
    defineRoute({
      query: paginationQuery.extend({ unreadOnly: z.coerce.boolean().default(false) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const where = query.unreadOnly ? 'user_id = $1 AND read_at IS NULL' : 'user_id = $1';
        const offset = (query.page - 1) * query.pageSize;
        const [items, total, unread] = await Promise.all([
          db.query(
            `SELECT id, type, severity, code, params, entity_type AS "entityType", entity_id AS "entityId", read_at AS "readAt", created_at AS "createdAt"
             FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [auth.user.id, query.pageSize, offset],
          ),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE ${where}`, [auth.user.id]),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [auth.user.id]),
        ]);
        return { items, total: total?.n ?? 0, unreadCount: unread?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  app.get(
    '/api/notifications/unread-count',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const row = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [auth.user.id]);
        return { unreadCount: row?.n ?? 0 };
      },
    }),
  );

  app.post(
    '/api/notifications/:id/read',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Notification');
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/notifications/read-all',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const n = await db.exec(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [auth.user.id]);
        return { updated: n };
      },
    }),
  );

  app.delete(
    '/api/notifications/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM notifications WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Notification');
        return { ok: true };
      },
    }),
  );

  app.get(
    '/api/notifications/preferences',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const rows = await db.query<{ type: string; inApp: boolean; email: boolean; push: boolean }>(
          `SELECT type, in_app AS "inApp", email, push FROM notification_preferences WHERE user_id = $1`,
          [auth.user.id],
        );
        const byType = new Map(rows.map((r) => [r.type, r]));
        return { items: NOTIFICATION_TYPES.map((type) => byType.get(type) ?? { type, inApp: true, email: false, push: false }), pushEnabled: !!config.vapid.publicKey };
      },
    }),
  );

  app.put(
    '/api/notifications/preferences',
    defineRoute({
      body: notificationPrefUpdateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        await db.tx(async (tx) => {
          for (const item of body.items) {
            await tx.exec(
              `INSERT INTO notification_preferences (user_id, type, in_app, email, push) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (user_id, type) DO UPDATE SET in_app = $3, email = $4, push = $5`,
              [auth.user.id, item.type, item.inApp, item.email, item.push],
            );
          }
        });
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/notifications/push/subscribe',
    defineRoute({
      body: pushSubscribeSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        if (!config.vapid.publicKey) throw AppError.forbidden('Push notifications are not configured on this server.');
        await db.exec(
          `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5`,
          [auth.user.id, body.endpoint, body.keys.p256dh, body.keys.auth, req.meta.userAgent ?? null],
        );
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/notifications/push/unsubscribe',
    defineRoute({
      body: z.object({ endpoint: z.string().url() }),
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        await db.exec(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [body.endpoint, auth.user.id]);
        return { ok: true };
      },
    }),
  );
}
