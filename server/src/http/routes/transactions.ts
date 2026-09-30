import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { idParams } from '@shared/schemas/common';
import { transactionCreateSchema, transactionListQuery, transactionUpdateSchema, type TransactionCreateInput } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import type { Queryable } from '../../db/index';
import { config } from '../../config';

const BASE_FIELDS = `t.id, t.type, t.account_id AS "accountId", t.currency, t.amount_minor AS "amountMinor",
  t.category_id AS "categoryId", t.merchant, t.description, t.occurred_on AS "occurredOn", t.occurred_time AS "occurredTime",
  t.is_recurring AS "isRecurring", t.recurring_id AS "recurringId", t.subscription_id AS "subscriptionId", t.debt_id AS "debtId",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt",
  a.name AS "accountName", a.color AS "accountColor",
  c.name AS "categoryName", c.system_key AS "categorySystemKey", c.icon AS "categoryIcon", c.color AS "categoryColor"`;
const BASE_FROM = `FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id`;

interface TxRow {
  id: string;
  type: string;
  accountId: string;
  currency: string;
  amountMinor: number;
  categoryId: string | null;
  merchant: string | null;
  description: string | null;
  occurredOn: string;
  occurredTime: string | null;
  accountName: string;
  categoryName: string | null;
}

async function attachExtras(db: Queryable, userId: string, rows: TxRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  // `ids` already comes from a query scoped to `userId`, but every sub-query re-checks user_id anyway —
  // defense in depth against a future caller that forgets to scope its own `rows`.
  const [splits, tags, attachments] = await Promise.all([
    db.query<{ id: string; transactionId: string; categoryId: string; amountMinor: number; note: string | null; categoryName: string | null; icon: string; color: string }>(
      `SELECT s.id, s.transaction_id AS "transactionId", s.category_id AS "categoryId", s.amount_minor AS "amountMinor", s.note,
              c.name AS "categoryName", c.system_key AS "categorySystemKey", c.icon, c.color
       FROM transaction_splits s JOIN categories c ON c.id = s.category_id WHERE s.transaction_id = ANY($1) AND s.user_id = $2 ORDER BY s.sort_order`,
      [ids, userId],
    ),
    db.query<{ transactionId: string; id: string; name: string }>(
      `SELECT tt.transaction_id AS "transactionId", tg.id, tg.name FROM transaction_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.transaction_id = ANY($1) AND tt.user_id = $2`,
      [ids, userId],
    ),
    db.query<{ id: string; transactionId: string; filename: string; mimeType: string; sizeBytes: number }>(
      `SELECT id, transaction_id AS "transactionId", filename, mime_type AS "mimeType", size_bytes AS "sizeBytes" FROM attachments WHERE transaction_id = ANY($1) AND user_id = $2`,
      [ids, userId],
    ),
  ]);
  return rows.map((r) => ({
    ...r,
    splits: splits.filter((s) => s.transactionId === r.id).map(({ transactionId: _t, ...s }) => s),
    tags: tags.filter((t) => t.transactionId === r.id).map(({ transactionId: _t, ...t }) => t),
    attachments: attachments.filter((a) => a.transactionId === r.id).map(({ transactionId: _t, ...a }) => a),
  }));
}

