/**
 * Calendar-date helpers on ISO strings ("YYYY-MM-DD"). A transaction date is a pure calendar day,
 * so everything here works in UTC arithmetic and never shifts by the machine time zone.
 */

export type ISODate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = RE.exec(s);
  if (!m) return false;
  const y = +m[1]!;
  const mo = +m[2]!;
  const d = +m[3]!;
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseISO(s: ISODate): { y: number; m: number; d: number } {
  const m = RE.exec(s);
  if (!m) throw new Error(`Invalid ISO date: ${s}`);
  return { y: +m[1]!, m: +m[2]!, d: +m[3]! };
}

export function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const toUTC = (s: ISODate): number => {
  const { y, m, d } = parseISO(s);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const addDays = (s: ISODate, n: number): ISODate => fromUTC(toUTC(s) + n * DAY_MS);
export const diffDays = (from: ISODate, to: ISODate): number => Math.round((toUTC(to) - toUTC(from)) / DAY_MS);

/** Add calendar months; the day of month is clamped (Jan 31 + 1 month = Feb 28/29). `day` overrides the anchor day. */
export function addMonths(s: ISODate, n: number, day?: number): ISODate {
  const { y, m, d } = parseISO(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return toISO(ny, nm, Math.min(day ?? d, daysInMonth(ny, nm)));
}
export const addYears = (s: ISODate, n: number, day?: number): ISODate => addMonths(s, n * 12, day);

/** 0 = Sunday … 6 = Saturday */
export const dayOfWeek = (s: ISODate): number => new Date(toUTC(s)).getUTCDay();

export function startOfWeek(s: ISODate, weekStart: 0 | 1 = 1): ISODate {
  return addDays(s, -((dayOfWeek(s) - weekStart + 7) % 7));
}
export const endOfWeek = (s: ISODate, weekStart: 0 | 1 = 1): ISODate => addDays(startOfWeek(s, weekStart), 6);
export const startOfMonth = (s: ISODate): ISODate => `${s.slice(0, 7)}-01`;
export function endOfMonth(s: ISODate): ISODate {
  const { y, m } = parseISO(s);
  return toISO(y, m, daysInMonth(y, m));
}
export const startOfYear = (s: ISODate): ISODate => `${s.slice(0, 4)}-01-01`;
export const endOfYear = (s: ISODate): ISODate => `${s.slice(0, 4)}-12-31`;
export const monthKey = (s: ISODate): string => s.slice(0, 7);
export const monthKeyToStart = (k: string): ISODate => `${k}-01`;
export const addMonthKey = (k: string, n: number): string => addMonths(`${k}-01`, n).slice(0, 7);

export function eachDay(from: ISODate, to: ISODate, limit = 4000): ISODate[] {
  const out: ISODate[] = [];
  let cur = from;
  while (cur <= to && out.length < limit) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function eachMonthKey(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let k = monthKey(from);
  const end = monthKey(to);
  while (k <= end && out.length < 600) {
    out.push(k);
    k = addMonthKey(k, 1);
  }
  return out;
}

/** Today's calendar date in an IANA time zone. */
export function todayInTZ(tz: string, now: Date = new Date()): ISODate {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function timeInTZ(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  } catch {
    return now.toISOString().slice(11, 16);
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- periods
export const PERIOD_PRESETS = ['7d', '30d', '90d', '6m', '1y', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

export function resolvePeriod(preset: PeriodPreset, today: ISODate, custom?: Partial<DateRange>): DateRange {
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case '6m':
      return { from: addDays(addMonths(today, -6), 1), to: today };
    case '1y':
      return { from: addDays(addMonths(today, -12), 1), to: today };
    case 'custom':
    default: {
      const to = custom?.to && isISODate(custom.to) ? custom.to : today;
      const from = custom?.from && isISODate(custom.from) ? custom.from : addDays(to, -29);
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export function previousRange(r: DateRange): DateRange {
  const len = diffDays(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function monthRange(key: string): DateRange {
  const from = monthKeyToStart(key);
  return { from, to: endOfMonth(from) };
}

/** Period containing `date` for budgets. */
export function budgetPeriodRange(period: 'weekly' | 'monthly' | 'yearly', date: ISODate, weekStart: 0 | 1 = 1): DateRange {
  if (period === 'weekly') return { from: startOfWeek(date, weekStart), to: endOfWeek(date, weekStart) };
  if (period === 'monthly') return { from: startOfMonth(date), to: endOfMonth(date) };
  return { from: startOfYear(date), to: endOfYear(date) };
}

// ----------------------------------------------------------------- formatting
export function formatDate(s: ISODate, locale: string, style: 'short' | 'medium' | 'long' | 'weekday' | 'monthYear' | 'dayMonth' = 'medium'): string {
  const d = new Date(toUTC(s));
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
  switch (style) {
    case 'short':
      Object.assign(opts, { day: '2-digit', month: '2-digit', year: 'numeric' });
      break;
    case 'medium':
      Object.assign(opts, { day: 'numeric', month: 'short', year: 'numeric' });
      break;
    case 'long':
      Object.assign(opts, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      break;
    case 'weekday':
      Object.assign(opts, { weekday: 'short', day: 'numeric', month: 'short' });
      break;
    case 'monthYear':
      Object.assign(opts, { month: 'long', year: 'numeric' });
      break;
    case 'dayMonth':
      Object.assign(opts, { day: 'numeric', month: 'short' });
      break;
  }
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function weekdayLabels(locale: string, weekStart: 0 | 1 = 1, width: 'narrow' | 'short' | 'long' = 'short'): string[] {
  // 2024-01-07 is a Sunday
  const base = '2024-01-07';
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(base, ((weekStart + i) % 7));
    return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: 'UTC' }).format(new Date(toUTC(day)));
  });
}

export function monthLabel(key: string, locale: string, width: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(locale, { month: width, year: width === 'long' ? 'numeric' : '2-digit', timeZone: 'UTC' }).format(new Date(toUTC(`${key}-01`)));
}
