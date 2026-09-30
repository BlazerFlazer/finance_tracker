import { addDays, addMonths, addYears, diffDays, parseISO, type ISODate } from './dates';
import type { BillingCycle, Frequency } from './constants';

/**
 * Recurrence engine shared by recurring transactions, subscriptions, the calendar, the forecast and notifications.
 * The k-th occurrence is always computed from the anchor (`startDate`), so month-end clamping never drifts
 * (Jan 31 → Feb 28 → Mar 31, not Mar 28).
 */
export interface RecurrenceRule {
  frequency: Frequency;
  intervalCount: number;
  startDate: ISODate;
  endDate?: ISODate | null;
}

export function occurrenceAt(rule: RecurrenceRule, k: number): ISODate {
  const n = Math.max(1, rule.intervalCount);
  switch (rule.frequency) {
    case 'daily':
      return addDays(rule.startDate, k * n);
    case 'weekly':
      return addDays(rule.startDate, k * n * 7);
    case 'monthly':
      return addMonths(rule.startDate, k * n);
    case 'yearly':
      return addYears(rule.startDate, k * n);
  }
}

function indexOnOrAfter(rule: RecurrenceRule, date: ISODate): number {
  const d = diffDays(rule.startDate, date);
  if (d <= 0) return 0;
  const n = Math.max(1, rule.intervalCount);
  let k: number;
  switch (rule.frequency) {
    case 'daily':
      k = Math.ceil(d / n);
      break;
    case 'weekly':
      k = Math.ceil(d / (7 * n));
      break;
    case 'monthly': {
      const a = parseISO(rule.startDate);
      const b = parseISO(date);
      k = Math.max(0, Math.floor(((b.y - a.y) * 12 + (b.m - a.m)) / n) - 1);
      break;
    }
    case 'yearly': {
      const a = parseISO(rule.startDate);
      const b = parseISO(date);
      k = Math.max(0, Math.floor((b.y - a.y) / n) - 1);
      break;
    }
  }
  while (occurrenceAt(rule, k) < date) k++;
  return k;
}

/** First occurrence on or after `date`, or null when the rule has ended. */
export function firstOccurrenceOnOrAfter(rule: RecurrenceRule, date: ISODate): ISODate | null {
  const occ = occurrenceAt(rule, indexOnOrAfter(rule, date));
  if (rule.endDate && occ > rule.endDate) return null;
  return occ;
}

export function nextOccurrenceAfter(rule: RecurrenceRule, date: ISODate): ISODate | null {
  return firstOccurrenceOnOrAfter(rule, addDays(date, 1));
}

/** All occurrences within [from, to] (inclusive), capped at `max`. */
export function occurrencesBetween(rule: RecurrenceRule, from: ISODate, to: ISODate, max = 500): ISODate[] {
  const out: ISODate[] = [];
  const last = rule.endDate && rule.endDate < to ? rule.endDate : to;
  let k = indexOnOrAfter(rule, from < rule.startDate ? rule.startDate : from);
  for (; out.length < max; k++) {
    const occ = occurrenceAt(rule, k);
    if (occ > last) break;
    out.push(occ);
  }
  return out;
}

export function cycleToRule(cycle: BillingCycle): { frequency: Frequency; intervalCount: number } {
  switch (cycle) {
    case 'weekly':
      return { frequency: 'weekly', intervalCount: 1 };
    case 'monthly':
      return { frequency: 'monthly', intervalCount: 1 };
    case 'quarterly':
      return { frequency: 'monthly', intervalCount: 3 };
    case 'semiannual':
      return { frequency: 'monthly', intervalCount: 6 };
    case 'yearly':
      return { frequency: 'yearly', intervalCount: 1 };
  }
}

/** Cost normalised to one month (used for subscription/recurring totals). */
export function monthlyEquivalent(amountMinor: number, frequency: Frequency, intervalCount = 1): number {
  const n = Math.max(1, intervalCount);
  switch (frequency) {
    case 'daily':
      return Math.round((amountMinor * 365) / 12 / n);
    case 'weekly':
      return Math.round((amountMinor * 52) / 12 / n);
    case 'monthly':
      return Math.round(amountMinor / n);
    case 'yearly':
      return Math.round(amountMinor / 12 / n);
  }
}

export const yearlyEquivalent = (amountMinor: number, frequency: Frequency, intervalCount = 1): number =>
  Math.round(monthlyEquivalent(amountMinor, frequency, intervalCount) * 12);

/** Occurrences per year (approx.) — used for budgets/forecasts that need a period multiplier. */
export function occurrencesPerYear(frequency: Frequency, intervalCount = 1): number {
  const n = Math.max(1, intervalCount);
  switch (frequency) {
    case 'daily':
      return 365 / n;
    case 'weekly':
      return 52 / n;
    case 'monthly':
      return 12 / n;
    case 'yearly':
      return 1 / n;
  }
}
