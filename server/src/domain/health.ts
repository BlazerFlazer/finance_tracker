import { addMonths, monthRange } from '@shared/dates';
import { clamp, makeConverter, type RatesPerUsd } from '@shared/money';
import type { Db } from '../db/index';
import { incomeExpenseByMonth } from './analytics';
import { computeAllBudgetProgress } from './budgets';
import type { InsightCtx } from './insights';

export interface HealthComponent {
  key: string;
  score: number; // 0-100
  weight: number; // share of the final score, in percentage points (already renormalised over included components)
  value: number; // the raw underlying number (rate, ratio, months…), for display
  included: boolean;
  reason?: string; // why a component was excluded (e.g. "no budgets set")
}

export interface FinancialHealth {
  score: number | null; // null when nothing at all could be computed
  components: HealthComponent[];
}

const linear = (value: number, worst: number, best: number): number => clamp(((value - worst) / (best - worst)) * 100, 0, 100);

export async function computeFinancialHealth(db: Db, ctx: InsightCtx): Promise<FinancialHealth> {
  const convert = makeConverter(ctx.rates, ctx.mainCurrency);
  const trailing6 = { from: addMonths(ctx.today, -5).slice(0, 7) + '-01', to: ctx.today };
  const flows = await incomeExpenseByMonth(db, ctx.userId, trailing6, ctx.mainCurrency, ctx.rates);
  const avgIncome = flows.reduce((s, f) => s + f.incomeMinor, 0) / Math.max(1, flows.filter((f) => f.incomeMinor > 0).length || flows.length);
  const avgExpense = flows.reduce((s, f) => s + f.expenseMinor, 0) / Math.max(1, flows.length);

  const parts: HealthComponent[] = [];

  // 1) savings rate — average of the last 3 months
  const last3 = flows.slice(-3).filter((f) => f.incomeMinor > 0);
  if (last3.length > 0) {
    const rate = last3.reduce((s, f) => s + f.netMinor / f.incomeMinor, 0) / last3.length;
    parts.push({ key: 'savings_rate', score: linear(rate, 0, 0.25), weight: 25, value: rate, included: true });
  } else {
    parts.push({ key: 'savings_rate', score: 0, weight: 25, value: 0, included: false, reason: 'no_income_data' });
  }

  // 2) budget adherence — share of active budgets not exceeded this period
  const budgets = await computeAllBudgetProgress(db, ctx.userId, ctx.weekStart, ctx.timezone);
  if (budgets.length > 0) {
    const ok = budgets.filter((b) => b.alertLevel !== 'exceeded').length;
    parts.push({ key: 'budget_adherence', score: (ok / budgets.length) * 100, weight: 15, value: ok / budgets.length, included: true });
  } else {
    parts.push({ key: 'budget_adherence', score: 0, weight: 15, value: 0, included: false, reason: 'no_budgets' });
  }

  // 3) debt ratio — monthly minimum debt payments vs. average income
  const debtRows = await db.query<{ minPaymentMinor: number; currency: string }>(`SELECT min_payment_minor AS "minPaymentMinor", currency FROM debts WHERE user_id = $1 AND status = 'active'`, [ctx.userId]);
  const monthlyDebtPayments = debtRows.reduce((s, d) => s + convert(d.minPaymentMinor, d.currency), 0);
  if (avgIncome > 0) {
    const ratio = monthlyDebtPayments / avgIncome;
    parts.push({ key: 'debt_ratio', score: linear(ratio, 0.5, 0), weight: 20, value: ratio, included: true });
  } else {
    parts.push({ key: 'debt_ratio', score: 0, weight: 20, value: 0, included: false, reason: 'no_income_data' });
  }

  // 4) emergency fund — liquid balance (cash/bank/savings) as months of average expense
  const liquid = await db.query<{ balanceMinor: number; currency: string }>(
    `SELECT COALESCE(b.balance_minor, a.opening_balance_minor) AS "balanceMinor", a.currency FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE a.user_id = $1 AND a.type IN ('cash','bank','savings') AND NOT a.is_archived`,
    [ctx.userId],
  );
  const liquidTotal = liquid.reduce((s, a) => s + Math.max(0, convert(a.balanceMinor, a.currency)), 0);
  if (avgExpense > 0) {
    const months = liquidTotal / avgExpense;
    parts.push({ key: 'emergency_fund', score: linear(months, 0, 6), weight: 20, value: months, included: true });
  } else {
    parts.push({ key: 'emergency_fund', score: 0, weight: 20, value: 0, included: false, reason: 'no_expense_data' });
  }

  // 5) recurring expenses as a share of income
  if (avgIncome > 0) {
    const recurringRows = await db.query<{ amountMinor: number; currency: string }>(
      `SELECT amount_minor AS "amountMinor", currency FROM recurring_transactions WHERE user_id = $1 AND is_active AND type = 'expense'
       UNION ALL SELECT price_minor, currency FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
      [ctx.userId],
    );
    const recurringTotal = recurringRows.reduce((s, r) => s + convert(r.amountMinor, r.currency), 0);
    const share = recurringTotal / avgIncome;
    parts.push({ key: 'recurring_expenses', score: linear(share, 0.5, 0), weight: 10, value: share, included: true });
  } else {
    parts.push({ key: 'recurring_expenses', score: 0, weight: 10, value: 0, included: false, reason: 'no_income_data' });
  }

  // 6) spending consistency — coefficient of variation of monthly expense over the trailing window
  const expenseSeries = flows.map((f) => f.expenseMinor).filter((v) => v > 0);
  if (expenseSeries.length >= 3) {
    const mean = expenseSeries.reduce((s, v) => s + v, 0) / expenseSeries.length;
    const variance = expenseSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / expenseSeries.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    parts.push({ key: 'spending_consistency', score: linear(cv, 0.5, 0), weight: 10, value: cv, included: true });
  } else {
    parts.push({ key: 'spending_consistency', score: 0, weight: 10, value: 0, included: false, reason: 'not_enough_months' });
  }

  const included = parts.filter((p) => p.included);
  const includedWeightSum = included.reduce((s, p) => s + p.weight, 0);
  if (includedWeightSum === 0) return { score: null, components: parts };
  const renormalised = parts.map((p) => (p.included ? { ...p, weight: Math.round((p.weight / includedWeightSum) * 1000) / 10 } : { ...p, weight: 0 }));
  const score = Math.round(renormalised.filter((p) => p.included).reduce((s, p) => s + (p.score * p.weight) / 100, 0));
  return { score, components: renormalised };
}
