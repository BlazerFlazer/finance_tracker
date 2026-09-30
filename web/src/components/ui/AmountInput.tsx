import { useEffect, useState } from 'react';
import { parseMoneyInput, formatAmountPlain } from '@shared/money';
import { useI18n } from '../../lib/i18n';

/**
 * A text input for money amounts. Keeps its own text while typing (so "12." or "1,2" isn't fought mid-edit),
 * and reports the parsed integer minor-units value to the parent — `null` while the text isn't a valid amount yet.
 */
export function AmountInput({
  minor,
  currency,
  onChange,
  id,
  invalid,
  placeholder,
  autoFocus,
}: {
  minor: number | null;
  currency: string;
  onChange: (minor: number | null) => void;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { locale } = useI18n();
  const [text, setText] = useState(() => (minor !== null ? formatAmountPlain(minor, currency) : ''));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(minor !== null ? formatAmountPlain(minor, currency) : '');
  }, [minor, currency, focused]);

  return (
    <input
      id={id}
      className="input"
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      aria-invalid={invalid || undefined}
      placeholder={placeholder ?? '0.00'}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        const result = parseMoneyInput(e.target.value, currency, locale);
        onChange(result.ok ? result.minor : null);
      }}
      onBlur={() => {
        setFocused(false);
        const result = parseMoneyInput(text, currency, locale);
        setText(result.ok ? formatAmountPlain(result.minor, currency) : text);
      }}
    />
  );
}
