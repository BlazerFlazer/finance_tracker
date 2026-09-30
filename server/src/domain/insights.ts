import type { Lang } from '@shared/constants';
import { addDays, addMonths, formatDate, monthRange, previousRange, type ISODate } from '@shared/dates';
import { formatMoney, makeConverter, type RatesPerUsd } from '@shared/money';
import { cycleToRule, monthlyEquivalent } from '@shared/recurrence';
import type { Db } from '../db/index';
import { amountByCategory, incomeExpenseByMonth } from './analytics';
import { computeAllBudgetProgress } from './budgets';
import { listGoalsWithMetrics } from './goals';
import { insightText, type InsightText } from './insightText';

export type InsightSeverity = 'info' | 'warning' | 'positive';

export interface Insight extends InsightText {
  id: string;
  severity: InsightSeverity;
}

const LOCALE: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', uz: 'uz-Latn-UZ' };

export interface InsightCtx {
  userId: string;
  lang: Lang;
  mainCurrency: string;
  rates: RatesPerUsd;
  today: ISODate;
  weekStart: 0 | 1;
  timezone: string;
}

/**
 * Rule-based, fully explainable insights (section 34 of the spec): every one states WHAT happened, WHY it
 * was surfaced, and a few non-prescriptive OPTIONS — never a prediction dressed up as fact, never investment
 * advice. This is the whole feature; an optional LLM layer (see ai/insights.ts) only rephrases these same
 * facts, it never adds new ones.
 */
