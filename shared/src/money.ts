import { CURRENCIES, MAX_AMOUNT_MINOR, SEED_RATES_PER_USD, type CurrencyDef } from './constants';

/**
 * Money helpers. All amounts travel as integers in *minor units* (cents, tiyin, kopecks…),
 * so no floating point is involved when storing or summing money.
 */

let registry = new Map<string, CurrencyDef>(CURRENCIES.map((c) => [c.code, c]));

/** Replace/extend the currency catalogue (the API serves the authoritative list from the database). */
export function setCurrencyRegistry(list: CurrencyDef[]): void {
  const next = new Map<string, CurrencyDef>(CURRENCIES.map((c) => [c.code, c]));
  for (const c of list) next.set(c.code, c);
  registry = next;
  formatterCache.clear();
}

export function getCurrency(code: string): CurrencyDef {
  return registry.get(code) ?? { code, name: code, symbol: code, minorUnits: 2, displayDecimals: 2 };
}

export function isKnownCurrency(code: string): boolean {
  return registry.has(code);
}

export function listCurrencies(): CurrencyDef[] {
  return [...registry.values()];
}

const pow10 = (n: number) => 10 ** n;

/** Exact decimal string ("1234.56", "-0.5") to minor units. Returns null for malformed input or too many decimals. */
export function decimalToMinor(input: string, minorUnits: number): number | null {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!m) return null;
  const neg = !!m[1];
  const whole = m[2]!;
  const frac = m[3] ?? '';
  if (frac.length > minorUnits) {
    // allow trailing zeros beyond the precision ("10.500" for 2 decimals is still exact)
    if (/[^0]/.test(frac.slice(minorUnits))) return null;
  }
  const fracPadded = (frac + '0'.repeat(minorUnits)).slice(0, minorUnits);
  const digits = whole + fracPadded;
  if (digits.replace(/^0+/, '').length > 15) return null; // beyond safe integer territory
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return null;
  return neg ? -n : n;
}

export function minorToDecimal(minor: number, minorUnits: number): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const s = abs.toString().padStart(minorUnits + 1, '0');
  const whole = s.slice(0, s.length - minorUnits);
  const frac = minorUnits > 0 ? s.slice(s.length - minorUnits) : '';
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Decimal string suitable for editing in a form: no grouping, trailing zeros trimmed only when whole. */
export function formatAmountPlain(minor: number, code: string): string {
  const cur = getCurrency(code);
  const s = minorToDecimal(minor, cur.minorUnits);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function decimalSeparatorOf(locale: string): string {
  const part = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal');
  return part?.value ?? '.';
}

export type ParseMoneyResult = { ok: true; minor: number } | { ok: false; reason: 'empty' | 'invalid' | 'decimals' | 'too_large' };

/**
 * Parse what a person typed into an amount field: "1 234,56", "1,234.56", "200 000", "1234.5".
 * `locale` decides how a lone separator followed by exactly 3 digits is read ("1,500" => 1500 in en, 1.5 in ru).
 */
export function parseMoneyInput(text: string, code: string, locale = 'en-US'): ParseMoneyResult {
  const cur = getCurrency(code);
  let s = text.replace(/[\s  '’_]/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  let neg = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    neg = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return { ok: false, reason: 'invalid' };
  const localeDec = decimalSeparatorOf(locale);
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    dec = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = (lastDot >= 0 ? '.' : ',') as '.' | ',';
    const count = s.split(sep).length - 1;
    const digitsAfter = s.length - s.lastIndexOf(sep) - 1;
    if (count > 1) dec = null; // several separators => grouping
    else if (sep === localeDec) dec = sep;
    else dec = digitsAfter === 3 ? null : sep;
  }
  let normalised: string;
  if (dec) {
    const other = dec === '.' ? ',' : '.';
    const i = s.lastIndexOf(dec);
    normalised = s.slice(0, i).split(other).join('').split(dec).join('') + '.' + s.slice(i + 1);
  } else {
    normalised = s.replace(/[.,]/g, '');
  }
  if (normalised.endsWith('.')) normalised = normalised.slice(0, -1);
  if (normalised.startsWith('.')) normalised = '0' + normalised;
  const minor = decimalToMinor(normalised, cur.minorUnits);
  if (minor === null) {
    return { ok: false, reason: /^\d+\.\d+$/.test(normalised) ? 'decimals' : 'invalid' };
  }
  const value = neg ? -minor : minor;
  if (Math.abs(value) > MAX_AMOUNT_MINOR) return { ok: false, reason: 'too_large' };
  return { ok: true, minor: value };
}

// ------------------------------------------------------------------ formatting
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, code: string, digits: number, opts: { compact?: boolean; sign?: 'always' | 'never' | 'auto'; currencyDisplay?: 'symbol' | 'code' | 'narrowSymbol' }): Intl.NumberFormat {
  const key = `${locale}|${code}|${digits}|${opts.compact ? 'c' : ''}|${opts.sign ?? ''}|${opts.currencyDisplay ?? ''}`;
  let f = formatterCache.get(key);
  if (!f) {
    const signDisplay = opts.sign === 'always' ? 'exceptZero' : opts.sign === 'never' ? 'never' : 'auto';
    try {
      f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        currencyDisplay: opts.currencyDisplay ?? 'symbol',
        minimumFractionDigits: opts.compact ? 0 : digits,
        maximumFractionDigits: opts.compact ? 1 : digits,
        notation: opts.compact ? 'compact' : 'standard',
        signDisplay,
      });
    } catch {
      f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay });
    }
    formatterCache.set(key, f);
  }
  return f;
}

