import crypto from 'node:crypto';
import { addDays, addMonths, todayInTZ } from '@shared/dates';
import type { Db } from '../db/index';
import { createUserWithDefaults, type CreatedUser } from '../auth/registerUser';
import { config } from '../config';

const rnd = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/**
 * A ready-to-explore demo account (section 50): realistic-looking accounts, ~75 days of transactions,
 * budgets, goals, subscriptions and a debt — all owned by a real, normal `users` row flagged `is_demo`,
 * so it goes through every constraint and RLS-equivalent ownership check like any other account, and is
 * auto-purged after `DEMO_TTL_HOURS` (see jobs/scheduler.ts).
 */
export async function createDemoUser(db: Db): Promise<CreatedUser> {
  const suffix = crypto.randomBytes(4).toString('hex');
  const user = await createUserWithDefaults(db, {
    email: `demo-${suffix}@fintrack.demo`,
    username: `demo_${suffix}`,
    passwordHash: null,
    isDemo: true,
    demoTtlHours: config.demoTtlHours,
    language: 'en',
    timezone: 'UTC',
  });
  const today = todayInTZ('UTC');
  const uid = user.id;

  await db.exec(
    `UPDATE profiles SET display_name = 'Demo User', country = 'US', main_currency = 'USD', onboarding_completed_at = now(),
       income_source = 'salary', avg_monthly_income_minor = 480000, income_frequency = 'monthly',
       has_debts = true, has_subscriptions = true, main_goal = 'Build an emergency fund', desired_savings_minor = 1000000, goal_timeframe_months = 12
     WHERE user_id = $1`,
    [uid],
  );

  const categoryIdByKey = new Map<string, string>(
    (await db.query<{ id: string; systemKey: string }>(`SELECT id, system_key AS "systemKey" FROM categories WHERE user_id = $1 AND system_key IS NOT NULL`, [uid])).map((c) => [c.systemKey, c.id]),
  );
  const cat = (key: string) => categoryIdByKey.get(key)!;

  const acc = async (name: string, type: string, opening: number) =>
    (await db.one<{ id: string }>(`INSERT INTO accounts (user_id, name, type, currency, opening_balance_minor, color) VALUES ($1,$2,$3,'USD',$4,$5) RETURNING id`, [uid, name, type, opening, pick(['#6366f1', '#0ea5e9', '#22c55e', '#f97316'])]))!.id;

  const checking = await acc('Main Checking', 'bank', 150000);
  const cash = await acc('Cash', 'cash', 8000);
  const savings = await acc('Savings', 'savings', 620000);
  const creditCard = await acc('Rewards Credit Card', 'credit_card', 0);
  await db.exec(`UPDATE accounts SET credit_limit_minor = 500000, low_balance_threshold_minor = 20000 WHERE id = $1`, [checking]);

  // ~11 weeks of everyday activity
  const merchantsByCategory: Record<string, string[]> = {
    groceries: ['Trader Grocers', 'FreshMart', 'Green Basket'],
    restaurants: ['Pasta Place', 'Sushi Go', 'Corner Diner'],
    coffee: ['Blue Bottle', 'Daily Grind'],
    fuel: ['Shell', 'Chevron'],
    taxi: ['Uber', 'Lyft'],
    entertainment: ['Cinema City', 'Steam', 'Bowling Club'],
    shopping: ['Amazon', 'Target', 'Zara'],
    health: ['CVS Pharmacy', 'City Clinic'],
    technology: ['Best Buy', 'Apple Store'],
    sports: ['FitZone Gym'],
  };
  for (let d = 74; d >= 0; d--) {
    const date = addDays(today, -d);
    const txCount = rnd(0, 2);
    for (let i = 0; i < txCount; i++) {
      const key = pick(['groceries', 'restaurants', 'coffee', 'fuel', 'taxi', 'entertainment', 'shopping', 'health', 'technology', 'sports']);
      const amount = { groceries: rnd(1500, 9000), restaurants: rnd(1200, 6500), coffee: rnd(350, 900), fuel: rnd(2500, 6000), taxi: rnd(600, 2500), entertainment: rnd(800, 5000), shopping: rnd(1500, 12000), health: rnd(1000, 8000), technology: rnd(2000, 25000), sports: rnd(3000, 6000) }[key]!;
      const account = key === 'shopping' || key === 'technology' ? creditCard : Math.random() < 0.15 ? cash : checking;
      await db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, occurred_on) VALUES ($1,'expense',$2,'USD',$3,$4,$5,$6)`, [
        uid, account, amount, cat(key), pick(merchantsByCategory[key]!), date,
      ]);
    }
  }

  // monthly salary + rent, last 3 months
  for (let m = 2; m >= 0; m--) {
    const salaryDate = addMonths(`${today.slice(0, 7)}-01`, -m);
    await db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, occurred_on) VALUES ($1,'income',$2,'USD',480000,$3,'Acme Corp',$4)`, [uid, checking, cat('salary'), salaryDate]);
    await db.exec(`INSERT INTO transactions (user_id, type, account_id, currency, amount_minor, category_id, merchant, occurred_on) VALUES ($1,'expense',$2,'USD',120000,$3,'Skyline Apartments',$4)`, [
      uid, checking, cat('rent'), addDays(salaryDate, 1),
    ]);
  }

  // budgets for the current month
  const budget = (await db.one<{ id: string }>(`INSERT INTO budgets (user_id, name, period, currency) VALUES ($1,'Monthly essentials','monthly','USD') RETURNING id`, [uid]))!.id;
  for (const [key, amount] of [['food', 45000], ['transport', 15000], ['entertainment', 12000], ['shopping', 20000]] as const) {
    await db.exec(`INSERT INTO budget_items (budget_id, user_id, category_id, amount_minor) VALUES ($1,$2,$3,$4)`, [budget, uid, cat(key), amount]);
  }

  // goals
  const goal1 = (await db.one<{ id: string }>(
    `INSERT INTO financial_goals (user_id, name, kind, target_minor, current_minor, currency, deadline, planned_monthly_minor, icon) VALUES ($1,'Emergency fund','emergency_fund',1000000,620000,'USD',$2,40000,'ShieldCheck') RETURNING id`,
    [uid, addMonths(today, 8)],
  ))!.id;
  await db.exec(`INSERT INTO financial_goals (user_id, name, kind, target_minor, current_minor, currency, deadline, planned_monthly_minor, icon) VALUES ($1,'Trip to Japan','vacation',350000,90000,'USD',$2,25000,'Plane')`, [
    uid, addMonths(today, 10),
  ]);
  await db.exec(`INSERT INTO goal_contributions (goal_id, user_id, amount_minor, contributed_on, note) VALUES ($1,$2,40000,$3,'Monthly top-up')`, [goal1, uid, addDays(today, -20)]);

  // subscriptions
  await db.exec(`INSERT INTO subscriptions (user_id, name, price_minor, currency, billing_cycle, next_payment_date, category_id, account_id) VALUES ($1,'Netflix',1599,'USD','monthly',$2,$3,$4)`, [
    uid, addDays(today, rnd(1, 20)), cat('subscriptions'), creditCard,
  ]);
  await db.exec(`INSERT INTO subscriptions (user_id, name, price_minor, currency, billing_cycle, next_payment_date, category_id, account_id, last_used_on) VALUES ($1,'Spotify',999,'USD','monthly',$2,$3,$4,$5)`, [
    uid, addDays(today, rnd(1, 20)), cat('subscriptions'), creditCard, addDays(today, -75),
  ]);

  // a debt with a couple of payments
  const debt = (await db.one<{ id: string }>(
    `INSERT INTO debts (user_id, name, creditor, kind, currency, original_minor, remaining_minor, interest_rate, min_payment_minor, due_day) VALUES ($1,'Car loan','City Auto Finance','loan','USD',1200000,860000,7.5,25000,5) RETURNING id`,
    [uid],
  ))!.id;
  await db.exec(`INSERT INTO debt_payments (debt_id, user_id, amount_minor, principal_minor, interest_minor, paid_on) VALUES ($1,$2,25000,20000,5000,$3)`, [debt, uid, addDays(today, -35)]);
  await db.exec(`INSERT INTO debt_payments (debt_id, user_id, amount_minor, principal_minor, interest_minor, paid_on) VALUES ($1,$2,25000,20500,4500,$3)`, [debt, uid, addDays(today, -5)]);

  // recurring rule for rent (keeps the calendar/forecast populated going forward)
  await db.exec(
    `INSERT INTO recurring_transactions (user_id, name, type, account_id, currency, amount_minor, category_id, merchant, frequency, interval_count, start_date, next_due_date) VALUES ($1,'Rent','expense',$2,'USD',120000,$3,'Skyline Apartments','monthly',1,$4,$5)`,
    [uid, checking, cat('rent'), addMonths(today, -3), addDays(today, rnd(1, 25))],
  );

  return user;
}
