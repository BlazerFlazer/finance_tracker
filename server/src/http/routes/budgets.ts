import type { FastifyInstance } from 'fastify';
import { idParams } from '@shared/schemas/common';
import { budgetCreateSchema, budgetUpdateSchema } from '@shared/schemas/domain';
import { defineRoute } from '../route';
import { AppError } from '../../errors';
import { requireVerified } from '../../auth/guard';
import { buildPatch } from '../../db/patch';
import { isUniqueViolation, type Queryable } from '../../db/index';
import { computeAllBudgetProgress, computeBudgetProgress, type BudgetRow } from '../../domain/budgets';
import { getUserPrefs } from '../../domain/prefs';

async function writeItems(db: Queryable, userId: string, budgetId: string, items: { categoryId: string; amountMinor: number }[]) {
  await db.exec(`DELETE FROM budget_items WHERE budget_id = $1`, [budgetId]);
  for (const item of items) {
    const cat = await db.one<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND user_id = $2`, [item.categoryId, userId]);
    if (!cat) throw AppError.notFound('Category');
    if (cat.kind !== 'expense') throw AppError.validation([{ path: 'items.categoryId', message: 'validation.invalid_option' }]);
    await db.exec(`INSERT INTO budget_items (budget_id, user_id, category_id, amount_minor) VALUES ($1,$2,$3,$4)`, [budgetId, userId, item.categoryId, item.amountMinor]);
  }
}

export async function registerBudgetRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/budgets',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        return { budgets: await computeAllBudgetProgress(db, auth.user.id, prefs.weekStart, prefs.timezone, false) };
      },
    }),
  );

  app.get(
    '/api/budgets/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const budget = await db.one<BudgetRow>(
          `SELECT id, name, period, currency, notice_pct AS "noticePct", warning_pct AS "warningPct", is_active AS "isActive" FROM budgets WHERE id = $1 AND user_id = $2`,
          [params.id, auth.user.id],
        );
        if (!budget) throw AppError.notFound('Budget');
        const prefs = await getUserPrefs(db, auth.user.id);
        return { budget: await computeBudgetProgress(db, auth.user.id, budget, prefs.weekStart, prefs.today) };
      },
    }),
  );

  app.post(
    '/api/budgets',
    defineRoute({
      body: budgetCreateSchema,
      handler: async ({ body, req }) => {
        const auth = requireVerified(req);
        const budget = await db.tx(async (tx) => {
          let row: { id: string };
          try {
            row = (await tx.one<{ id: string }>(
              `INSERT INTO budgets (user_id, name, period, currency, notice_pct, warning_pct) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
              [auth.user.id, body.name, body.period, body.currency, body.noticePct, body.warningPct],
            ))!;
          } catch (e) {
            if (isUniqueViolation(e)) throw new AppError('CONFLICT', 'A budget with this name already exists.');
            throw e;
          }
          await writeItems(tx, auth.user.id, row.id, body.items);
          return row;
        });
        const full = await db.one<BudgetRow>(`SELECT id, name, period, currency, notice_pct AS "noticePct", warning_pct AS "warningPct", is_active AS "isActive" FROM budgets WHERE id = $1`, [budget.id]);
        const prefs = await getUserPrefs(db, auth.user.id);
        return { budget: await computeBudgetProgress(db, auth.user.id, full!, prefs.weekStart, prefs.today) };
      },
    }),
  );

  app.patch(
    '/api/budgets/:id',
    defineRoute({
      params: idParams,
      body: budgetUpdateSchema,
      handler: async ({ params, body, req }) => {
        const auth = requireVerified(req);
        const existing = await db.one(`SELECT id FROM budgets WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (!existing) throw AppError.notFound('Budget');
        const { items, ...rest } = body;
        await db.tx(async (tx) => {
          const patch = buildPatch(rest, { name: 'name', period: 'period', currency: 'currency', noticePct: 'notice_pct', warningPct: 'warning_pct', isActive: 'is_active' });
          if (patch) await tx.exec(`UPDATE budgets SET ${patch.setSql} WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id, ...patch.values]);
          if (items) await writeItems(tx, auth.user.id, params.id, items);
        });
        const full = await db.one<BudgetRow>(`SELECT id, name, period, currency, notice_pct AS "noticePct", warning_pct AS "warningPct", is_active AS "isActive" FROM budgets WHERE id = $1`, [params.id]);
        const prefs = await getUserPrefs(db, auth.user.id);
        return { budget: await computeBudgetProgress(db, auth.user.id, full!, prefs.weekStart, prefs.today) };
      },
    }),
  );

  app.delete(
    '/api/budgets/:id',
    defineRoute({
      params: idParams,
      handler: async ({ params, req }) => {
        const auth = requireVerified(req);
        const result = await db.exec(`DELETE FROM budgets WHERE id = $1 AND user_id = $2`, [params.id, auth.user.id]);
        if (result === 0) throw AppError.notFound('Budget');
        return { ok: true };
      },
    }),
  );
}
