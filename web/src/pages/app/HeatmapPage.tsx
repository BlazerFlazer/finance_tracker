import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingBlock } from '../../components/ui/States';
import { useMoneyFormatter } from '../../components/ui/Money';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { addDays, eachDay } from '@shared/dates';

interface HeatmapResponse {
  currency: string;
  days: { date: string; amountMinor: number }[];
  weekdayAverages: { weekday: number; label: string; averageMinor: number }[];
}

function heat(amount: number, max: number): string {
  if (amount <= 0 || max <= 0) return 'var(--bg-sunken)';
  const ratio = Math.min(1, amount / max);
  const steps = ['var(--accent-soft)', '#a5b4fc', '#818cf8', '#6366f1', '#4338ca'];
  return steps[Math.min(steps.length - 1, Math.floor(ratio * steps.length))]!;
}

export default function HeatmapPage() {
  const t = useT();
  const { user } = useAuth();
  const money = useMoneyFormatter();
  const today = new Date().toISOString().slice(0, 10);
  const from = addDays(today, -364);
  const { data, isLoading } = useQuery({ queryKey: ['heatmap'], queryFn: () => api.get<HeatmapResponse>('/api/heatmap', { from, to: today }) });

  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d.amountMinor])), [data]);
  const max = useMemo(() => Math.max(1, ...(data?.days ?? []).map((d) => d.amountMinor)), [data]);
  const weekStart = (user?.weekStart ?? 1) as 0 | 1;

  const weeks = useMemo(() => {
    const days = eachDay(from, today);
    const out: string[][] = [];
    let week: string[] = [];
    const firstDow = (new Date(from).getUTCDay() - weekStart + 7) % 7;
    for (let i = 0; i < firstDow; i++) week.push('');
    for (const d of days) {
      week.push(d);
      if (week.length === 7) { out.push(week); week = []; }
    }
    if (week.length) out.push(week);
    return out;
  }, [from, today, weekStart]);

  return (
    <>
      <PageHeader title={t('nav.heatmap')} subtitle="Last 12 months of spending" />
      {isLoading || !data ? <LoadingBlock height={200} /> : (
        <>
          <div className="card card-pad" style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {week.map((date, di) => (
                    <div
                      key={di}
                      title={date ? `${date}: ${money(byDate.get(date) ?? 0, data.currency)}` : ''}
                      style={{ width: 11, height: 11, borderRadius: 2, background: date ? heat(byDate.get(date) ?? 0, max) : 'transparent' }}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex-row gap-2 mt-3 text-tertiary text-xs">
              <span>Less</span>
              {['var(--bg-sunken)', 'var(--accent-soft)', '#a5b4fc', '#818cf8', '#6366f1', '#4338ca'].map((c, i) => <span key={i} style={{ width: 11, height: 11, borderRadius: 2, background: c }} />)}
              <span>More</span>
            </div>
          </div>

          <div className="card card-pad mt-4">
            <div className="card-title mb-3">Average spending by weekday</div>
            <div className="flex-col gap-2">
              {data.weekdayAverages.map((w) => {
                const wmax = Math.max(1, ...data.weekdayAverages.map((x) => x.averageMinor));
                return (
                  <div key={w.weekday} className="flex-row gap-3" style={{ alignItems: 'center' }}>
                    <span className="text-sm text-secondary" style={{ width: 90 }}>{w.label}</span>
                    <div style={{ flex: 1, background: 'var(--bg-sunken)', borderRadius: 6, height: 20, overflow: 'hidden' }}>
                      <div style={{ width: `${(w.averageMinor / wmax) * 100}%`, background: 'var(--accent)', height: '100%' }} />
                    </div>
                    <span className="text-sm tabular-nums" style={{ width: 90, textAlign: 'right' }}>{money(w.averageMinor, data.currency)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
