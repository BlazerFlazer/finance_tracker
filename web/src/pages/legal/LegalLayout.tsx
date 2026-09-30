import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useT } from '../../lib/i18n';

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  const t = useT();
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 96px' }}>
      <Link to="/" className="link text-sm">← FinTrack</Link>
      <h1 className="mt-4">{title}</h1>
      <p className="text-tertiary text-sm mt-2">{t('common.updated')}: {updated}</p>
      <div className="mt-6 flex-col gap-4" style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)' }}>
        {children}
      </div>
    </div>
  );
}
