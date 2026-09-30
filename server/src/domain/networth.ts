import { ASSET_BUCKET, type AccountType } from '@shared/constants';
import { makeConverter, type RatesPerUsd } from '@shared/money';
import { addMonths, eachMonthKey, monthKey, monthKeyToStart, type ISODate } from '@shared/dates';
import type { Db } from '../db/index';

export interface NetWorthBreakdown {
  assets: { cash: number; bank: number; savings: number; investments: number; other: number; total: number };
  liabilities: { creditCards: number; loans: number; otherDebt: number; total: number };
  netWorth: number;
  currency: string;
  missingRates: string[];
}

/** Current net worth, every account and debt converted into `mainCurrency`. Archived/excluded accounts are skipped. */
export async function computeNetWorth(db: Db, userId: string, mainCurrency: string, rates: RatesPerUsd): Promise<NetWorthBreakdown> {
  const convert = makeConverter(rates, mainCurrency);
  const accounts = await db.query<{ type: AccountType; currency: string; balanceMinor: number }>(
    `SELECT a.type, a.currency, COALESCE(b.balance_minor, a.opening_balance_minor) AS "balanceMinor"
     FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE a.user_id = $1 AND a.include_in_net_worth AND NOT a.is_archived`,
    [userId],
  );
  const assets = { cash: 0, bank: 0, savings: 0, investments: 0, other: 0, total: 0 };
  const liabilities = { creditCards: 0, loans: 0, otherDebt: 0, total: 0 };
  for (const a of accounts) {
    const converted = convert(a.balanceMinor, a.currency);
    if (converted >= 0) {
      const bucket = ASSET_BUCKET[a.type];
      assets[bucket] += converted;
      assets.total += converted;
    } else if (a.type === 'credit_card') {
      liabilities.creditCards += -converted;
      liabilities.total += -converted;
    } else {
      liabilities.otherDebt += -converted;
      liabilities.total += -converted;
    }
  }
  const debts = await db.query<{ currency: string; remainingMinor: number }>(`SELECT currency, remaining_minor AS "remainingMinor" FROM debts WHERE user_id = $1 AND status = 'active'`, [userId]);
  for (const d of debts) {
    const converted = convert(d.remainingMinor, d.currency);
    liabilities.loans += converted;
    liabilities.total += converted;
  }
  return { assets, liabilities, netWorth: assets.total - liabilities.total, currency: mainCurrency, missingRates: [...convert.missing] };
}

export interface NetWorthPoint {
  month: string;
  accountsMinor: number;
  debtsMinor: number;
  netWorthMinor: number;
}

/**
 * Net worth at the end of each month over the trailing window, reconstructed by walking the running total
 * of every transaction that touches net worth (income/expense/transfer effects) plus debt payments, so it
 * reflects what the balances actually were on that date rather than only "since we started snapshotting".
 */
export async function netWorthOverTime(db: Db, userId: string, mainCurrency: string, rates: RatesPerUsd, from: ISODate, to: ISODate): Promise<NetWorthPoint[]> {
  const convert = makeConverter(rates, mainCurrency);
  const accounts = await db.query<{ id: string; type: AccountType; currency: string; openingBalanceMinor: number; includeInNetWorth: boolean; isArchived: boolean; createdAt: string }>(
    `SELECT id, type, currency, opening_balance_minor AS "openingBalanceMinor", include_in_net_worth AS "includeInNetWorth", is_archived AS "isArchived", created_at AS "createdAt" FROM accounts WHERE user_id = $1`,
    [userId],
  );
  const eligible = new Set(accounts.filter((a) => a.includeInNetWorth).map((a) => a.id));
  const currencyByAccount = new Map(accounts.map((a) => [a.id, a.currency]));
  const createdMonthByAccount = new Map(accounts.map((a) => [a.id, monthKey(a.createdAt.slice(0, 10))]));

  const txs = await db.query<{ occurredOn: ISODate; type: string; accountId: string; amountMinor: number; toAccountId: string | null; toAmountMinor: number | null }>(
    `SELECT occurred_on AS "occurredOn", type, account_id AS "accountId", amount_minor AS "amountMinor", to_account_id AS "toAccountId", to_amount_minor AS "toAmountMinor"
     FROM transactions WHERE user_id = $1 AND occurred_on <= $2 ORDER BY occurred_on`,
    [userId, to],
  );
  const debtStart = await db.one<{ total: number }>(`SELECT COALESCE(SUM(original_minor),0) AS total FROM debts WHERE user_id = $1`, [userId]);
  const debtPayments = await db.query<{ paidOn: ISODate; principalMinor: number; currency: string }>(
    `SELECT dp.paid_on AS "paidOn", dp.principal_minor AS "principalMinor", d.currency FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE dp.user_id = $1 AND dp.paid_on <= $2 ORDER BY dp.paid_on`,
    [userId, to],
  );

  const balances = new Map<string, number>(accounts.map((a) => [a.id, a.openingBalanceMinor]));
  let debtRemaining = debtStart?.total ?? 0; // approximation for months before individual debts existed — refined below as payments are replayed
  let txIdx = 0;
  let payIdx = 0;
  const points: NetWorthPoint[] = [];
  for (const m of eachMonthKey(from, to)) {
    const monthEnd = `${m}-${new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()}`;
    while (txIdx < txs.length && txs[txIdx]!.occurredOn <= monthEnd) {
      const t = txs[txIdx]!;
      if (eligible.has(t.accountId)) balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + (t.type === 'income' ? t.amountMinor : -t.amountMinor));
      if (t.type === 'transfer' && t.toAccountId && eligible.has(t.toAccountId)) balances.set(t.toAccountId, (balances.get(t.toAccountId) ?? 0) + (t.toAmountMinor ?? 0));
      txIdx++;
    }
    while (payIdx < debtPayments.length && debtPayments[payIdx]!.paidOn <= monthEnd) {
      debtRemaining -= convert(debtPayments[payIdx]!.principalMinor, debtPayments[payIdx]!.currency);
      payIdx++;
    }
    let net = 0;
    for (const [accId, bal] of balances) {
      // An account opened later shouldn't inflate net worth in months before it existed.
      if (createdMonthByAccount.get(accId)! > m) continue;
      net += convert(bal, currencyByAccount.get(accId)!);
    }
    const accountsMinor = Math.round(net);
    const debtsMinor = Math.round(debtRemaining);
    points.push({ month: m, accountsMinor, debtsMinor, netWorthMinor: accountsMinor - debtsMinor });
  }
  return points;
}

// The 1st of the month `months - 1` months back, so the window covers exactly `months` full calendar
// buckets ending with the current (partial) month — `monthKey` alone returns "YYYY-MM" (7 chars), which
// is not a valid `date` value and must be widened back to "YYYY-MM-01" before it can be used as a range bound.
export const defaultNetWorthWindow = (today: ISODate, months = 12): { from: ISODate; to: ISODate } => ({ from: monthKeyToStart(monthKey(addMonths(today, -(months - 1)))), to: today });
