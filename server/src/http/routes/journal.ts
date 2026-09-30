import type { FastifyInstance } from 'fastify';
import { idParams, paginationQuery } from '@shared/schemas/common';
import { journalCreateSchema, journalUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { decryptSecret, encryptSecret } from '../../crypto';

/**
 * Journal entries are private and encrypted at rest (AES-256-GCM, keyed per user) — even a database dump
 * doesn't expose their text.
 */
const aad = (userId: string) => `journal:${userId}`;

interface JournalRow {
  id: string;
  period: string | null;
  promptKey: string | null;
  contentEnc: string;
  mood: number | null;
  createdAt: string;
  updatedAt: string;
}

function decrypt(row: JournalRow, userId: string) {
  const { contentEnc, ...rest } = row;
  return { ...rest, content: decryptSecret(contentEnc, aad(userId)) };
}

export async function registerJournalRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/journal',
    defineRoute({
      query: paginationQuery,
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const offset = (query.page - 1) * query.pageSize;
        const [rows, total] = await Promise.all([
          db.query<JournalRow>(
            `SELECT id, period, prompt_key AS "promptKey", content_enc AS "contentEnc", mood, created_at AS "createdAt", updated_at AS "updatedAt"
             FROM journal_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [auth.user.id, query.pageSize, offset],
          ),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE user_id = $1`, [auth.user.id]),
        ]);
        return { entries: rows.map((r) => decrypt(r, auth.user.id)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  app.post(
    '/api/journal',
    defineRoute({
      body: journalCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        const row = await db.one<JournalRow>(
          `INSERT INTO journal_entries (user_id, period, prompt_key, content_enc, mood) VALUES ($1,$2,$3,$4,$5)
           RETURNING id, period, prompt_key AS "promptKey", content_enc AS "contentEnc", mood, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [auth.user.id, body.period ?? null, body.promptKey ?? null, encryptSecret(body.content, aad(auth.user.id)), body.mood ?? null],
        );
        return { entry: decrypt(row!, auth.user.id) };
      },
    }),
  );

  app.patch(
    '/api/journal/:id',
    defineRoute({
      params: idParams,
      body: journalUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM journal_entries WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Journal entry');
        const row = await db.one<JournalRow>(
          `UPDATE journal_entries SET
             content_enc = COALESCE($3, content_enc), period = COALESCE($4, period), prompt_key = COALESCE($5, prompt_key), mood = COALESCE($6, mood)
           WHERE id = $1 AND user_id = $2
           RETURNING id, period, prompt_key AS "promptKey", content_enc AS "contentEnc", mood, created_at AS "createdAt", updated_at AS "updatedAt"`,
          [params.id, auth.user.id, body.content ? encryptSecret(body.content, aad(auth.user.id)) : null, body.period ?? null, body.promptKey ?? null, body.mood ?? null],
        );
        return { entry: decrypt(row!, auth.user.id) };
      },
    }),
  );

  app.delete(
    '/api/journal/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM journal_entries WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Journal entry');
        return { ok: true };
      },
    }),
  );
}
