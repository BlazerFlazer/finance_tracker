import type { FastifyInstance } from 'fastify';
import { simulateDebtPayoff } from '@shared/calc';
import { idParams } from '@shared/schemas/common';
import { debtCreateSchema, debtPaymentSchema, debtUpdateSchema, payoffSimulationSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { buildPatch } from '../../db/patch';
import { isUniqueViolation } from '../../db/index';
import { getUserPrefs } from '../../domain/prefs';

interface DebtRow {
  id: string;
  name: string;
  creditor: string | null;
  kind: string;
  currency: string;
  originalMinor: number;
  remainingMinor: number;
  interestRate: number;
  minPaymentMinor: number;
  dueDay: number | null;
  finalDueDate: string | null;
  startDate: string | null;
  status: 'active' | 'paid_off' | 'archived';
  notes: string | null;
}

const SELECT = `SELECT id, name, creditor, kind, currency, original_minor AS "originalMinor", remaining_minor AS "remainingMinor",
  interest_rate AS "interestRate", min_payment_minor AS "minPaymentMinor", due_day AS "dueDay", final_due_date AS "finalDueDate",
  start_date AS "startDate", status, notes FROM debts`;

export async function registerDebtRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/debts',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const rows = await db.query<DebtRow>(`${SELECT} WHERE user_id = $1 ORDER BY (status = 'active') DESC, remaining_minor DESC`, [auth.user.id]);
        const active = rows.filter((d) => d.status === 'active');
        return {
          debts: rows,
          totalOriginalMinor: active.reduce((s, d) => s + d.originalMinor, 0),
          totalRemainingMinor: active.reduce((s, d) => s + d.remainingMinor, 0),
          totalMonthlyPaymentsMinor: active.reduce((s, d) => s + d.minPaymentMinor, 0),
        };
      },
    }),
  );

  app.get(
    '/api/debts/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const debt = await db.one<DebtRow>(`${SELECT} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!debt) throw AppError.notFound('Debt');
        const payments = await db.query(
          `SELECT id, amount_minor AS "amountMinor", principal_minor AS "principalMinor", interest_minor AS "interestMinor", paid_on AS "paidOn", note
           FROM debt_payments WHERE debt_id = $1 AND user_id = $2 ORDER BY paid_on DESC, created_at DESC`,
          [params.id, auth.user.id],
        );
        return { debt, payments };
      },
    }),
  );

  app.post(
    '/api/debts',
    defineRoute({
      body: debtCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        try {
          const debt = await db.one<DebtRow>(
            `INSERT INTO debts (user_id, name, creditor, kind, currency, original_minor, remaining_minor, interest_rate, min_payment_minor, due_day, final_due_date, start_date, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id, name, creditor, kind, currency, original_minor AS "originalMinor", remaining_minor AS "remainingMinor",
                       interest_rate AS "interestRate", min_payment_minor AS "minPaymentMinor", due_day AS "dueDay",
                       final_due_date AS "finalDueDate", start_date AS "startDate", status, notes`,
            [auth.user.id, body.name, body.creditor ?? null, body.kind, body.currency, body.originalMinor, body.remainingMinor, body.interestRate, body.minPaymentMinor, body.dueDay ?? null, body.finalDueDate ?? null, body.startDate ?? null, body.notes ?? null],
          );
          return { debt };
        } catch (e) {
          if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'A debt with this name already exists.');
          throw e;
        }
      },
    }),
  );

  app.patch(
    '/api/debts/:id',
    defineRoute({
      params: idParams,
      body: debtUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM debts WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Debt');
        const patch = buildPatch(body, {
          name: 'name', creditor: 'creditor', kind: 'kind', originalMinor: 'original_minor', remainingMinor: 'remaining_minor',
          interestRate: 'interest_rate', minPaymentMinor: 'min_payment_minor', dueDay: 'due_day', finalDueDate: 'final_due_date',
          startDate: 'start_date', notes: 'notes', status: 'status',
        });
        if (patch) {
          const setSql = body.status === 'paid_off' ? `${patch.setSql}, paid_off_at = COALESCE(paid_off_at, now())` : patch.setSql;
          await db.exec(`UPDATE debts SET ${setSql} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, ...patch.values]);
        }
        const debt = await db.one<DebtRow>(`${SELECT} WHERE id = $1`, [params.id]);
        return { debt };
      },
    }),
  );

  app.delete(
    '/api/debts/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM debts WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Debt');
        return { ok: true };
      },
    }),
  );

  app.post(
    '/api/debts/:id/payments',
    defineRoute({
      params: idParams,
      body: debtPaymentSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const debt = await db.one<{ remainingMinor: number }>(`SELECT remaining_minor AS "remainingMinor" FROM debts WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!debt) throw AppError.notFound('Debt');
        const newRemaining = Math.max(0, debt.remainingMinor - body.principalMinor);
        await db.tx(async (tx) => {
          await tx.exec(`INSERT INTO debt_payments (debt_id, user_id, amount_minor, principal_minor, interest_minor, paid_on, note) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
            params.id, auth.user.id, body.amountMinor, body.principalMinor, body.interestMinor, body.paidOn, body.note ?? null,
          ]);
          await tx.exec(
            `UPDATE debts SET remaining_minor = $3, status = CASE WHEN $3 <= 0 THEN 'paid_off' ELSE status END, paid_off_at = CASE WHEN $3 <= 0 THEN now() ELSE paid_off_at END
             WHERE id = $1 AND user_id = $2`,
            [params.id, auth.user.id, newRemaining],
          );
        });
        const updated = await db.one<DebtRow>(`${SELECT} WHERE id = $1`, [params.id]);
        return { debt: updated };
      },
    }),
  );

  app.post(
    '/api/debts/payoff-calculator',
    defineRoute({
      body: payoffSimulationSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const debts = await db.query<DebtRow>(`${SELECT} WHERE user_id = $1 AND status = 'active'`, [auth.user.id]);
        if (debts.length === 0) return { results: [] };
        const byCurrency = new Map<string, DebtRow[]>();
        for (const d of debts) byCurrency.set(d.currency, [...(byCurrency.get(d.currency) ?? []), d]);
        const results = [...byCurrency.entries()].map(([currency, group]) => ({
          currency,
          ...simulateDebtPayoff(
            group.map((d) => ({ id: d.id, name: d.name, balanceMinor: d.remainingMinor, aprPercent: d.interestRate, minPaymentMinor: d.minPaymentMinor })),
            { strategy: body.strategy, extraMonthlyMinor: body.extraMonthlyMinor, customOrder: body.customOrder, startDate: prefs.today },
          ),
        }));
        return { results };
      },
    }),
  );
}
