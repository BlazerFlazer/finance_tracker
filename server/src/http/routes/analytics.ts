import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERIOD_PRESETS, previousRange, resolvePeriod, startOfYear, addYears } from '@shared/dates';
import { defineRoute } from '../route';
import { requireVerified } from '../../auth/guard';
import { getUserPrefs } from '../../domain/prefs';
import { getRatesPerUsd } from '../../domain/rates';
import { amountByCategory, amountByMerchant, dailySpend, incomeExpenseByMonth, savingsSeries } from '../../domain/analytics';
import { computeNetWorth, netWorthOverTime } from '../../domain/networth';
import { computeAllBudgetProgress } from '../../domain/budgets';

const periodQuery = z.object({ period: z.enum(PERIOD_PRESETS).default('30d'), from: z.string().optional(), to: z.string().optional() });

export async function registerAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/analytics/overview',
    defineRoute({
      query: periodQuery,
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const range = resolvePeriod(query.period, prefs.today, query);
        const prior = previousRange(range);
        const rates = await getRatesPerUsd(db);

        const [flow, priorFlow, spendingByCategory, incomeByCategory, topMerchants, heatmap, netWorth, netWorthTrend, budgets] = await Promise.all([
          incomeExpenseByMonth(db, auth.user.id, range, prefs.mainCurrency, rates),
          incomeExpenseByMonth(db, auth.user.id, prior, prefs.mainCurrency, rates),
          amountByCategory(db, auth.user.id, range, prefs.mainCurrency, rates, 'expense'),
          amountByCategory(db, auth.user.id, range, prefs.mainCurrency, rates, 'income'),
          amountByMerchant(db, auth.user.id, range, prefs.mainCurrency, rates, 10),
          dailySpend(db, auth.user.id, range, prefs.mainCurrency, rates),
          computeNetWorth(db, auth.user.id, prefs.mainCurrency, rates),
          netWorthOverTime(db, auth.user.id, prefs.mainCurrency, rates, range.from, range.to),
          computeAllBudgetProgress(db, auth.user.id, prefs.weekStart, prefs.timezone),
        ]);

        const totals = flow.reduce((a, f) => ({ income: a.income + f.incomeMinor, expense: a.expense + f.expenseMinor, net: a.net + f.netMinor }), { income: 0, expense: 0, net: 0 });
        const priorTotals = priorFlow.reduce((a, f) => ({ income: a.income + f.incomeMinor, expense: a.expense + f.expenseMinor, net: a.net + f.netMinor }), { income: 0, expense: 0, net: 0 });

        return {
          currency: prefs.mainCurrency,
          range,
          totals,
          priorRange: prior,
          priorTotals,
          incomeExpenseByMonth: flow,
          savingsByMonth: savingsSeries(flow),
          spendingByCategory,
          incomeByCategory,
          topMerchants,
          spendingHeatmap: heatmap,
          netWorth,
          netWorthTrend,
          budgetPerformance: budgets,
        };
      },
    }),
  );

  app.get(
    '/api/analytics/compare',
    defineRoute({
      query: z.object({ mode: z.enum(['month', 'year']).default('month') }),
      handler: async ({ query, req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const rates = await getRatesPerUsd(db);
        const currentRange = query.mode === 'month' ? { from: `${prefs.today.slice(0, 7)}-01`, to: prefs.today } : { from: startOfYear(prefs.today), to: prefs.today };
        // "Same point last month/year": an equal-length preceding window for month mode, the same calendar
        // range shifted back exactly one year for year mode (so partial-year comparisons stay fair).
        const priorRange = query.mode === 'month' ? previousRange(currentRange) : { from: addYears(currentRange.from, -1), to: addYears(currentRange.to, -1) };
        const [current, prior] = await Promise.all([
          incomeExpenseByMonth(db, auth.user.id, currentRange, prefs.mainCurrency, rates),
          incomeExpenseByMonth(db, auth.user.id, priorRange, prefs.mainCurrency, rates),
        ]);
        const sum = (rows: { incomeMinor: number; expenseMinor: number; netMinor: number }[]) =>
          rows.reduce((a, f) => ({ incomeMinor: a.incomeMinor + f.incomeMinor, expenseMinor: a.expenseMinor + f.expenseMinor, netMinor: a.netMinor + f.netMinor }), { incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
        return { currency: prefs.mainCurrency, current: sum(current), previous: sum(prior) };
      },
    }),
  );
}
