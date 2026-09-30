import { formatMoney, type FormatMoneyOptions } from '@shared/money';
import { useI18n } from '../../lib/i18n';

/** Renders an integer minor-units amount using the active locale; negative amounts are coloured red automatically unless `neutral`. */
export function Money({ minor, currency, compact, sign, neutral, className }: { minor: number; currency: string; compact?: boolean; sign?: FormatMoneyOptions['sign']; neutral?: boolean; className?: string }) {
  const { locale } = useI18n();
  const text = formatMoney(minor, currency, { locale, compact, sign });
  const color = neutral ? undefined : minor < 0 ? 'var(--danger)' : undefined;
  return (
    <span className={`tabular-nums ${className ?? ''}`} style={{ color }}>
      {text}
    </span>
  );
}

export function useMoneyFormatter() {
  const { locale } = useI18n();
  return (minor: number, currency: string, opts?: FormatMoneyOptions) => formatMoney(minor, currency, { locale, ...opts });
}
