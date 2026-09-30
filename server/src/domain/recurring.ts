import { firstOccurrenceOnOrAfter, nextOccurrenceAfter, occurrencesBetween, type RecurrenceRule } from '@shared/recurrence';
import type { Frequency, TransactionType } from '@shared/constants';
import type { ISODate } from '@shared/dates';
import type { Db } from '../db/index';

export interface RecurringRow {
  id: string;
  name: string;
  type: TransactionType;
  accountId: string;
  accountName?: string;
  currency: string;
  amountMinor: number;
  toAccountId: string | null;
  toCurrency: string | null;
  toAmountMinor: number | null;
  categoryId: string | null;
  categoryName?: string | null;
  merchant: string | null;
  description: string | null;
  frequency: Frequency;
  intervalCount: number;
  startDate: ISODate;
  endDate: ISODate | null;
  nextDueDate: ISODate | null;
  autoConfirm: boolean;
  isActive: boolean;
  lastPostedOn: ISODate | null;
}

export const SELECT_RECURRING = `SELECT r.id, r.name, r.type, r.account_id AS "accountId", a.name AS "accountName", r.currency, r.amount_minor AS "amountMinor",
  r.to_account_id AS "toAccountId", r.to_currency AS "toCurrency", r.to_amount_minor AS "toAmountMinor",
  r.category_id AS "categoryId", c.name AS "categoryName", c.system_key AS "categorySystemKey", r.merchant, r.description,
  r.frequency, r.interval_count AS "intervalCount", r.start_date AS "startDate", r.end_date AS "endDate",
  r.next_due_date AS "nextDueDate", r.auto_confirm AS "autoConfirm", r.is_active AS "isActive", r.last_posted_on AS "lastPostedOn"
  FROM recurring_transactions r JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id`;

export function toRule(row: Pick<RecurringRow, 'frequency' | 'intervalCount' | 'startDate' | 'endDate'>): RecurrenceRule {
  return { frequency: row.frequency, intervalCount: row.intervalCount, startDate: row.startDate, endDate: row.endDate };
}

export function computeNextDueDate(row: Pick<RecurringRow, 'frequency' | 'intervalCount' | 'startDate' | 'endDate'>, from: ISODate): ISODate | null {
  return firstOccurrenceOnOrAfter(toRule(row), from);
}

export function advanceAfter(row: Pick<RecurringRow, 'frequency' | 'intervalCount' | 'startDate' | 'endDate'>, occurredOn: ISODate): ISODate | null {
  return nextOccurrenceAfter(toRule(row), occurredOn);
}

export interface UpcomingOccurrence {
  recurringId: string;
  name: string;
  type: TransactionType;
  amountMinor: number;
  currency: string;
  date: ISODate;
  categoryId: string | null;
  accountName?: string;
}

/** Every occurrence of every active recurring rule that falls inside [from, to] — used by the calendar and the forecast. */
export async function listUpcomingOccurrences(db: Db, userId: string, from: ISODate, to: ISODate): Promise<UpcomingOccurrence[]> {
  const rows = await db.query<RecurringRow>(`${SELECT_RECURRING} WHERE r.user_id = $1 AND r.is_active`, [userId]);
  const out: UpcomingOccurrence[] = [];
  for (const row of rows) {
    for (const date of occurrencesBetween(toRule(row), from, to, 200)) {
      out.push({ recurringId: row.id, name: row.name, type: row.type, amountMinor: row.amountMinor, currency: row.currency, date, categoryId: row.categoryId, accountName: row.accountName });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
