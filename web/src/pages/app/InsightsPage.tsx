import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, LoadingBlock } from '../../components/ui/States';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';

interface Insight { id: string; severity: 'info' | 'warning' | 'positive'; title: string; what: string; why: string; options: string[] }

const ICONS = { info: Info, warning: AlertTriangle, positive: CheckCircle2 };
const COLORS = { info: 'var(--info)', warning: 'var(--warning)', positive: 'var(--success)' };

export default function InsightsPage() {
  const t = useT();
  const { data, isLoading } = useQuery({ queryKey: ['insights'], queryFn: () => api.get<{ insights: Insight[] }>('/api/insights').then((r) => r.insights) });

  return (
    <>
      <PageHeader title={t('nav.insightsPage')} subtitle="Explainable, data-driven observations — never investment advice or a guarantee." />
      {isLoading ? <LoadingBlock height={320} /> : !data || data.length === 0 ? (
        <EmptyState icon={<Sparkles size={22} />} title="No insights yet" />
      ) : (
        <div className="flex-col gap-3">
          {data.map((insight) => {
            const Icon = ICONS[insight.severity];
            return (
              <div className="card card-pad" key={insight.id}>
                <div className="flex-row gap-3">
                  <div className="icon-chip" style={{ background: `${COLORS[insight.severity]}1a`, color: COLORS[insight.severity] }}><Icon size={16} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="font-semibold">{insight.title}</div>
                    <p className="text-secondary text-sm mt-1">{insight.what}</p>
                    <p className="text-tertiary text-sm mt-2"><strong>{t('common.learnMore')}: </strong>{insight.why}</p>
                    {insight.options.length > 0 && (
                      <div className="flex-row wrap gap-2 mt-3">
                        {insight.options.map((o, i) => <span key={i} className="badge badge-neutral">{o}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-tertiary text-sm mt-4">{t('common.disclaimer')}</p>
    </>
  );
}
