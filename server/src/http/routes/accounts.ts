import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParams } from '@shared/schemas/common';
import { accountCreateSchema, accountUpdateSchema, transferSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { isForeignKeyViolation, isUniqueViolation } from '../../db/index';
import { buildPatch } from '../../db/patch';

const SELECT = `SELECT a.id, a.name, a.type, a.currency, a.institution, a.opening_balance_minor AS "openingBalanceMinor",
  a.credit_limit_minor AS "creditLimitMinor", a.low_balance_threshold_minor AS "lowBalanceThresholdMinor",
  a.color, a.icon, a.include_in_net_worth AS "includeInNetWorth", a.is_archived AS "isArchived", a.sort_order AS "sortOrder",
  a.notes, a.created_at AS "createdAt", COALESCE(b.balance_minor, a.opening_balance_minor) AS "balanceMinor"
  FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id`;

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/accounts',
    defineRoute({
      query: z.object({ includeArchived: z.coerce.boolean().default(false) }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const where = query.includeArchived ? 'a.user_id = $1' : 'a.user_id = $1 AND NOT a.is_archived';
        return { accounts: await db.query(`${SELECT} WHERE ${where} ORDER BY a.sort_order, a.created_at`, [auth.user.id]) };
      },
    }),
  );

  app.post(
    '/api/accounts',
    defineRoute({
      body: accountCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        try {
          const row = await db.one<{ id: string }>(
            `INSERT INTO accounts (user_id, name, type, currency, institution, opening_balance_minor, credit_limit_minor, low_balance_threshold_minor, color, icon, include_in_net_worth, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [
              auth.user.id, body.name, body.type, body.currency, body.institution ?? null, body.openingBalanceMinor,
              body.creditLimitMinor ?? null, body.lowBalanceThresholdMinor ?? null, body.color, body.icon ?? null, body.includeInNetWorth, body.notes ?? null,
            ],
          );
          const account = await db.one(`${SELECT} WHERE a.id = $1`, [row!.id]);
          return { account };
        } catch (e) {
          if (isUniqueViolation(e, 'accounts_user_name_key')) throw new AppError('CONFLICT', 'An account with this name already exists.');
          throw e;
        }
      },
    }),
  );

  app.patch(
    '/api/accounts/:id',
    defineRoute({
      params: idParams,
      body: accountUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM accounts WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Account');
        const patch = buildPatch(body, {
          name: 'name', type: 'type', institution: 'institution', openingBalanceMinor: 'opening_balance_minor',
          creditLimitMinor: 'credit_limit_minor', lowBalanceThresholdMinor: 'low_balance_threshold_minor',
          color: 'color', icon: 'icon', includeInNetWorth: 'include_in_net_worth', notes: 'notes',
          isArchived: 'is_archived', sortOrder: 'sort_order',
        });
        try {
          if (patch) await db.exec(`UPDATE accounts SET ${patch.setSql} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, ...patch.values]);
          return { account: await db.one(`${SELECT} WHERE a.id = $1`, [params.id]) };
        } catch (e) {
          if (isUniqueViolation(e, 'accounts_user_name_key')) throw new AppError('CONFLICT', 'An account with this name already exists.');
          throw e;
        }
      },
    }),
  );

  app.delete(
    '/api/accounts/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM accounts WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Account');
        try {
          await db.exec(`DELETE FROM accounts WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
          return { ok: true };
        } catch (e) {
          if (isForeignKeyViolation(e)) throw new AppError('ACCOUNT_HAS_TRANSACTIONS');
          throw e;
        }
      },
    }),
  );

  app.post(
    '/api/accounts/transfer',
    defineRoute({
      body: transferSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        if (body.fromAccountId === body.toAccountId) throw AppError.validation([{ path: 'toAccountId', message: 'validation.same_account' }]);
        const [from, to] = await Promise.all([
          db.one<{ currency: string }>(`SELECT currency FROM accounts WHERE id = $1 AND user_id = $2`, [body.fromAccountId, auth.user.id]),
          db.one<{ currency: string }>(`SELECT currency FROM accounts WHERE id = $1 AND user_id = $2`, [body.toAccountId, auth.user.id]),
        ]);
        if (!from) throw AppError.notFound('Source account');
        if (!to) throw AppError.notFound('Destination account');
        const sameCurrency = from.currency === to.currency;
        const toAmountMinor = body.toAmountMinor ?? (sameCurrency ? body.amountMinor : undefined);
        if (!toAmountMinor) throw AppError.validation([{ path: 'toAmountMinor', message: 'validation.required' }]);

        const row = await db.one<{ id: string }>(
          `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, to_account_id, to_currency, to_amount_minor, description, occurred_on)
           VALUES ($1,'transfer',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [auth.user.id, body.fromAccountId, from.currency, body.amountMinor, body.toAccountId, to.currency, toAmountMinor, body.description ?? null, body.occurredOn],
        );
        return { transactionId: row!.id };
      },
    }),
  );
}
