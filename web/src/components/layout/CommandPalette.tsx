import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, BarChart3, MinusCircle, PiggyBank, PlusCircle, Search, Settings, Target } from 'lucide-react';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useMoneyFormatter } from '../ui/Money';
import { categoryLabel } from '../../hooks/api';

interface SearchResult {
  transactions: { id: string; merchant: string | null; description: string | null; amountMinor: number; currency: string; occurredOn: string }[];
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string | null; kind: string; systemKey: string | null }[];
  goals: { id: string; name: string; targetMinor: number; currency: string }[];
  subscriptions: { id: string; name: string; priceMinor: number; currency: string }[];
  debts: { id: string; name: string; remainingMinor: number; currency: string }[];
}

export function CommandPalette({ open, onClose, onQuickAdd }: { open: boolean; onClose: () => void; onQuickAdd: (m: 'expense' | 'income' | 'transfer') => void }) {
  const t = useT();
  const nav = useNavigate();
  const money = useMoneyFormatter();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const { data } = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.get<SearchResult>('/api/search', { q: query, limit: 6 }),
    enabled: open && query.trim().length > 1,
  });

  const commands = useMemo(
    () => [
      { icon: MinusCircle, label: t('transactions.addExpense'), run: () => onQuickAdd('expense') },
      { icon: PlusCircle, label: t('transactions.addIncome'), run: () => onQuickAdd('income') },
      { icon: ArrowLeftRight, label: t('common.transfer'), run: () => onQuickAdd('transfer') },
      { icon: BarChart3, label: `${t('common.view')} ${t('nav.analytics')}`, run: () => nav('/app/analytics') },
      { icon: Target, label: t('nav.goals'), run: () => nav('/app/goals') },
      { icon: PiggyBank, label: t('nav.budgets'), run: () => nav('/app/budgets') },
      { icon: Settings, label: t('nav.settings'), run: () => nav('/app/settings') },
    ],
    [t, onQuickAdd, nav],
  );

  if (!open) return null;

  const filteredCommands = query.trim() ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase())) : commands;
  const run = (fn: () => void) => {
    fn();
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: '12vh' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" role="dialog" aria-modal="true" aria-label={t('nav.searchPlaceholder')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <Search size={17} color="var(--text-tertiary)" />
          <input
            ref={inputRef}
            className="input"
            style={{ border: 'none', height: 'auto', padding: 0, boxShadow: 'none' }}
            placeholder={t('nav.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="modal-body" style={{ padding: 8, maxHeight: '58vh' }}>
          {!query.trim() && (
            <div className="dropdown-label">{t('common.actions')}</div>
          )}
          {filteredCommands.map((c, i) => (
            <button key={i} className="dropdown-item" onClick={() => run(c.run)}>
              <c.icon size={15} /> {c.label}
            </button>
          ))}

          {query.trim().length > 1 && data && (
            <>
              {!!data.transactions.length && (
                <>
                  <div className="dropdown-label">{t('nav.transactions')}</div>
                  {data.transactions.map((tx) => (
                    <button key={tx.id} className="dropdown-item" onClick={() => run(() => nav('/app/transactions'))}>
                      <span className="truncate">{tx.merchant ?? tx.description ?? '—'}</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>{money(tx.amountMinor, tx.currency)}</span>
                    </button>
                  ))}
                </>
              )}
              {!!data.accounts.length && (
                <>
                  <div className="dropdown-label">{t('nav.accounts')}</div>
                  {data.accounts.map((a) => (
                    <button key={a.id} className="dropdown-item" onClick={() => run(() => nav('/app/accounts'))}>{a.name}</button>
                  ))}
                </>
              )}
              {!!data.categories.length && (
                <>
                  <div className="dropdown-label">{t('nav.categories')}</div>
                  {data.categories.map((c) => (
                    <button key={c.id} className="dropdown-item" onClick={() => run(() => nav('/app/categories'))}>{categoryLabel(c, t)}</button>
                  ))}
                </>
              )}
              {!!data.goals.length && (
                <>
                  <div className="dropdown-label">{t('nav.goals')}</div>
                  {data.goals.map((g) => (
                    <button key={g.id} className="dropdown-item" onClick={() => run(() => nav('/app/goals'))}>{g.name}</button>
                  ))}
                </>
              )}
              {!!data.subscriptions.length && (
                <>
                  <div className="dropdown-label">{t('nav.subscriptions')}</div>
                  {data.subscriptions.map((s) => (
                    <button key={s.id} className="dropdown-item" onClick={() => run(() => nav('/app/subscriptions'))}>{s.name}</button>
                  ))}
                </>
              )}
              {!!data.debts.length && (
                <>
                  <div className="dropdown-label">{t('nav.debts')}</div>
                  {data.debts.map((d) => (
                    <button key={d.id} className="dropdown-item" onClick={() => run(() => nav('/app/debts'))}>{d.name}</button>
                  ))}
                </>
              )}
            </>
          )}

          {query.trim().length > 1 && !filteredCommands.length && data &&
            !data.transactions.length && !data.accounts.length && !data.categories.length && !data.goals.length && !data.subscriptions.length && !data.debts.length && (
              <div className="text-secondary text-sm" style={{ padding: '20px 12px', textAlign: 'center' }}>{t('common.noResults')}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
