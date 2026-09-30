import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams, isoDateSchema } from '@shared/schemas/common';
import { recurringCreateSchema, recurringUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { buildPatch } from '../../db/patch';
import { isUniqueViolation } from '../../db/index';
import { getUserPrefs } from '../../domain/prefs';
import { advanceAfter, computeNextDueDate, SELECT_RECURRING, type RecurringRow } from '../../domain/recurring';

async function assertReferences(db: FastifyInstance['db'], userId: string, body: { accountId: string; currency: string; toAccountId?: string | null; toCurrency?: string | null; categoryId?: string | null; type: string }) {
  const acc = await db.one<{ currency: string }>(`SELECT currency FROM accounts WHERE id = $1 AND user_id = $2`, [body.accountId, userId]);
  if (!acc) throw AppError.notFound('Account');
  if (acc.currency !== body.currency) throw new AppError('CURRENCY_MISMATCH');
  if (body.type === 'transfer' && body.toAccountId) {
    const to = await db.one<{ currency: string }>(`SELECT currency FROM accounts WHERE id = $1 AND user_id = $2`, [body.toAccountId, userId]);
    if (!to) throw AppError.notFound('Destination account');
    if (body.toCurrency && to.currency !== body.toCurrency) throw new AppError('CURRENCY_MISMATCH');
  }
  if (body.categoryId) {
    const cat = await db.one<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND user_id = $2`, [body.categoryId, userId]);
    if (!cat) throw AppError.notFound('Category');
    if (body.type !== 'transfer' && cat.kind !== body.type) throw AppError.validation([{ path: 'categoryId', message: 'validation.invalid_option' }]);
  }
}

export async function registerRecurringRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/recurring',
    defineRoute({
      query: z.object({ includeInactive: z.coerce.boolean().default(false) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const where = query.includeInactive ? 'r.user_id = $1' : 'r.user_id = $1 AND r.is_active';
        return { recurring: await db.query<RecurringRow>(`${SELECT_RECURRING} WHERE ${where} ORDER BY r.next_due_date NULLS LAST, r.name`, [auth.user.id]) };
      },
    }),
  );

  app.post(
    '/api/recurring',
    defineRoute({
      body: recurringCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        await assertReferences(db, auth.user.id, body);
        const prefs = await getUserPrefs(db, auth.user.id);
        // A rule that "started" in the past still gets scheduled from today onward — the first thing the
        // user should see is the NEXT upcoming occurrence, not a due date buried months in their history.
        const nextDueDate = computeNextDueDate({ ...body, endDate: body.endDate ?? null }, body.startDate > prefs.today ? body.startDate : prefs.today);
        try {
          const row = await db.one<{ id: string }>(
            `INSERT INTO recurring_transactions (user_id, name, type, account_id, currency, amount_minor, to_account_id, to_currency, to_amount_minor, category_id, merchant, description, frequency, interval_count, start_date, end_date, auto_confirm, next_due_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
            [
              auth.user.id, body.name, body.type, body.accountId, body.currency, body.amountMinor, body.toAccountId ?? null, body.toCurrency ?? null, body.toAmountMinor ?? null,
              body.categoryId ?? null, body.merchant ?? null, body.description ?? null, body.frequency, body.intervalCount, body.startDate, body.endDate ?? null, body.autoConfirm, nextDueDate,
            ],
          );
          return { recurring: await db.one<RecurringRow>(`${SELECT_RECURRING} WHERE r.id = $1`, [row!.id]) };
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'A recurring item with this name already exists.');
          throw e;
        }
      },
    }),
  );

  app.put(
    '/api/recurring/:id',
    defineRoute({
      params: idParams,
      body: recurringUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM recurring_transactions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Recurring item');
        await assertReferences(db, auth.user.id, body);
        const prefs = await getUserPrefs(db, auth.user.id);
        const nextDueDate = computeNextDueDate({ ...body, endDate: body.endDate ?? null }, body.startDate > prefs.today ? body.startDate : prefs.today);
        const patch = buildPatch(
          { ...body, nextDueDate },
          {
            name: 'name', type: 'type', accountId: 'account_id', currency: 'currency', amountMinor: 'amount_minor',
            toAccountId: 'to_account_id', toCurrency: 'to_currency', toAmountMinor: 'to_amount_minor', categoryId: 'category_id',
            merchant: 'merchant', description: 'description', frequency: 'frequency', intervalCount: 'interval_count',
            startDate: 'start_date', endDate: 'end_date', autoConfirm: 'auto_confirm', nextDueDate: 'next_due_date',
          },
        );
        if (patch) await db.exec(`UPDATE recurring_transactions SET ${patch.setSql} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, ...patch.values]);
        return { recurring: await db.one<RecurringRow>(`${SELECT_RECURRING} WHERE r.id = $1`, [params.id]) };
      },
    }),
  );

  app.delete(
    '/api/recurring/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM recurring_transactions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Recurring item');
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/recurring/:id/confirm',
    defineRoute({
      params: idParams,
      body: z.object({ occurredOn: isoDateSchema.optional(), amountMinor: z.number().int().positive().optional() }),
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const rule = await db.one<RecurringRow>(`${SELECT_RECURRING} WHERE r.id = $1 AND r.user_id = $2`, [params.id, auth.user.id]);
        if (!rule) throw AppError.notFound('Recurring item');
        const occurredOn = body.occurredOn ?? rule.nextDueDate ?? new Date().toISOString().slice(0, 10);
        const amountMinor = body.amountMinor ?? rule.amountMinor;

        const txId = await db.tx(async (tx) => {
          const tx1 = await tx.one<{ id: string }>(
            rule.type === 'transfer'
              ? `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, to_account_id, to_currency, to_amount_minor, description, occurred_on, is_recurring, recurring_id)
                 VALUES ($1,'transfer',$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING id`
              : `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, description, occurred_on, is_recurring, recurring_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING id`,
            rule.type === 'transfer'
              ? [auth.user.id, rule.accountId, rule.currency, amountMinor, rule.toAccountId, rule.toCurrency, rule.toAmountMinor, rule.description, occurredOn, rule.id]
              : [auth.user.id, rule.type, rule.accountId, rule.currency, amountMinor, rule.categoryId, rule.merchant, rule.description, occurredOn, rule.id],
          );
          const next = advanceAfter(rule, occurredOn);
          await tx.exec(`UPDATE recurring_transactions SET next_due_date = $2, last_posted_on = $3, is_active = ($2 IS NOT NULL) WHERE id = $1`, [rule.id, next, occurredOn]);
          return tx1!.id;
        });
        return { transactionId: txId, recurring: await db.one<RecurringRow>(`${SELECT_RECURRING} WHERE r.id = $1`, [params.id]) };
      },
    }),
  );

  app.post(
    '/api/recurring/:id/skip',
    defineRoute({
      params: idParams,
      body: z.object({ occurredOn: isoDateSchema.optional() }),
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const rule = await db.one<RecurringRow>(`${SELECT_RECURRING} WHERE r.id = $1 AND r.user_id = $2`, [params.id, auth.user.id]);
        if (!rule) throw AppError.notFound('Recurring item');
        const from = body.occurredOn ?? rule.nextDueDate ?? new Date().toISOString().slice(0, 10);
        const next = advanceAfter(rule, from);
        await db.exec(`UPDATE recurring_transactions SET next_due_date = $2, is_active = ($2 IS NOT NULL) WHERE id = $1 AND user_id = $3`, [params.id, next, auth.user.id]);
        return { recurring: await db.one<RecurringRow>(`${SELECT_RECURRING} WHERE r.id = $1`, [params.id]) };
      },
    }),
  );
}
