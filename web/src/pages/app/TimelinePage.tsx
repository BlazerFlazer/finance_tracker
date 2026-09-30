import { useQuery } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, History, Landmark, Target } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingBlock } from '../../components/ui/States';
import { useMoneyFormatter } from '../../components/ui/Money';
import { useT, useI18n } from '../../lib/i18n';
import { api } from '../../lib/api';
import { formatDate } from '@shared/dates';

interface TimelineEvent { kind: string; date: string; label: string; amountMinor: number | null; currency: string | null }

const ICONS: Record<string, typeof History> = { transaction: ArrowUpCircle, goal_contribution: Target, debt_payment: Landmark };

export default function TimelinePage() {
  const t = useT();
  const { locale } = useI18n();
  const money = useMoneyFormatter();
  const { data, isLoading } = useQuery({ queryKey: ['timeline'], queryFn: () => api.get<{ events: TimelineEvent[] }>('/api/timeline', { limit: 80 }).then((r) => r.events) });

  return (
    <>
      <PageHeader title={t('nav.timeline')} subtitle="Last 90 days" />
      {isLoading ? <LoadingBlock height={400} /> : !data || data.length === 0 ? (
        <EmptyState icon={<History size={22} />} title={t('transactions.noTransactions')} />
      ) : (
        <div className="card card-pad">
          <div style={{ borderLeft: '2px solid var(--border)', marginLeft: 10 }}>
            {data.map((e, i) => {
              const Icon = ICONS[e.kind] ?? ArrowDownCircle;
              return (
                <div key={i} style={{ position: 'relative', paddingLeft: 28, paddingBottom: 20 }}>
                  <div style={{ position: 'absolute', left: -11, top: 0, width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-elevated)', border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={11} color="var(--accent)" />
                  </div>
                  <div className="flex-row space-between">
                    <span className="font-medium text-sm">{e.label}</span>
                    {e.amountMinor !== null && e.currency && <span className="text-sm tabular-nums">{money(e.amountMinor, e.currency)}</span>}
                  </div>
                  <div className="text-tertiary text-xs mt-1">{formatDate(e.date, locale, 'long')}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
