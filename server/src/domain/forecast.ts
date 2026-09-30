import { addDays } from '@shared/dates';
import type { Db } from '../db/index';
import { incomeExpenseByMonth } from './analytics';
import { computeNetWorth } from './networth';
import type { InsightCtx } from './insights';

export interface ForecastPoint {
  date: string;
  balanceMinor: number;
}

export type ForecastResult =
  | { insufficientData: true }
  | {
      insufficientData: false;
      horizonDays: number;
      currentBalanceMinor: number;
      expectedIncomeMinor: number;
      expectedExpensesMinor: number;
      expectedSavingsMinor: number;
      expectedBalanceMinor: number;
      dailyNetMinor: number;
      series: ForecastPoint[];
    };

const DAYS_PER_MONTH = 30.4375;

/**
 * A deliberately simple, transparent projection: the trailing 3-month average daily income/expense, applied
 * forward. No seasonality, no machine learning — easy for a person to sanity-check, and never presented as
 * a guarantee (the API response is always paired with the "estimate" framing in the UI).
 */
export async function computeForecast(db: Db, ctx: InsightCtx, horizonDays: number): Promise<ForecastResult> {
  const [monthsRow, txCountRow] = await Promise.all([
    db.one<{ n: number }>(`SELECT COUNT(DISTINCT to_char(occurred_on,'YYYY-MM'))::int AS n FROM transactions WHERE user_id = $1`, [ctx.userId]),
    db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1 AND occurred_on >= $2`, [ctx.userId, addDays(ctx.today, -90)]),
  ]);
  if ((monthsRow?.n ?? 0) < 2 && (txCountRow?.n ?? 0) < 10) return { insufficientData: true };

  const trailing = { from: addDays(ctx.today, -89), to: ctx.today };
  const flows = await incomeExpenseByMonth(db, ctx.userId, trailing, ctx.mainCurrency, ctx.rates);
  const monthsWithData = flows.filter((f) => f.incomeMinor > 0 || f.expenseMinor > 0).length || 1;
  const avgMonthlyIncome = flows.reduce((s, f) => s + f.incomeMinor, 0) / monthsWithData;
  const avgMonthlyExpense = flows.reduce((s, f) => s + f.expenseMinor, 0) / monthsWithData;
  const dailyIncome = avgMonthlyIncome / DAYS_PER_MONTH;
  const dailyExpense = avgMonthlyExpense / DAYS_PER_MONTH;
  const dailyNet = dailyIncome - dailyExpense;

  const netWorth = await computeNetWorth(db, ctx.userId, ctx.mainCurrency, ctx.rates);
  const currentBalanceMinor = netWorth.assets.total - netWorth.liabilities.creditCards;

  const series: ForecastPoint[] = [];
  const step = Math.max(1, Math.round(horizonDays / 60)); // cap the series at ~60 points regardless of horizon
  for (let d = 0; d <= horizonDays; d += step) {
    series.push({ date: addDays(ctx.today, d), balanceMinor: Math.round(currentBalanceMinor + dailyNet * d) });
  }
  if (series[series.length - 1]?.date !== addDays(ctx.today, horizonDays)) {
    series.push({ date: addDays(ctx.today, horizonDays), balanceMinor: Math.round(currentBalanceMinor + dailyNet * horizonDays) });
  }

  return {
    insufficientData: false,
    horizonDays,
    currentBalanceMinor,
    expectedIncomeMinor: Math.round(dailyIncome * horizonDays),
    expectedExpensesMinor: Math.round(dailyExpense * horizonDays),
    expectedSavingsMinor: Math.round(dailyNet * horizonDays),
    expectedBalanceMinor: Math.round(currentBalanceMinor + dailyNet * horizonDays),
    dailyNetMinor: Math.round(dailyNet),
    series,
  };
}
