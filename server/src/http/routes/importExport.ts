import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Papa from 'papaparse';
import writeXlsxFile from 'write-excel-file/node';
import { minorToDecimal } from '@shared/money';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { idParams } from '@shared/schemas/common';

const exportQuery = z.object({ from: z.string().optional(), to: z.string().optional(), accountId: z.string().uuid().optional() });

async function fetchExportRows(db: FastifyInstance['db'], userId: string, q: z.infer<typeof exportQuery>) {
  const where = ['t.user_id = $1'];
  const params: unknown[] = [userId];
  if (q.from) { params.push(q.from); where.push(`t.occurred_on >= $${params.length}`); }
  if (q.to) { params.push(q.to); where.push(`t.occurred_on <= $${params.length}`); }
  if (q.accountId) { params.push(q.accountId); where.push(`t.account_id = $${params.length}`); }
  return db.query<{ occurredOn: string; type: string; amountMinor: number; currency: string; account: string; category: string | null; merchant: string | null; description: string | null }>(
    `SELECT t.occurred_on AS "occurredOn", t.type, t.amount_minor AS "amountMinor", t.currency, a.name AS account,
            COALESCE(c.name, c.system_key) AS category, t.merchant, t.description
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${where.join(' AND ')} ORDER BY t.occurred_on DESC`,
    params,
  );
}

