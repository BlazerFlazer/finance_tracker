import { monthKey, monthKeyToStart, monthRange, previousRange, type DateRange } from '@shared/dates';
import type { Db } from '../db/index';
import { amountByCategory, incomeExpenseByMonth } from './analytics';
import { computeAllBudgetProgress } from './budgets';
import { listGoalsWithMetrics } from './goals';
import { netWorthOverTime } from './networth';
import type { InsightCtx } from './insights';

export interface MonthlyReview {
  period: string;
  currency: string;
  incomeMinor: number;
  expensesMinor: number;
  savingsMinor: number;
  savingsRate: number;
  biggestCategory: { name: string | null; systemKey: string | null; amountMinor: number } | null;
  largestExpense: { merchant: string | null; amountMinor: number; occurredOn: string } | null;
  budgetPerformance: { name: string; percentUsed: number; alertLevel: string }[];
  goalsProgress: { name: string; progress: number; status: string }[];
  netWorthChangeMinor: number | null;
  previousMonth: { incomeMinor: number; expensesMinor: number; savingsMinor: number } | null;
}

/**
 * "Your Financial Month" — computed on demand (and cached into `reports` by the monthly scheduler job)
 * so it reads the same whether it's opened live or a year later.
 */
export async function buildMonthlyReview(db: Db, ctx: InsightCtx, period: string): Promise<MonthlyReview> {
  const range: DateRange = monthRange(period);
  const asOf = range.to <= ctx.today ? range.to : ctx.today;
  const prevRange = previousRange(range);
  const [flowRows, prevFlowRows, categories, largest, budgets, goals, netWorthSeries] = await Promise.all([
    incomeExpenseByMonth(db, ctx.userId, range, ctx.mainCurrency, ctx.rates),
    incomeExpenseByMonth(db, ctx.userId, prevRange, ctx.mainCurrency, ctx.rates),
    amountByCategory(db, ctx.userId, range, ctx.mainCurrency, ctx.rates, 'expense'),
    db.one<{ merchant: string | null; amountMinor: number; occurredOn: string }>(
      `SELECT merchant, amount_minor AS "amountMinor", occurred_on AS "occurredOn" FROM transactions WHERE user_id = $1 AND type = 'expense' AND occurred_on BETWEEN $2 AND $3 ORDER BY amount_minor DESC LIMIT 1`,
      [ctx.userId, range.from, range.to],
    ),
    computeAllBudgetProgress(db, ctx.userId, ctx.weekStart, ctx.timezone, false),
    listGoalsWithMetrics(db, ctx.userId, asOf),
    // two month-end net worth points bracket the review month, so the change is the real reconstructed delta, not just that month's savings.
    netWorthOverTime(db, ctx.userId, ctx.mainCurrency, ctx.rates, prevRange.from, asOf),
  ]);

  const flow = flowRows[0] ?? { incomeMinor: 0, expenseMinor: 0, netMinor: 0 };
  const prevFlow = prevFlowRows[0] ?? null;
  const savingsRate = flow.incomeMinor > 0 ? Math.round((flow.netMinor / flow.incomeMinor) * 1000) / 10 : 0;
  const thisMonthKey = monthKey(range.from);
  const prevMonthKey = monthKey(prevRange.from);
  const nwThis = netWorthSeries.find((p) => p.month === thisMonthKey)?.netWorthMinor;
  const nwPrev = netWorthSeries.find((p) => p.month === prevMonthKey)?.netWorthMinor;
  const netWorthChangeMinor = nwThis !== undefined && nwPrev !== undefined ? nwThis - nwPrev : null;

  return {
    period,
    currency: ctx.mainCurrency,
    incomeMinor: flow.incomeMinor,
    expensesMinor: flow.expenseMinor,
    savingsMinor: flow.netMinor,
    savingsRate,
    biggestCategory: categories[0] ? { name: categories[0].name, systemKey: categories[0].systemKey, amountMinor: categories[0].amountMinor } : null,
    largestExpense: largest,
    budgetPerformance: budgets.map((b) => ({ name: b.budget.name, percentUsed: b.percentUsed, alertLevel: b.alertLevel })),
    goalsProgress: goals.map((g) => ({ name: g.goal.name, progress: Math.round(g.metrics.progress * 100), status: g.metrics.status })),
    netWorthChangeMinor,
    previousMonth: prevFlow ? { incomeMinor: prevFlow.incomeMinor, expensesMinor: prevFlow.expenseMinor, savingsMinor: prevFlow.netMinor } : null,
  };
}

export const currentReviewPeriod = (today: string): string => monthKeyToStart(today.slice(0, 7)).slice(0, 7);