export interface FormatMoneyOptions {
  locale?: string;
  compact?: boolean;
  sign?: 'always' | 'never' | 'auto';
  currencyDisplay?: 'symbol' | 'code' | 'narrowSymbol';
}

export function formatMoney(minor: number, code: string, opts: FormatMoneyOptions = {}): string {
  const cur = getCurrency(code);
  const locale = opts.locale ?? 'en-US';
  const unit = pow10(cur.minorUnits - cur.displayDecimals);
  const hasFraction = cur.displayDecimals < cur.minorUnits && Math.abs(minor) % unit !== 0;
  const digits = hasFraction ? cur.minorUnits : cur.displayDecimals;
  const major = minor / pow10(cur.minorUnits);
  return formatter(locale, code, digits, opts).format(major);
}

/** Number without currency symbol, e.g. "1 234,50". */
export function formatNumberMinor(minor: number, code: string, locale = 'en-US'): string {
  const cur = getCurrency(code);
  const unit = pow10(cur.minorUnits - cur.displayDecimals);
  const hasFraction = cur.displayDecimals < cur.minorUnits && Math.abs(minor) % unit !== 0;
  const digits = hasFraction ? cur.minorUnits : cur.displayDecimals;
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / pow10(cur.minorUnits));
}

export function formatPercent(value: number, locale = 'en-US', digits = 0): string {
  return new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

// ------------------------------------------------------------------ conversion
export type RatesPerUsd = Record<string, number>;

export interface Converter {
  /** Convert `minor` of currency `from` into the target currency (minor units, rounded). */
  (minor: number, from: string): number;
  target: string;
  /** currencies for which no exchange rate was known; their amounts were left out */
  missing: Set<string>;
}

export function makeConverter(rates: RatesPerUsd, target: string): Converter {
  const missing = new Set<string>();
  const targetRate = rates[target] ?? SEED_RATES_PER_USD[target];
  const tMu = getCurrency(target).minorUnits;
  const fn = ((minor: number, from: string) => {
    if (from === target) return minor;
    const fromRate = rates[from] ?? SEED_RATES_PER_USD[from];
    if (!fromRate || !targetRate) {
      missing.add(!fromRate ? from : target);
      return 0;
    }
    const fMu = getCurrency(from).minorUnits;
    const major = minor / pow10(fMu);
    return Math.round((major / fromRate) * targetRate * pow10(tMu));
  }) as Converter;
  fn.target = target;
  fn.missing = missing;
  return fn;
}

export function convertMinor(minor: number, from: string, to: string, rates: RatesPerUsd): number {
  return makeConverter(rates, to)(minor, from);
}

// ------------------------------------------------------------------- helpers
export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function safeDivide(a: number, b: number, fallback = 0): number {
  return b === 0 || !Number.isFinite(b) ? fallback : a / b;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function roundMinor(n: number): number {
  return Math.round(n);
}