export async function generateInsights(db: Db, ctx: InsightCtx): Promise<Insight[]> {
  const t = insightText(ctx.lang);
  const locale = LOCALE[ctx.lang];
  const money = (m: number) => formatMoney(m, ctx.mainCurrency, { locale });
  const insights: Insight[] = [];

  const activity = await db.one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1`, [ctx.userId]);
  if (!activity || activity.n < 5) {
    return [{ id: 'no-data', severity: 'info', ...t.noData() }];
  }

  const thisMonth = monthRange(ctx.today.slice(0, 7));
  const trailing3 = { from: addMonths(thisMonth.from, -3), to: addDays(thisMonth.from, -1) };

  // 1) category changes vs trailing 3-month average
  const [currentCats, trailingCats] = await Promise.all([
    amountByCategory(db, ctx.userId, thisMonth, ctx.mainCurrency, ctx.rates, 'expense'),
    amountByCategory(db, ctx.userId, trailing3, ctx.mainCurrency, ctx.rates, 'expense'),
  ]);
  const trailingAvg = new Map(trailingCats.map((c) => [c.categoryId ?? 'uncategorized', c.amountMinor / 3]));
  const catChanges = currentCats
    .filter((c) => c.categoryId)
    .map((c) => {
      const avg = trailingAvg.get(c.categoryId ?? 'uncategorized') ?? 0;
      const label = c.name ?? c.systemKey ?? 'Other';
      return { c, avg, label, diff: avg > 0 ? (c.amountMinor - avg) / avg : 0 };
    })
    .filter((x) => x.avg >= 1000) // ignore near-zero (or brand-new) baselines — too noisy to be meaningful
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const topChange = catChanges[0];
  if (topChange && Number.isFinite(topChange.diff) && Math.abs(topChange.diff) >= 0.15) {
    const pct = Math.round(Math.abs(topChange.diff) * 100);
    insights.push({
      id: `cat-change-${topChange.c.categoryId}`,
      severity: topChange.diff > 0 ? 'warning' : 'positive',
      ...(topChange.diff > 0 ? t.categoryUp(topChange.label, pct, money(topChange.c.amountMinor), money(topChange.avg)) : t.categoryDown(topChange.label, pct, money(topChange.c.amountMinor), money(topChange.avg))),
    });
  }

  // 2) savings rate vs last period
  const [curFlow] = await incomeExpenseByMonth(db, ctx.userId, thisMonth, ctx.mainCurrency, ctx.rates).then((r) => r.slice(-1));
  const [prevFlow] = await incomeExpenseByMonth(db, ctx.userId, previousRange(thisMonth), ctx.mainCurrency, ctx.rates).then((r) => r.slice(-1));
  if (curFlow && prevFlow && curFlow.incomeMinor > 0 && prevFlow.incomeMinor > 0) {
    const curRate = Math.round((curFlow.netMinor / curFlow.incomeMinor) * 100);
    const prevRate = Math.round((prevFlow.netMinor / prevFlow.incomeMinor) * 100);
    const delta = curRate - prevRate;
    if (Math.abs(delta) >= 5) {
      insights.push({
        id: `savings-rate-${thisMonth.from}`,
        severity: delta > 0 ? 'positive' : 'warning',
        ...(delta > 0 ? t.savingsUp(delta, curRate) : t.savingsDown(Math.abs(delta), curRate)),
      });
    }
  }

  // 3) recurring expenses as a share of income
  const [recurringRows, subRows, avgIncome] = await Promise.all([
    db.query<{ amountMinor: number; currency: string; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; intervalCount: number }>(
      `SELECT amount_minor AS "amountMinor", currency, frequency, interval_count AS "intervalCount" FROM recurring_transactions WHERE user_id = $1 AND is_active AND type = 'expense'`,
      [ctx.userId],
    ),
    db.query<{ priceMinor: number; currency: string; billingCycle: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' }>(
      `SELECT price_minor AS "priceMinor", currency, billing_cycle AS "billingCycle" FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
      [ctx.userId],
    ),
    db.one<{ avg: number }>(`SELECT AVG(t)::bigint AS avg FROM (SELECT SUM(amount_minor) AS t FROM transactions WHERE user_id=$1 AND type='income' AND occurred_on >= $2 GROUP BY to_char(occurred_on,'YYYY-MM')) s`, [
      ctx.userId,
      addMonths(ctx.today, -3),
    ]),
  ]);
  const convert = makeConverter(ctx.rates, ctx.mainCurrency);
  const recurringMonthly = recurringRows.reduce((s, r) => s + convert(monthlyEquivalent(r.amountMinor, r.frequency, r.intervalCount), r.currency), 0);
  const subsMonthly = subRows.reduce((s, r) => {
    const rule = cycleToRule(r.billingCycle);
    return s + convert(monthlyEquivalent(r.priceMinor, rule.frequency, rule.intervalCount), r.currency);
  }, 0);
  const totalRecurring = recurringMonthly + subsMonthly;
  if (avgIncome?.avg && avgIncome.avg > 0 && totalRecurring > 0) {
    const share = totalRecurring / avgIncome.avg;
    if (share >= 0.25) insights.push({ id: 'recurring-share', severity: share >= 0.4 ? 'warning' : 'info', ...t.recurringShare(Math.round(share * 100), money(totalRecurring)) });
  }

  // 4) budgets nearing or over their limit
  const budgets = await computeAllBudgetProgress(db, ctx.userId, ctx.weekStart, ctx.timezone);
  for (const b of budgets) {
    if (b.alertLevel === 'none') continue;
    insights.push({
      id: `budget-${b.budget.id}`,
      severity: b.alertLevel === 'exceeded' ? 'warning' : 'info',
      ...t.budgetAlert(b.budget.name, b.percentUsed, money(Math.max(0, b.totalRemainingMinor)), b.alertLevel),
    });
  }

  // 5) unusually large single transaction vs. the category's own recent average
  const unusual = await db.one<{ id: string; merchant: string | null; amountMinor: number; avg: number; categoryName: string | null; currency: string }>(
    `WITH recent AS (
       -- partitioned by t.id (the candidate transaction), not category: each candidate is compared only
       -- against ITS OWN recent same-category peers, never averaged in with other candidates' peers.
       SELECT t.id, t.merchant, t.amount_minor AS "amountMinor", t.currency, c.name AS "categoryName",
              AVG(t2.amount_minor) OVER (PARTITION BY t.id) AS avg, COUNT(*) OVER (PARTITION BY t.id) AS n
       FROM transactions t
       JOIN transactions t2 ON t2.user_id = t.user_id AND t2.category_id = t.category_id AND t2.type = 'expense' AND t2.occurred_on >= $2 AND t2.id <> t.id
       JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1 AND t.type = 'expense' AND t.occurred_on >= $3
     )
     SELECT id, merchant, "amountMinor", currency, "categoryName", avg FROM recent WHERE n >= 3 AND "amountMinor" > avg * 2.5 ORDER BY "amountMinor" DESC LIMIT 1`,
    [ctx.userId, addDays(ctx.today, -90), thisMonth.from],
  );
  if (unusual) {
    insights.push({
      id: `unusual-${unusual.id}`,
      severity: 'info',
      ...t.unusualTransaction(unusual.merchant ?? unusual.categoryName ?? '—', money(convert(unusual.amountMinor, unusual.currency)), unusual.categoryName ?? '—', money(convert(Math.round(unusual.avg), unusual.currency))),
    });
  }

  // 6) large bill due soon
  const avgMonthlyExpense = curFlow?.expenseMinor && curFlow.expenseMinor > 0 ? curFlow.expenseMinor : 1;
  const upcoming = await db.query<{ name: string; amountMinor: number; currency: string; dueDate: string }>(
    `SELECT name, amount_minor AS "amountMinor", currency, next_due_date AS "dueDate" FROM recurring_transactions WHERE user_id=$1 AND is_active AND next_due_date BETWEEN $2 AND $3
     UNION ALL SELECT name, price_minor, currency, next_payment_date FROM subscriptions WHERE user_id=$1 AND status='active' AND next_payment_date BETWEEN $2 AND $3`,
    [ctx.userId, ctx.today, addDays(ctx.today, 7)],
  );
  const bigBill = upcoming.map((u) => ({ ...u, converted: convert(u.amountMinor, u.currency) })).filter((u) => u.converted >= avgMonthlyExpense * 0.15).sort((a, b) => b.converted - a.converted)[0];
  if (bigBill) {
    insights.push({ id: `bill-${bigBill.name}-${bigBill.dueDate}`, severity: 'info', ...t.upcomingLargeBill(bigBill.name, money(bigBill.converted), formatDate(bigBill.dueDate, locale, 'dayMonth')) });
  }

  // 7) goals behind schedule or just completed
  const goals = await listGoalsWithMetrics(db, ctx.userId, ctx.today);
  for (const g of goals) {
    if (g.metrics.status === 'behind' && g.metrics.requiredMonthlyMinor) {
      insights.push({
        id: `goal-behind-${g.goal.id}`,
        severity: 'warning',
        ...t.goalBehind(g.goal.name, formatMoney(g.metrics.requiredMonthlyMinor, g.goal.currency, { locale }), formatDate(g.goal.deadline!, locale, 'medium')),
      });
    } else if (g.metrics.status === 'completed') {
      insights.push({ id: `goal-done-${g.goal.id}`, severity: 'positive', ...t.goalCompleted(g.goal.name) });
    }
  }

  return insights.slice(0, 12);
}
