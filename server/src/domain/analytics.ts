import { eachMonthKey, type DateRange, type ISODate } from '@shared/dates';
import { makeConverter, type RatesPerUsd } from '@shared/money';
import type { Db } from '../db/index';

export interface MonthlyFlow {
  month: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
}

/** Income vs. expense, one bucket per calendar month covering the range — months with no activity still appear, at zero. */
export async function incomeExpenseByMonth(db: Db, userId: string, range: DateRange, mainCurrency: string, rates: RatesPerUsd): Promise<MonthlyFlow[]> {
  const convert = makeConverter(rates, mainCurrency);
  const rows = await db.query<{ month: string; type: string; currency: string; total: number }>(
    `SELECT to_char(occurred_on, 'YYYY-MM') AS month, type, currency, SUM(amount_minor)::bigint AS total
     FROM transactions WHERE user_id = $1 AND type IN ('income','expense') AND occurred_on BETWEEN $2 AND $3
     GROUP BY month, type, currency`,
    [userId, range.from, range.to],
  );
  const byMonth = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  for (const key of eachMonthKey(range.from, range.to)) byMonth.set(key, { incomeMinor: 0, expenseMinor: 0 });
  for (const r of rows) {
    const bucket = byMonth.get(r.month);
    if (!bucket) continue;
    const converted = convert(r.total, r.currency);
    if (r.type === 'income') bucket.incomeMinor += converted;
    else bucket.expenseMinor += converted;
  }
  return [...byMonth.entries()].map(([month, v]) => ({ month, ...v, netMinor: v.incomeMinor - v.expenseMinor }));
}

export interface CategoryAmount {
  categoryId: string | null;
  name: string | null;
  systemKey: string | null;
  icon: string;
  color: string;
  amountMinor: number;
  percent: number;
}

/** Spending (or income) grouped by category, split-aware (a split transaction is counted per-part, in its own category). */
export async function amountByCategory(db: Db, userId: string, range: DateRange, mainCurrency: string, rates: RatesPerUsd, type: 'expense' | 'income' = 'expense'): Promise<CategoryAmount[]> {
  const convert = makeConverter(rates, mainCurrency);
  const rows = await db.query<{ categoryId: string | null; name: string | null; systemKey: string | null; icon: string; color: string; currency: string; total: number }>(
    `SELECT tl.category_id AS "categoryId", c.name, c.system_key AS "systemKey", c.icon, c.color, tl.currency, SUM(tl.amount_minor)::bigint AS total
     FROM transaction_lines tl LEFT JOIN categories c ON c.id = tl.category_id
     WHERE tl.user_id = $1 AND tl.type = $2 AND tl.occurred_on BETWEEN $3 AND $4
     GROUP BY tl.category_id, c.name, c.system_key, c.icon, c.color, tl.currency`,
    [userId, type, range.from, range.to],
  );
  const byCategory = new Map<string, CategoryAmount>();
  for (const r of rows) {
    const key = r.categoryId ?? 'uncategorized';
    const converted = convert(r.total, r.currency);
    const existing = byCategory.get(key);
    if (existing) existing.amountMinor += converted;
    else byCategory.set(key, { categoryId: r.categoryId, name: r.name, systemKey: r.systemKey, icon: r.icon ?? 'Tag', color: r.color ?? '#64748b', amountMinor: converted, percent: 0 });
  }
  const total = [...byCategory.values()].reduce((s, c) => s + c.amountMinor, 0);
  return [...byCategory.values()].map((c) => ({ ...c, percent: total > 0 ? Math.round((c.amountMinor / total) * 1000) / 10 : 0 })).sort((a, b) => b.amountMinor - a.amountMinor);
}

export interface MerchantAmount {
  merchant: string;
  amountMinor: number;
  count: number;
}

export async function amountByMerchant(db: Db, userId: string, range: DateRange, mainCurrency: string, rates: RatesPerUsd, limit = 10): Promise<MerchantAmount[]> {
  const convert = makeConverter(rates, mainCurrency);
  const rows = await db.query<{ merchant: string; currency: string; total: number; count: number }>(
    `SELECT merchant, currency, SUM(amount_minor)::bigint AS total, COUNT(*)::int AS count
     FROM transactions WHERE user_id = $1 AND type = 'expense' AND merchant IS NOT NULL AND occurred_on BETWEEN $2 AND $3
     GROUP BY merchant, currency`,
    [userId, range.from, range.to],
  );
  const byMerchant = new Map<string, MerchantAmount>();
  for (const r of rows) {
    const converted = convert(r.total, r.currency);
    const existing = byMerchant.get(r.merchant);
    if (existing) {
      existing.amountMinor += converted;
      existing.count += r.count;
    } else byMerchant.set(r.merchant, { merchant: r.merchant, amountMinor: converted, count: r.count });
  }
  return [...byMerchant.values()].sort((a, b) => b.amountMinor - a.amountMinor).slice(0, limit);
}

export interface DailySpend {
  date: ISODate;
  amountMinor: number;
}

/** Daily expense totals — the raw data behind the spending heatmap. */
export async function dailySpend(db: Db, userId: string, range: DateRange, mainCurrency: string, rates: RatesPerUsd): Promise<DailySpend[]> {
  const convert = makeConverter(rates, mainCurrency);
  const rows = await db.query<{ date: ISODate; currency: string; total: number }>(
    `SELECT occurred_on AS date, currency, SUM(amount_minor)::bigint AS total FROM transactions
     WHERE user_id = $1 AND type = 'expense' AND occurred_on BETWEEN $2 AND $3 GROUP BY occurred_on, currency`,
    [userId, range.from, range.to],
  );
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) ?? 0) + convert(r.total, r.currency));
  return [...byDate.entries()].map(([date, amountMinor]) => ({ date, amountMinor })).sort((a, b) => a.date.localeCompare(b.date));
}

export interface SavingsPoint {
  month: string;
  savingsMinor: number;
  savingsRate: number;
}

export function savingsSeries(flows: MonthlyFlow[]): SavingsPoint[] {
  return flows.map((f) => ({ month: f.month, savingsMinor: f.netMinor, savingsRate: f.incomeMinor > 0 ? Math.round((f.netMinor / f.incomeMinor) * 1000) / 10 : 0 }));
}
