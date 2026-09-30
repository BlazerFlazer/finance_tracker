import { budgetPeriodRange, todayInTZ, type DateRange } from '@shared/dates';
import { clamp, safeDivide } from '@shared/money';
import type { Queryable } from '../db/index';

export interface BudgetRow {
  id: string;
  name: string;
  period: 'weekly' | 'monthly' | 'yearly';
  currency: string;
  noticePct: number;
  warningPct: number;
  isActive: boolean;
}

export interface BudgetItemProgress {
  categoryId: string;
  categoryName: string | null;
  categorySystemKey: string | null;
  icon: string;
  color: string;
  budgetedMinor: number;
  spentMinor: number;
  remainingMinor: number;
  percentUsed: number;
}

export type BudgetAlertLevel = 'none' | 'notice' | 'warning' | 'exceeded';

export interface BudgetProgress extends DateRange {
  budget: BudgetRow;
  items: BudgetItemProgress[];
  totalBudgetedMinor: number;
  totalSpentMinor: number;
  totalRemainingMinor: number;
  percentUsed: number;
  alertLevel: BudgetAlertLevel;
}

function alertLevelFor(pct: number, noticePct: number, warningPct: number): BudgetAlertLevel {
  if (pct >= 100) return 'exceeded';
  if (pct >= warningPct) return 'warning';
  if (pct >= noticePct) return 'notice';
  return 'none';
}

export async function computeBudgetProgress(db: Queryable, userId: string, budget: BudgetRow, weekStart: 0 | 1, today: string): Promise<BudgetProgress> {
  const range = budgetPeriodRange(budget.period, today, weekStart);
  const rows = await db.query<{ categoryId: string; categoryName: string | null; categorySystemKey: string | null; icon: string; color: string; budgetedMinor: number; spentMinor: number }>(
    // A budget set on a parent category (e.g. "Food") counts spending in its subcategories too (Groceries,
    // Restaurants, Coffee, ...) — matching what a person setting that budget actually expects.
    `SELECT bi.category_id AS "categoryId", c.name AS "categoryName", c.system_key AS "categorySystemKey", c.icon, c.color,
            bi.amount_minor AS "budgetedMinor",
            COALESCE((SELECT SUM(tl.amount_minor) FROM transaction_lines tl
                      WHERE tl.user_id = bi.user_id AND tl.type = 'expense' AND tl.currency = $4 AND tl.occurred_on BETWEEN $2 AND $3
                        AND tl.category_id IN (SELECT id FROM categories WHERE user_id = bi.user_id AND (id = bi.category_id OR parent_id = bi.category_id))
                     ), 0) AS "spentMinor"
     FROM budget_items bi JOIN categories c ON c.id = bi.category_id
     WHERE bi.budget_id = $1 AND bi.user_id = $5
     ORDER BY bi.amount_minor DESC`,
    [budget.id, range.from, range.to, budget.currency, userId],
  );
  const items: BudgetItemProgress[] = rows.map((r) => ({
    ...r,
    remainingMinor: r.budgetedMinor - r.spentMinor,
    percentUsed: Math.round(safeDivide(r.spentMinor, r.budgetedMinor) * 100),
  }));
  const totalBudgetedMinor = items.reduce((s, i) => s + i.budgetedMinor, 0);
  const totalSpentMinor = items.reduce((s, i) => s + i.spentMinor, 0);
  const percentUsed = clamp(Math.round(safeDivide(totalSpentMinor, totalBudgetedMinor) * 100), 0, 999);
  return {
    budget,
    items,
    totalBudgetedMinor,
    totalSpentMinor,
    totalRemainingMinor: totalBudgetedMinor - totalSpentMinor,
    percentUsed,
    alertLevel: alertLevelFor(percentUsed, budget.noticePct, budget.warningPct),
    ...range,
  };
}

export async function computeAllBudgetProgress(db: Queryable, userId: string, weekStart: 0 | 1, timezone: string, onlyActive = true): Promise<BudgetProgress[]> {
  const today = todayInTZ(timezone);
  const budgets = await db.query<BudgetRow>(
    `SELECT id, name, period, currency, notice_pct AS "noticePct", warning_pct AS "warningPct", is_active AS "isActive" FROM budgets WHERE user_id = $1 ${onlyActive ? 'AND is_active' : ''} ORDER BY created_at`,
    [userId],
  );
  return Promise.all(budgets.map((b) => computeBudgetProgress(db, userId, b, weekStart, today)));
}
