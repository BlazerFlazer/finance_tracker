import { addDays } from '@shared/dates';
import type { Db } from '../db/index';
import { getUserPrefs } from '../domain/prefs';
import { computeAllBudgetProgress } from '../domain/budgets';
import { logger } from '../logger';

/** Inserts a notification, silently skipping it if the same `dedupeKey` already exists (see UNIQUE(user_id, dedupe_key)). */
async function notify(db: Db, userId: string, type: string, code: string, params: Record<string, unknown>, dedupeKey: string, entity?: { type: string; id: string }, severity: 'info' | 'success' | 'warning' | 'critical' = 'info') {
  await db.exec(
    `INSERT INTO notifications (user_id, type, severity, code, params, entity_type, entity_id, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [userId, type, severity, code, JSON.stringify(params), entity?.type ?? null, entity?.id ?? null, dedupeKey],
  );
}

/** Runs once per active (non-demo, verified) user: upcoming bills, budget alerts, low balances. Cheap enough to run every few minutes — every check is indexed and scoped to one user. */
export async function generateNotificationsForUser(db: Db, userId: string): Promise<void> {
  const prefs = await getUserPrefs(db, userId);
  const horizon = addDays(prefs.today, 7);

  const bills = await db.query<{ id: string; name: string; amountMinor: number; currency: string; dueDate: string; kind: 'recurring' | 'subscription'; reminderDays: number | null }>(
    `SELECT id, name, amount_minor AS "amountMinor", currency, next_due_date AS "dueDate", 'recurring' AS kind, NULL::int AS "reminderDays" FROM recurring_transactions WHERE user_id = $1 AND is_active AND type <> 'transfer' AND next_due_date BETWEEN $2 AND $3
     UNION ALL
     SELECT id, name, price_minor, currency, next_payment_date, 'subscription', reminder_days FROM subscriptions WHERE user_id = $1 AND status = 'active' AND next_payment_date BETWEEN $2 AND $4`,
    [userId, prefs.today, horizon, addDays(prefs.today, 30)],
  );
  for (const b of bills) {
    const withinReminder = b.kind === 'subscription' ? b.dueDate <= addDays(prefs.today, b.reminderDays ?? 3) : b.dueDate <= horizon;
    if (!withinReminder) continue;
    await notify(
      db,
      userId,
      b.kind === 'subscription' ? 'subscription_payment' : 'upcoming_bill',
      'default',
      { name: b.name, amountMinor: b.amountMinor, currency: b.currency, dueDate: b.dueDate },
      `${b.kind}:${b.id}:${b.dueDate}`,
      { type: b.kind, id: b.id },
    );
  }

  const budgets = await computeAllBudgetProgress(db, userId, prefs.weekStart, prefs.timezone);
  for (const b of budgets) {
    if (b.alertLevel === 'none') continue;
    await notify(
      db,
      userId,
      'budget_warning',
      b.alertLevel,
      { name: b.budget.name, percentUsed: b.percentUsed, currency: b.budget.currency },
      `budget:${b.budget.id}:${b.from}:${b.alertLevel}`,
      { type: 'budget', id: b.budget.id },
      b.alertLevel === 'exceeded' ? 'critical' : b.alertLevel === 'warning' ? 'warning' : 'info',
    );
  }

  const lowBalance = await db.query<{ id: string; name: string; balanceMinor: number; currency: string; threshold: number }>(
    `SELECT a.id, a.name, COALESCE(b.balance_minor, a.opening_balance_minor) AS "balanceMinor", a.currency, a.low_balance_threshold_minor AS threshold
     FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE a.user_id = $1 AND NOT a.is_archived AND a.low_balance_threshold_minor IS NOT NULL AND COALESCE(b.balance_minor, a.opening_balance_minor) < a.low_balance_threshold_minor`,
    [userId],
  );
  for (const a of lowBalance) {
    await notify(db, userId, 'low_balance', 'default', { name: a.name, balanceMinor: a.balanceMinor, currency: a.currency }, `low_balance:${a.id}:${prefs.today}`, { type: 'account', id: a.id }, 'warning');
  }

  // unusual spending: reuse the same signal as the AI insights engine, but only the newest one, and only once a day
  const unusual = await db.one<{ id: string; merchant: string | null; amountMinor: number; currency: string }>(
    `SELECT t.id, t.merchant, t.amount_minor AS "amountMinor", t.currency FROM transactions t
     WHERE t.user_id = $1 AND t.type = 'expense' AND t.occurred_on = $2
       AND t.amount_minor > (SELECT AVG(amount_minor) * 2.5 FROM transactions t2 WHERE t2.user_id = t.user_id AND t2.category_id = t.category_id AND t2.type = 'expense' AND t2.occurred_on >= $3 AND t2.id <> t.id)
     ORDER BY t.amount_minor DESC LIMIT 1`,
    [userId, prefs.today, addDays(prefs.today, -90)],
  );
  if (unusual) await notify(db, userId, 'unusual_spending', 'default', { merchant: unusual.merchant, amountMinor: unusual.amountMinor, currency: unusual.currency }, `unusual:${unusual.id}`, { type: 'transaction', id: unusual.id });
}

/** Auto-posts recurring rules marked `auto_confirm` whose due date has arrived — never for transfers (money movement always needs an explicit user action once). */
export async function autoConfirmDueRecurring(db: Db): Promise<number> {
  const due = await db.query<{ id: string; userId: string; type: string; accountId: string; currency: string; amountMinor: number; categoryId: string | null; merchant: string | null; description: string | null; dueDate: string; frequency: string; intervalCount: number; startDate: string; endDate: string | null }>(
    `SELECT id, user_id AS "userId", type, account_id AS "accountId", currency, amount_minor AS "amountMinor", category_id AS "categoryId", merchant, description,
            next_due_date AS "dueDate", frequency, interval_count AS "intervalCount", start_date AS "startDate", end_date AS "endDate"
     FROM recurring_transactions WHERE is_active AND auto_confirm AND type <> 'transfer' AND next_due_date <= now()::date`,
  );
  const { advanceAfter } = await import('../domain/recurring');
  let posted = 0;
  for (const r of due) {
    await db.tx(async (tx) => {
      await tx.exec(
        `INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, description, occurred_on, is_recurring, recurring_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
        [r.userId, r.type, r.accountId, r.currency, r.amountMinor, r.categoryId, r.merchant, r.description, r.dueDate, r.id],
      );
      const next = advanceAfter({ frequency: r.frequency as never, intervalCount: r.intervalCount, startDate: r.startDate, endDate: r.endDate }, r.dueDate);
      await tx.exec(`UPDATE recurring_transactions SET next_due_date = $2, last_posted_on = $3, is_active = ($2 IS NOT NULL) WHERE id = $1`, [r.id, next, r.dueDate]);
    });
    posted++;
  }
  if (posted) logger.info({ posted }, 'auto-confirmed recurring transactions');
  return posted;
}

export async function purgeExpiredDemoUsers(db: Db): Promise<number> {
  return db.exec(`DELETE FROM users WHERE is_demo AND demo_expires_at IS NOT NULL AND demo_expires_at < now()`);
}

export async function generateNotificationsForAllUsers(db: Db): Promise<void> {
  const users = await db.query<{ id: string }>(`SELECT id FROM users WHERE status = 'active' AND email_verified_at IS NOT NULL`);
  for (const u of users) {
    try {
      await generateNotificationsForUser(db, u.id);
    } catch (e) {
      logger.error({ err: e, userId: u.id }, 'notification generation failed for user');
    }
  }
}
