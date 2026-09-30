import type { FastifyInstance } from 'fastify';
import { idParams, paginationQuery } from '@shared/schemas/common';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { config } from '../../config';

/**
 * Dev-only mailbox viewer for the `outbox` mail transport (see server/src/mail/mailer.ts): every "sent"
 * email lands in the `mail_outbox` table instead of a real inbox, so the whole verify/reset/alert flow is
 * testable with zero mail setup. Hard-disabled outside development so it can never leak into production.
 */
export async function registerDevRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;
  const enabled = !config.isProd && config.mail.transport === 'outbox';

  app.get(
    '/api/dev/mailbox',
    defineRoute({
      query: paginationQuery,
      handler: async ({ query }) => {
        if (!enabled) throw AppError.notFound();
        const offset = (query.page - 1) * query.pageSize;
        const [items, total] = await Promise.all([
          db.query(`SELECT id, to_email AS "toEmail", subject, created_at AS "createdAt" FROM mail_outbox ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [query.pageSize, offset]),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM mail_outbox`),
        ]);
        return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  app.get(
    '/api/dev/mailbox/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params }) => {
        if (!enabled) throw AppError.notFound();
        const mail = await db.one(`SELECT id, to_email AS "toEmail", subject, text_body AS "textBody", html_body AS "htmlBody", created_at AS "createdAt" FROM mail_outbox WHERE id = $1`, [params.id]);
        if (!mail) throw AppError.notFound('Email');
        return { mail };
      },
    }),
  );

  app.get(
    '/api/dev/status',
    defineRoute({
      handler: async () => ({ mailTransport: config.mail.transport, mailboxEnabled: enabled, env: config.env, dbKind: db.kind }),
    }),
  );
}