const importRowSchema = z.object({
  accountId: z.string().uuid(),
  type: z.enum(['income', 'expense']),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  categoryId: z.string().uuid(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  merchant: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

export async function registerImportExportRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/export/transactions.csv',
    defineRoute({
      query: exportQuery,
      handler: async ({ query, req, reply }) => {
        const auth = requireVerified(req);
        const rows = await fetchExportRows(db, auth.user.id, query);
        const csv = Papa.unparse(
          rows.map((r) => ({ Date: r.occurredOn, Type: r.type, Amount: minorToDecimal(r.amountMinor, 2), Currency: r.currency, Account: r.account, Category: r.category ?? '', Merchant: r.merchant ?? '', Description: r.description ?? '' })),
        );
        reply.header('Content-Disposition', 'attachment; filename="fintrack-transactions.csv"');
        return reply.type('text/csv; charset=utf-8').send('﻿' + csv); // BOM so Excel opens Cyrillic/UZ text correctly
      },
    }),
  );

  app.get(
    '/api/export/transactions.xlsx',
    defineRoute({
      query: exportQuery,
      handler: async ({ query, req, reply }) => {
        const auth = requireVerified(req);
        const rows = await fetchExportRows(db, auth.user.id, query);
        type Row = (typeof rows)[number];
        const buffer = await writeXlsxFile(rows, {
          columns: [
            { header: 'Date', width: 12, cell: (r: Row) => ({ type: String, value: r.occurredOn }) },
            { header: 'Type', width: 10, cell: (r: Row) => ({ type: String, value: r.type }) },
            { header: 'Amount', width: 14, cell: (r: Row) => ({ type: Number, value: r.amountMinor / 100 }) },
            { header: 'Currency', width: 10, cell: (r: Row) => ({ type: String, value: r.currency }) },
            { header: 'Account', width: 18, cell: (r: Row) => ({ type: String, value: r.account }) },
            { header: 'Category', width: 18, cell: (r: Row) => ({ type: String, value: r.category ?? '' }) },
            { header: 'Merchant', width: 20, cell: (r: Row) => ({ type: String, value: r.merchant ?? '' }) },
            { header: 'Description', width: 30, cell: (r: Row) => ({ type: String, value: r.description ?? '' }) },
          ],
        }).toBuffer();
        reply.header('Content-Disposition', 'attachment; filename="fintrack-transactions.xlsx"');
        return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
      },
    }),
  );

  // -------------------------------------------------------------------------------------------- import
  app.post(
    '/api/import/detect-duplicates',
    defineRoute({
      body: z.object({ rows: z.array(z.object({ occurredOn: z.string(), amountMinor: z.number().int(), merchant: z.string().optional().nullable() })).max(5000) }),
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        if (body.rows.length === 0) return { duplicateIndexes: [] };
        const existing = await db.query<{ occurredOn: string; amountMinor: number; merchant: string | null }>(
          `SELECT occurred_on AS "occurredOn", amount_minor AS "amountMinor", merchant FROM transactions WHERE user_id = $1 AND occurred_on BETWEEN $2 AND $3`,
          [auth.user.id, body.rows.reduce((m, r) => (r.occurredOn < m ? r.occurredOn : m), body.rows[0]!.occurredOn), body.rows.reduce((m, r) => (r.occurredOn > m ? r.occurredOn : m), body.rows[0]!.occurredOn)],
        );
        const key = (d: string, a: number, m?: string | null) => `${d}|${a}|${(m ?? '').trim().toLowerCase()}`;
        const existingKeys = new Set(existing.map((e) => key(e.occurredOn, e.amountMinor, e.merchant)));
        const duplicateIndexes = body.rows.map((r, i) => (existingKeys.has(key(r.occurredOn, r.amountMinor, r.merchant)) ? i : -1)).filter((i) => i >= 0);
        return { duplicateIndexes };
      },
    }),
  );

  app.post(
    '/api/import/commit',
    defineRoute({
      body: z.object({ filename: z.string().max(255).optional(), rows: z.array(importRowSchema).min(1).max(5000) }),
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        const accountIds = [...new Set(body.rows.map((r) => r.accountId))];
        const categoryIds = [...new Set(body.rows.map((r) => r.categoryId))];
        const [accounts, categories] = await Promise.all([
          db.query<{ id: string; currency: string }>(`SELECT id, currency FROM accounts WHERE user_id = $1 AND id = ANY($2)`, [auth.user.id, accountIds]),
          db.query<{ id: string; kind: string }>(`SELECT id, kind FROM categories WHERE user_id = $1 AND id = ANY($2)`, [auth.user.id, categoryIds]),
        ]);
        const accountMap = new Map(accounts.map((a) => [a.id, a.currency]));
        const categoryMap = new Map(categories.map((c) => [c.id, c.kind]));
        for (const r of body.rows) {
          if (accountMap.get(r.accountId) !== r.currency) throw new AppError('CURRENCY_MISMATCH', `Row currency does not match account ${r.accountId}`);
          if (categoryMap.get(r.categoryId) !== r.type) throw AppError.validation([{ path: 'categoryId', message: 'validation.invalid_option' }]);
        }

        const result = await db.tx(async (tx) => {
          const batch = await tx.one<{ id: string }>(`INSERT INTO import_batches (user_id, filename, source, total_rows) VALUES ($1,$2,'csv',$3) RETURNING id`, [auth.user.id, body.filename ?? null, body.rows.length]);
          let imported = 0;
          for (const r of body.rows) {
            await tx.exec(
              `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, description, occurred_on, import_batch_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [auth.user.id, r.type, r.accountId, r.currency, r.amountMinor, r.categoryId, r.merchant ?? null, r.description ?? null, r.occurredOn, batch!.id],
            );
            imported++;
          }
          await tx.exec(`UPDATE import_batches SET imported_rows = $2 WHERE id = $1`, [batch!.id, imported]);
          return { importBatchId: batch!.id, imported };
        });
        return result;
      },
    }),
  );

  app.get(
    '/api/import/batches',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        return { batches: await db.query(`SELECT id, filename, total_rows AS "totalRows", imported_rows AS "importedRows", status, created_at AS "createdAt" FROM import_batches WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [auth.user.id]) };
      },
    }),
  );

  app.post(
    '/api/import/batches/:id/undo',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const batch = await db.one<{ status: string }>(`SELECT status FROM import_batches WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!batch) throw AppError.notFound('Import batch');
        if (batch.status === 'undone') throw new AppError('CONFLICT', 'This import was already undone.');
        const removed = await db.tx(async (tx) => {
          const n = await tx.exec(`DELETE FROM transactions WHERE import_batch_id = $1 AND user_id = $2`, [params.id, auth.user.id]);
          await tx.exec(`UPDATE import_batches SET status = 'undone' WHERE id = $1`, [params.id]);
          return n;
        });
        return { ok: true, removed };
      },
    }),
  );
}
