import type { FastifyInstance } from 'fastify';
import { addDays } from '@shared/dates';
import { cycleToRule, monthlyEquivalent, yearlyEquivalent } from '@shared/recurrence';
import { idParams } from '@shared/schemas/common';
import { subscriptionCreateSchema, subscriptionUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { buildPatch } from '../../db/patch';
import { isUniqueViolation } from '../../db/index';
import { getUserPrefs } from '../../domain/prefs';

interface SubRow {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingCycle: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
  nextPaymentDate: string;
  startedOn: string | null;
  categoryId: string | null;
  accountId: string | null;
  status: 'active' | 'paused' | 'cancelled';
  autoRecord: boolean;
  reminderDays: number;
  lastUsedOn: string | null;
  url: string | null;
  notes: string | null;
}

const SELECT = `SELECT id, name, price_minor AS "priceMinor", currency, billing_cycle AS "billingCycle", next_payment_date AS "nextPaymentDate",
  started_on AS "startedOn", category_id AS "categoryId", account_id AS "accountId", status, auto_record AS "autoRecord",
  reminder_days AS "reminderDays", last_used_on AS "lastUsedOn", url, notes FROM subscriptions`;

function withCost<T extends { priceMinor: number; billingCycle: SubRow['billingCycle'] }>(s: T) {
  const rule = cycleToRule(s.billingCycle);
  return { ...s, monthlyCostMinor: monthlyEquivalent(s.priceMinor, rule.frequency, rule.intervalCount), yearlyCostMinor: yearlyEquivalent(s.priceMinor, rule.frequency, rule.intervalCount) };
}

export async function registerSubscriptionRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/subscriptions',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const rows = await db.query<SubRow>(`${SELECT} WHERE user_id = $1 ORDER BY (status = 'active') DESC, next_payment_date`, [auth.user.id]);
        const withCosts = rows.map(withCost);
        const totals = withCosts.filter((s) => s.status === 'active').reduce((acc, s) => ({ monthly: acc.monthly + s.monthlyCostMinor, yearly: acc.yearly + s.yearlyCostMinor }), { monthly: 0, yearly: 0 });
        return { subscriptions: withCosts, totalMonthlyCostMinor: totals.monthly, totalYearlyCostMinor: totals.yearly };
      },
    }),
  );

  app.get(
    '/api/subscriptions/audit',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const rows = (await db.query<SubRow>(`${SELECT} WHERE user_id = $1 AND status = 'active'`, [auth.user.id])).map(withCost);
        const upcomingRenewals = rows.filter((s) => s.nextPaymentDate <= addDays(prefs.today, 7)).sort((a, b) => a.nextPaymentDate.localeCompare(b.nextPaymentDate));
        const monthlyValues = rows.map((s) => s.monthlyCostMinor).sort((a, b) => a - b);
        const median = monthlyValues.length ? monthlyValues[Math.floor(monthlyValues.length / 2)]! : 0;
        const highRecurringCost = rows.length >= 3 ? rows.filter((s) => s.monthlyCostMinor > median * 1.5 && s.monthlyCostMinor > 0).sort((a, b) => b.monthlyCostMinor - a.monthlyCostMinor) : [];
        // Only flagged when the user themselves recorded a last-used date and it is genuinely stale —
        // we never guess usage from silence, per the "don't claim what we can't verify" rule.
        const potentiallyUnused = rows.filter((s) => s.lastUsedOn && s.lastUsedOn < addDays(prefs.today, -60));
        return { upcomingRenewals, highRecurringCost, potentiallyUnused };
      },
    }),
  );

  app.post(
    '/api/subscriptions',
    defineRoute({
      body: subscriptionCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        if (body.categoryId) {
          const cat = await db.one<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND user_id = $2`, [body.categoryId, auth.user.id]);
          if (!cat) throw AppError.notFound('Category');
        }
        if (body.accountId && !(await db.one(`SELECT 1 FROM accounts WHERE id = $1 AND user_id = $2`, [body.accountId, auth.user.id]))) throw AppError.notFound('Account');
        try {
          const row = await db.one<SubRow>(
            `INSERT INTO subscriptions (user_id, name, price_minor, currency, billing_cycle, next_payment_date, started_on, category_id, account_id, auto_record, reminder_days, url, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id, name, price_minor AS "priceMinor", currency, billing_cycle AS "billingCycle", next_payment_date AS "nextPaymentDate",
                       started_on AS "startedOn", category_id AS "categoryId", account_id AS "accountId", status, auto_record AS "autoRecord",
                       reminder_days AS "reminderDays", last_used_on AS "lastUsedOn", url, notes`,
            [auth.user.id, body.name, body.priceMinor, body.currency, body.billingCycle, body.nextPaymentDate, body.startedOn ?? null, body.categoryId ?? null, body.accountId ?? null, body.autoRecord, body.reminderDays, body.url ?? null, body.notes ?? null],
          );
          return { subscription: withCost(row!) };
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'A subscription with this name already exists.');
          throw e;
        }
      },
    }),
  );

  app.patch(
    '/api/subscriptions/:id',
    defineRoute({
      params: idParams,
      body: subscriptionUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM subscriptions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Subscription');
        const patch = buildPatch(body, {
          name: 'name', priceMinor: 'price_minor', currency: 'currency', billingCycle: 'billing_cycle', nextPaymentDate: 'next_payment_date',
          startedOn: 'started_on', categoryId: 'category_id', accountId: 'account_id', autoRecord: 'auto_record', reminderDays: 'reminder_days',
          url: 'url', notes: 'notes', status: 'status',
        });
        if (patch) {
          const setSql = body.status === 'cancelled' ? `${patch.setSql}, cancelled_on = COALESCE(cancelled_on, CURRENT_DATE)` : patch.setSql;
          await db.exec(`UPDATE subscriptions SET ${setSql} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, ...patch.values]);
        }
        const row = await db.one<SubRow>(`${SELECT} WHERE id = $1`, [params.id]);
        return { subscription: withCost(row!) };
      },
    }),
  );

  app.delete(
    '/api/subscriptions/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM subscriptions WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Subscription');
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/subscriptions/:id/mark-used',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const result = await db.exec(`UPDATE subscriptions SET last_used_on = $3 WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, prefs.today]);
        if (result === 0) throw AppError.notFound('Subscription');
        return { ok: true };
      },
    }),
  );
}
