import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { useT } from '../../lib/i18n';

export function Field({ label, htmlFor, error, hint, optional, children }: { label?: ReactNode; htmlFor?: string; error?: string; hint?: string; optional?: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {optional && <span className="field-optional">({t('common.optional')})</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error">
          <AlertCircle size={12} /> {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}
