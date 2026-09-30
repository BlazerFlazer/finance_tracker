import type { FastifyInstance } from 'fastify';
import { addDays, monthRange, previousRange } from '@shared/dates';
import { safeDivide } from '@shared/money';
import { defineRoute } from '../route';
import { requireVerified } from '../../auth/guard';
import { getUserPrefs } from '../../domain/prefs';
import { getRatesPerUsd } from '../../domain/rates';
import { computeNetWorth, defaultNetWorthWindow, netWorthOverTime } from '../../domain/networth';
import { amountByCategory, incomeExpenseByMonth } from '../../domain/analytics';
import { computeAllBudgetProgress } from '../../domain/budgets';
import { listGoalsWithMetrics } from '../../domain/goals';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const db = app.db;

  app.get(
    '/api/dashboard',
    defineRoute({
      handler: async ({ req }) => {
        const auth = requireVerified(req);
        const prefs = await getUserPrefs(db, auth.user.id);
        const rates = await getRatesPerUsd(db);
        const thisMonth = monthRange(prefs.today.slice(0, 7));

        const twelveMonths = defaultNetWorthWindow(prefs.today);
        const [netWorth, thisMonthFlow, spendingByCategory, budgets, goals, subs, debts, incomeExpenseHistory12mo, netWorthTrend] = await Promise.all([
          computeNetWorth(db, auth.user.id, prefs.mainCurrency, rates),
          incomeExpenseByMonth(db, auth.user.id, thisMonth, prefs.mainCurrency, rates),
          amountByCategory(db, auth.user.id, thisMonth, prefs.mainCurrency, rates, 'expense'),
          computeAllBudgetProgress(db, auth.user.id, prefs.weekStart, prefs.timezone),
          listGoalsWithMetrics(db, auth.user.id, prefs.today),
          db.query<{ id: string; name: string; priceMinor: number; currency: string; nextPaymentDate: string }>(
            `SELECT id, name, price_minor AS "priceMinor", currency, next_payment_date AS "nextPaymentDate" FROM subscriptions WHERE user_id = $1 AND status = 'active' ORDER BY next_payment_date LIMIT 5`,
            [auth.user.id],
          ),
          db.one<{ total: number }>(`SELECT COALESCE(SUM(remaining_minor),0) AS total FROM debts WHERE user_id = $1 AND status = 'active'`, [auth.user.id]),
          incomeExpenseByMonth(db, auth.user.id, twelveMonths, prefs.mainCurrency, rates),
          netWorthOverTime(db, auth.user.id, prefs.mainCurrency, rates, twelveMonths.from, twelveMonths.to),
        ]);

        const flow = thisMonthFlow[thisMonthFlow.length - 1] ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
        const lastMonthFlow = (await incomeExpenseByMonth(db, auth.user.id, previousRange(thisMonth), prefs.mainCurrency, rates))[0];

        const upcomingBills = await db.query(
          `SELECT id, name, amount_minor AS "amountMinor", currency, next_due_date AS "nextDueDate", 'recurring' AS source FROM recurring_transactions
           WHERE user_id = $1 AND is_active AND next_due_date BETWEEN $2 AND $3
           UNION ALL
           SELECT id, name, price_minor AS "amountMinor", currency, next_payment_date AS "nextDueDate", 'subscription' AS source FROM subscriptions
           WHERE user_id = $1 AND status = 'active' AND next_payment_date BETWEEN $2 AND $3
           ORDER BY "nextDueDate" LIMIT 8`,
          [auth.user.id, prefs.today, addDays(prefs.today, 14)],
        );

        return {
          currency: prefs.mainCurrency,
          netWorth,
          netWorthTrend,
          totalBalanceMinor: netWorth.assets.total,
          monthlyIncomeMinor: flow.incomeMinor,
          monthlyExpensesMinor: flow.expenseMinor,
          monthlySavingsMinor: flow.netMinor,
          savingsRate: safeDivide(flow.netMinor, flow.incomeMinor),
          previousMonth: lastMonthFlow ?? null,
          spendingByCategory: spendingByCategory.slice(0, 8),
          budgets,
          goals: goals.slice(0, 6),
          activeSubscriptions: subs,
          debtRemainingMinor: debts?.total ?? 0,
          upcomingBills,
          incomeExpenseHistory: incomeExpenseHistory12mo,
        };
      },
    }),
  );
}