async function assertCategoryUsable(db: Queryable, userId: string, categoryId: string, kind: 'expense' | 'income') {
  const cat = await db.one<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND user_id = $2`, [categoryId, userId]);
  if (!cat) throw AppError.notFound('Category');
  if (cat.kind !== kind) throw AppError.validation([{ path: 'categoryId', message: 'validation.invalid_option' }]);
}

async function assertAccountCurrency(db: Queryable, userId: string, accountId: string, currency: string) {
  const acc = await db.one<{ currency: string }>(`SELECT currency FROM accounts WHERE id = $1 AND user_id = $2`, [accountId, userId]);
  if (!acc) throw AppError.notFound('Account');
  if (acc.currency !== currency) throw new AppError('CURRENCY_MISMATCH');
}

async function writeSplitsAndTags(db: Queryable, userId: string, transactionId: string, input: TransactionCreateInput) {
  await db.exec(`DELETE FROM transaction_splits WHERE transaction_id = $1`, [transactionId]);
  if (input.splits?.length) {
    let order = 0;
    for (const s of input.splits) {
      await assertCategoryUsable(db, userId, s.categoryId, input.type);
      await db.exec(`INSERT INTO transaction_splits (transaction_id, user_id, category_id, amount_minor, note, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`, [
        transactionId, userId, s.categoryId, s.amountMinor, s.note ?? null, order++,
      ]);
    }
  }
  await db.exec(`DELETE FROM transaction_tags WHERE transaction_id = $1`, [transactionId]);
  for (const tagId of input.tagIds) {
    const tag = await db.one(`SELECT 1 FROM tags WHERE id = $1 AND user_id = $2`, [tagId, userId]);
    if (!tag) throw AppError.notFound('Tag');
    await db.exec(`INSERT INTO transaction_tags (transaction_id, tag_id, user_id) VALUES ($1,$2,$3)`, [transactionId, tagId, userId]);
  }
}

export async function registerTransactionRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/transactions',
    defineRoute({
      query: transactionListQuery,
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const where: string[] = ['t.user_id = $1'];
        const params: unknown[] = [auth.user.id];
        const add = (sql: string, value: unknown) => {
          params.push(value);
          where.push(sql.replace('?', `$${params.length}`));
        };
        if (query.from) add('t.occurred_on >= ?', query.from);
        if (query.to) add('t.occurred_on <= ?', query.to);
        if (query.type) add('t.type = ?', query.type);
        if (query.accountId) {
          params.push(query.accountId);
          where.push(`(t.account_id = $${params.length} OR t.to_account_id = $${params.length})`);
        }
        if (query.categoryId) {
          params.push(query.categoryId);
          where.push(`(t.category_id = $${params.length} OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id AND s.category_id = $${params.length}))`);
        }
        if (query.tagId) {
          params.push(query.tagId);
          where.push(`EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = $${params.length})`);
        }
        if (query.merchant) add('t.merchant ILIKE ?', `%${query.merchant}%`);
        if (query.minAmountMinor !== undefined) add('t.amount_minor >= ?', query.minAmountMinor);
        if (query.maxAmountMinor !== undefined) add('t.amount_minor <= ?', query.maxAmountMinor);
        if (query.search) {
          params.push(`%${query.search}%`);
          where.push(`(t.merchant ILIKE $${params.length} OR t.description ILIKE $${params.length} OR c.name ILIKE $${params.length} OR a.name ILIKE $${params.length})`);
        }
        const orderBy = { date_desc: 't.occurred_on DESC, t.occurred_time DESC NULLS LAST, t.created_at DESC', date_asc: 't.occurred_on ASC, t.occurred_time ASC NULLS FIRST, t.created_at ASC', amount_desc: 't.amount_minor DESC', amount_asc: 't.amount_minor ASC' }[query.sort];

        const [rows, total] = await Promise.all([
          db.query<TxRow>(`SELECT ${BASE_FIELDS} ${BASE_FROM} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [
            ...params, query.pageSize, (query.page - 1) * query.pageSize,
          ]),
          db.one<{ n: number }>(`SELECT COUNT(*)::int AS n ${BASE_FROM} WHERE ${where.join(' AND ')}`, params),
        ]);
        return { transactions: await attachExtras(db, auth.user.id, rows), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
      },
    }),
  );

  app.get(
    '/api/transactions/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const row = await db.one<TxRow>(`SELECT ${BASE_FIELDS} ${BASE_FROM} WHERE t.id = $1 AND t.user_id = $2`, [params.id, auth.user.id]);
        if (!row) throw AppError.notFound('Transaction');
        return { transaction: (await attachExtras(db, auth.user.id, [row]))[0] };
      },
    }),
  );

  app.post(
    '/api/transactions',
    defineRoute({
      body: transactionCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        await assertAccountCurrency(db, auth.user.id, body.accountId, body.currency);
        await assertCategoryUsable(db, auth.user.id, body.categoryId, body.type);
        const id = await db.tx(async (tx) => {
          const row = await tx.one<{ id: string }>(
            `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, description, occurred_on, occurred_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [auth.user.id, body.type, body.accountId, body.currency, body.amountMinor, body.categoryId, body.merchant ?? null, body.description ?? null, body.occurredOn, body.occurredTime ?? null],
          );
          await writeSplitsAndTags(tx, auth.user.id, row!.id, body);
          return row!.id;
        });
        const full = await db.one<TxRow>(`SELECT ${BASE_FIELDS} ${BASE_FROM} WHERE t.id = $1`, [id]);
        return { transaction: (await attachExtras(db, auth.user.id, [full!]))[0] };
      },
    }),
  );

  app.put(
    '/api/transactions/:id',
    defineRoute({
      params: idParams,
      body: transactionUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM transactions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Transaction');
        await assertAccountCurrency(db, auth.user.id, body.accountId, body.currency);
        await assertCategoryUsable(db, auth.user.id, body.categoryId, body.type);
        await db.tx(async (tx) => {
          await tx.exec(
            `UPDATE transactions SET type=$3, account_id=$4, currency=$5, amount_minor=$6, category_id=$7, merchant=$8, description=$9, occurred_on=$10, occurred_time=$11
             WHERE id = $1 AND user_id = $2`,
            [params.id, auth.user.id, body.type, body.accountId, body.currency, body.amountMinor, body.categoryId, body.merchant ?? null, body.description ?? null, body.occurredOn, body.occurredTime ?? null],
          );
          await writeSplitsAndTags(tx, auth.user.id, params.id, body);
        });
        const full = await db.one<TxRow>(`SELECT ${BASE_FIELDS} ${BASE_FROM} WHERE t.id = $1`, [params.id]);
        return { transaction: (await attachExtras(db, auth.user.id, [full!]))[0] };
      },
    }),
  );

  app.delete(
    '/api/transactions/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const files = await db.query<{ storageKey: string }>(`SELECT storage_key AS "storageKey" FROM attachments WHERE transaction_id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        const result = await db.exec(`DELETE FROM transactions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Transaction');
        await Promise.all(files.map((f) => fs.unlink(path.join(config.uploadDir, f.storageKey)).catch(() => {})));
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/transactions/:id/duplicate',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const src = await db.one<TxRow & { type: 'income' | 'expense' }>(`SELECT ${BASE_FIELDS} ${BASE_FROM} WHERE t.id = $1 AND t.user_id = $2`, [params.id, auth.user.id]);
        if (!src) throw AppError.notFound('Transaction');
        if ((src as unknown as { type: string }).type === 'transfer') throw new AppError('CONFLICT', 'Transfers cannot be duplicated here — create a new transfer instead.');
        const today = new Date().toISOString().slice(0, 10);
        const id = await db.tx(async (tx) => {
          const row = await tx.one<{ id: string }>(
            `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, description, occurred_on)
             SELECT user_id, type, account_id, currency, amount_minor, category_id, merchant, description, $2 FROM transactions WHERE id = $1 RETURNING id`,
            [params.id, today],
          );
          await tx.exec(
            `INSERT INTO transaction_splits (transaction_id, user_id, category_id, amount_minor, note, sort_order) SELECT $2, user_id, category_id, amount_minor, note, sort_order FROM transaction_splits WHERE transaction_id = $1`,
            [params.id, row!.id],
          );
          await tx.exec(`INSERT INTO transaction_tags (transaction_id, tag_id, user_id) SELECT $2, tag_id, user_id FROM transaction_tags WHERE transaction_id = $1`, [params.id, row!.id]);
          return row!.id;
        });
        const full = await db.one<TxRow>(`SELECT ${BASE_FIELDS} ${BASE_FROM} WHERE t.id = $1`, [id]);
        return { transaction: (await attachExtras(db, auth.user.id, [full!]))[0] };
      },
    }),
  );

  // ---------------------------------------------------------------------------------------------------- tags
  app.get(
    '/api/tags',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        return { tags: await db.query(`SELECT id, name FROM tags WHERE user_id = $1 ORDER BY name`, [auth.user.id]) };
      },
    }),
  );
}
